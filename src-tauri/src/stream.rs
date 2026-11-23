//! Đường chính: video qua scrcpy-server (scvideo.rs, độ trễ thấp). Nếu không chạy được thì rơi về đường dưới đây.
//! Luồng video màn hình: `adb exec-out screenrecord --output-format=h264 -` → tách khung (h264.rs)
//! → gửi nhị phân qua `Channel` tới cửa sổ điện thoại, nơi WebCodecs giải mã và vẽ lên canvas.
//!
//! Mỗi gói gửi ra có byte đầu là loại: 0 = khung P, 1 = khung IDR (kèm SPS/PPS), 2 = lỗi (phần còn lại là
//! văn bản UTF-8, luồng đã dừng hẳn), 3 = đang nối lại (screenrecord tự dừng sau 180 giây, ta khởi động lại),
//! 4 = máy vừa xoay (đã mở lại luồng với kích thước mới: frontend mở lại bộ giải mã).
//! Không cần cài thêm gì lên điện thoại; yêu cầu Android 4.4+ (screenrecord có sẵn trong hệ thống).

use std::collections::HashMap;
use std::io::Read;
use std::net::{Shutdown, TcpStream};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::adb::Adb;
use crate::device::{self, AppState};
use crate::input::{Link, Orient};
use crate::h264::{encode_size, FrameBuilder, NalSplitter};
use crate::scvideo;

pub const K_DELTA: u8 = 0;
pub const K_KEY: u8 = 1;
pub const K_ERROR: u8 = 2;
pub const K_RESTART: u8 = 3;
pub const K_ROTATE: u8 = 4;
/// Số liệu chẩn đoán (scvideo::WinStats) gửi kèm luồng mỗi ~1 giây; WebView không giải mã gói này.
pub const K_STATS: u8 = 5;

/// Chất lượng video do người dùng chọn (Mượt / Cân bằng / Sắc nét / Tuỳ chỉnh).
/// screenrecord không có tuỳ chọn FPS (nó xuất khung theo mỗi lần màn hình thay đổi), nên FPS cao đạt được
/// bằng cách giảm độ phân giải + bitrate để encoder và đường USB theo kịp.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Quality {
    /// Cạnh dài tối đa của video mã hoá (điểm ảnh).
    pub max_side: u32,
    /// Bitrate (bit/giây).
    pub bit_rate: u32,
}

impl Quality {
    pub const MIN_SIDE: u32 = 320;
    pub const MAX_SIDE: u32 = 2560;
    pub const MIN_RATE: u32 = 500_000;
    pub const MAX_RATE: u32 = 32_000_000;

    /// Giá trị từ frontend (cạnh dài, Mbps); thiếu thì dùng mức Cân bằng. Luôn kẹp trong khoảng an toàn.
    pub fn new(max_side: Option<u32>, mbps: Option<u32>) -> Quality {
        Quality {
            max_side: max_side.unwrap_or(1280).clamp(Self::MIN_SIDE, Self::MAX_SIDE),
            bit_rate: mbps
                .map_or(8_000_000, |m| m.saturating_mul(1_000_000))
                .clamp(Self::MIN_RATE, Self::MAX_RATE),
        }
    }
}
/// Một khung chỉ biết là đã đủ khi start code của khung sau đến, nên khung nào cũng bị trễ một khung (hoặc cả
/// màn hình tĩnh thì mãi không có khung sau). Để không phải chờ, im lặng quá chừng này là coi NAL đang dở đã đủ.
/// Bắt đầu rất ngắn để độ trễ thấp nhất; nếu lỡ cắt giữa chừng một khung (h264.rs phát hiện được) thì mở lại
/// luồng và nới dần tới mức tối đa.
const IDLE_FLUSH_MIN: Duration = Duration::from_millis(4);
const IDLE_FLUSH_MAX: Duration = Duration::from_millis(24);
const MAX_FAILS: u32 = 3;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Một phiên stream gắn với một cửa sổ điện thoại.
pub(crate) struct Session {
    stop: AtomicBool,
    pub(crate) child: Mutex<Option<Child>>,
    /// Socket video của scrcpy (scvideo.rs): đóng khi dừng để luồng đang chờ đọc thoát ngay.
    pub(crate) sock: Mutex<Option<TcpStream>>,
}

impl Session {
    pub(crate) fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    pub(crate) fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(c) = lock(&self.child).as_mut() {
            let _ = c.kill();
        }
        if let Some(s) = lock(&self.sock).take() {
            let _ = s.shutdown(Shutdown::Both);
        }
    }
}

#[derive(Default)]
pub struct Streams {
    map: Mutex<HashMap<String, Arc<Session>>>,
}

impl Streams {
    /// Bắt đầu stream cho cửa sổ `label`; phiên cũ của cửa sổ đó (nếu có) bị dừng trước.
    pub fn start(
        &self,
        label: &str,
        st: Arc<AppState>,
        serial: String,
        ch: Channel<InvokeResponseBody>,
        link: Arc<Link>,
        quality: Quality,
    ) {
        let sess = Arc::new(Session { stop: AtomicBool::new(false), child: Mutex::new(None), sock: Mutex::new(None) });
        if let Some(old) = lock(&self.map).insert(label.to_string(), sess.clone()) {
            old.stop();
        }
        let _ = thread::Builder::new()
            .name(format!("lumir-stream-{label}"))
            .spawn(move || run(st, serial, sess, ch, link, quality));
    }

    pub fn stop(&self, label: &str) {
        if let Some(s) = lock(&self.map).remove(label) {
            s.stop();
        }
    }
}

fn send(ch: &Channel<InvokeResponseBody>, kind: u8, payload: &[u8]) -> bool {
    send_parts(ch, kind, &[payload])
}

/// Như `send` nhưng ghép nhiều đoạn vào một gói (vd. SPS/PPS + IDR) mà không phải nối trước.
pub(crate) fn send_parts(ch: &Channel<InvokeResponseBody>, kind: u8, parts: &[&[u8]]) -> bool {
    let mut v = Vec::with_capacity(1 + parts.iter().map(|p| p.len()).sum::<usize>());
    v.push(kind);
    for p in parts {
        v.extend_from_slice(p);
    }
    ch.send(InvokeResponseBody::Raw(v)).is_ok()
}

/// Kết quả một lượt screenrecord.
struct Outcome {
    frames: u32,
    err: String,
    /// Cần mở lại ngay (không tính là lỗi): K_ROTATE khi máy xoay, K_RESTART khi lỡ cắt nhầm khung.
    reopen: Option<u8>,
}

/// Máy đã đổi hướng so với lúc mở luồng? (chưa biết → biết là 0 thì không tính, vì screenrecord mặc định hướng 0)
fn rotated(orient: &Orient, at_start: Option<u8>) -> bool {
    match (orient.get(), at_start) {
        (Some(now), Some(then)) => now != then,
        (Some(now), None) => now != 0,
        _ => false,
    }
}

/// Thử video qua scrcpy-server trước (độ trễ thấp). Trả true = đã xong hẳn (dừng / ngắt kết nối / cửa sổ đóng);
/// false = scrcpy không chạy được trên máy này → rơi về screenrecord.
fn run_scrcpy(st: &Arc<AppState>, serial: &str, sess: &Arc<Session>, ch: &Channel<InvokeResponseBody>, quality: Quality) -> bool {
    let mut fails = 0u32;
    while !sess.stopped() {
        if device::connected_view(st, serial).is_none() {
            send(ch, K_ERROR, device::MSG_NOT_CONNECTED.as_bytes());
            return true;
        }
        let started = Instant::now();
        let out = scvideo::run_once(&st.adb, serial, sess, ch, quality);
        if sess.stopped() {
            return true;
        }
        if out.frames > 0 && started.elapsed() > Duration::from_secs(2) {
            fails = 0; // chạy ổn rồi mới đứt: nối lại, giải mã tiếp từ IDR mới
            if !send(ch, K_RESTART, &[]) {
                return true;
            }
            continue;
        }
        fails += 1;
        eprintln!("[lumir] scrcpy video attempt {fails} failed: {}", out.err);
        if fails >= 2 {
            return false;
        }
        thread::sleep(Duration::from_millis(300));
    }
    true
}

fn run(st: Arc<AppState>, serial: String, sess: Arc<Session>, ch: Channel<InvokeResponseBody>, link: Arc<Link>, quality: Quality) {
    if scvideo::enabled() && run_scrcpy(&st, &serial, &sess, &ch, quality) {
        sess.stop();
        return;
    }
    if sess.stopped() {
        return;
    }
    eprintln!("[lumir] using screenrecord video fallback");
    let natural = device::connected_view(&st, &serial)
        .and_then(|v| v.resolution)
        .and_then(|r| device::parse_resolution(&r));
    let orient = link.orient();
    let mut use_size = natural.is_some();
    let mut fails = 0u32;
    let mut idle = IDLE_FLUSH_MIN;

    while !sess.stopped() {
        if device::connected_view(&st, &serial).is_none() {
            send(&ch, K_ERROR, device::MSG_NOT_CONNECTED.as_bytes());
            break;
        }
        // Kích thước encode theo hướng hiện tại: máy nằm ngang thì đảo W×H (screenrecord không tự xoay giữa chừng).
        let rot = orient.get();
        let size = natural
            .map(|(w, h)| if rot.is_some_and(|r| r % 2 == 1) { (h, w) } else { (w, h) })
            .and_then(|(w, h)| encode_size(w, h, quality.max_side));
        let started = Instant::now();
        let out = run_once(&st.adb, &serial, &sess, &ch, if use_size { size } else { None }, quality.bit_rate, &orient, rot, idle);
        if sess.stopped() {
            break;
        }
        if let Some(kind) = out.reopen {
            if kind == K_RESTART {
                idle = (idle * 2).min(IDLE_FLUSH_MAX); // lần sau chờ lâu hơn một chút cho chắc
            }
            fails = 0;
            if !send(&ch, kind, &[]) {
                break;
            }
            continue;
        }
        if out.frames > 0 && started.elapsed() > Duration::from_secs(2) {
            // Hết 180 giây của screenrecord (hoặc luồng đứt giữa chừng): nối lại, giải mã tiếp từ IDR mới.
            fails = 0;
            if !send(&ch, K_RESTART, &[]) {
                break;
            }
            continue;
        }
        if use_size {
            use_size = false; // thử lại với kích thước gốc của máy
            continue;
        }
        fails += 1;
        if fails >= MAX_FAILS {
            let msg = if out.err.is_empty() { "Video stream stopped".to_string() } else { out.err };
            send(&ch, K_ERROR, msg.as_bytes());
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }
    sess.stop();
}

/// Chạy screenrecord một lượt.
#[allow(clippy::too_many_arguments)]
fn run_once(
    adb: &Adb,
    serial: &str,
    sess: &Arc<Session>,
    ch: &Channel<InvokeResponseBody>,
    size: Option<(u32, u32)>,
    bit_rate: u32,
    orient: &Orient,
    start_rot: Option<u8>,
    idle: Duration,
) -> Outcome {
    let size_arg = size.map(|(w, h)| format!("{w}x{h}"));
    let rate_arg = bit_rate.to_string();
    let mut args: Vec<&str> = vec!["-s", serial, "exec-out", "screenrecord", "--output-format=h264", "--bit-rate", &rate_arg];
    if let Some(s) = &size_arg {
        args.push("--size");
        args.push(s);
    }
    args.push("-");

    let mut child = match adb.spawn_piped(&args) {
        Ok(c) => c,
        Err(e) => return Outcome { frames: 0, err: e.to_string(), reopen: None },
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    *lock(&sess.child) = Some(child);
    if sess.stopped() {
        sess.stop(); // stop() đến trước khi child được đăng ký
    }

    let err_buf = Arc::new(Mutex::new(String::new()));
    let err_thread = stderr.map(|mut e| {
        let buf = err_buf.clone();
        thread::spawn(move || {
            let mut b = Vec::new();
            let _ = e.by_ref().take(4096).read_to_end(&mut b);
            *lock(&buf) = String::from_utf8_lossy(&b).trim().to_string();
        })
    });

    let (tx, rx) = mpsc::channel::<Vec<u8>>();
    let reader = stdout.map(|mut o| {
        thread::spawn(move || {
            let mut buf = vec![0u8; 64 * 1024];
            loop {
                match o.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        if tx.send(buf[..n].to_vec()).is_err() {
                            break;
                        }
                    }
                }
            }
        })
    });

    let (mut splitter, mut builder) = (NalSplitter::default(), FrameBuilder::default());
    let mut frames = 0u32;
    let mut reopen: Option<u8> = None;
    let mut emit = |nal: Vec<u8>| -> bool {
        if let Some(f) = builder.push(nal) {
            frames += 1;
            return send(ch, if f.key { K_KEY } else { K_DELTA }, &f.data);
        }
        true
    };
    'outer: loop {
        // Kiểm tra mỗi vòng (≤ `idle` một lần kể cả khi màn hình tĩnh) nên xoay máy được phát hiện gần như ngay.
        if rotated(orient, start_rot) {
            reopen = Some(K_ROTATE);
            break;
        }
        match rx.recv_timeout(idle) {
            Ok(chunk) => {
                for nal in splitter.push(&chunk) {
                    if !emit(nal) {
                        sess.stop(); // cửa sổ đã đóng: Channel không còn người nhận
                        break 'outer;
                    }
                }
                if splitter.take_desync() {
                    reopen = Some(K_RESTART); // đã gửi nửa khung: mở lại luồng để có IDR sạch
                    break;
                }
            }
            Err(RecvTimeoutError::Timeout) => {
                if let Some(nal) = splitter.flush() {
                    if !emit(nal) {
                        sess.stop();
                        break;
                    }
                }
            }
            Err(RecvTimeoutError::Disconnected) => break,
        }
    }

    let child = lock(&sess.child).take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    if let Some(r) = reader {
        let _ = r.join();
    }
    if let Some(t) = err_thread {
        let _ = t.join();
    }
    let err = lock(&err_buf).clone();
    Outcome { frames, err, reopen }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quality_is_clamped() {
        assert_eq!(Quality::new(None, None), Quality { max_side: 1280, bit_rate: 8_000_000 });
        assert_eq!(Quality::new(Some(10), Some(0)), Quality { max_side: 320, bit_rate: 500_000 });
        assert_eq!(Quality::new(Some(99999), Some(u32::MAX)), Quality { max_side: 2560, bit_rate: 32_000_000 });
        assert_eq!(Quality::new(Some(720), Some(4)), Quality { max_side: 720, bit_rate: 4_000_000 });
    }
}