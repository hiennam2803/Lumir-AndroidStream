//! Luồng video màn hình: `adb exec-out screenrecord --output-format=h264 -` → tách khung (h264.rs)
//! → gửi nhị phân qua `Channel` tới cửa sổ điện thoại, nơi WebCodecs giải mã và vẽ lên canvas.
//!
//! Mỗi gói gửi ra có byte đầu là loại: 0 = khung P, 1 = khung IDR (kèm SPS/PPS), 2 = lỗi (phần còn lại là
//! văn bản UTF-8, luồng đã dừng hẳn), 3 = đang nối lại (screenrecord tự dừng sau 180 giây, ta khởi động lại).
//! Không cần cài thêm gì lên điện thoại; yêu cầu Android 4.4+ (screenrecord có sẵn trong hệ thống).

use std::collections::HashMap;
use std::io::Read;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::adb::Adb;
use crate::device::{self, AppState};
use crate::h264::{encode_size, FrameBuilder, NalSplitter};

pub const K_DELTA: u8 = 0;
pub const K_KEY: u8 = 1;
pub const K_ERROR: u8 = 2;
pub const K_RESTART: u8 = 3;

/// Cạnh dài tối đa của video mã hoá. 1280 đủ nét cho cửa sổ điện thoại và encoder nào cũng nhận.
const MAX_LONG_SIDE: u32 = 1280;
const BIT_RATE: &str = "8000000";
/// Màn hình tĩnh thì encoder không xuất khung mới: sau chừng này im lặng coi NAL đang dở là đã đủ.
const IDLE_FLUSH: Duration = Duration::from_millis(25);
const MAX_FAILS: u32 = 3;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Một phiên stream gắn với một cửa sổ điện thoại.
struct Session {
    stop: AtomicBool,
    child: Mutex<Option<Child>>,
}

impl Session {
    fn stopped(&self) -> bool {
        self.stop.load(Ordering::SeqCst)
    }
    fn stop(&self) {
        self.stop.store(true, Ordering::SeqCst);
        if let Some(c) = lock(&self.child).as_mut() {
            let _ = c.kill();
        }
    }
}

#[derive(Default)]
pub struct Streams {
    map: Mutex<HashMap<String, Arc<Session>>>,
}

impl Streams {
    /// Bắt đầu stream cho cửa sổ `label`; phiên cũ của cửa sổ đó (nếu có) bị dừng trước.
    pub fn start(&self, label: &str, st: Arc<AppState>, serial: String, ch: Channel<InvokeResponseBody>) {
        let sess = Arc::new(Session { stop: AtomicBool::new(false), child: Mutex::new(None) });
        if let Some(old) = lock(&self.map).insert(label.to_string(), sess.clone()) {
            old.stop();
        }
        let _ = thread::Builder::new()
            .name(format!("lumir-stream-{label}"))
            .spawn(move || run(st, serial, sess, ch));
    }

    pub fn stop(&self, label: &str) {
        if let Some(s) = lock(&self.map).remove(label) {
            s.stop();
        }
    }
}

fn send(ch: &Channel<InvokeResponseBody>, kind: u8, payload: &[u8]) -> bool {
    let mut v = Vec::with_capacity(payload.len() + 1);
    v.push(kind);
    v.extend_from_slice(payload);
    ch.send(InvokeResponseBody::Raw(v)).is_ok()
}

fn parse_res(r: &str) -> Option<(u32, u32)> {
    let (w, h) = r.split_once('×').or_else(|| r.split_once('x'))?;
    Some((w.trim().parse().ok()?, h.trim().parse().ok()?))
}

fn run(st: Arc<AppState>, serial: String, sess: Arc<Session>, ch: Channel<InvokeResponseBody>) {
    let size = device::connected_view(&st, &serial)
        .and_then(|v| v.resolution)
        .and_then(|r| parse_res(&r))
        .and_then(|(w, h)| encode_size(w, h, MAX_LONG_SIDE));
    let mut use_size = size.is_some();
    let mut fails = 0u32;

    while !sess.stopped() {
        if device::connected_view(&st, &serial).is_none() {
            send(&ch, K_ERROR, device::MSG_NOT_CONNECTED.as_bytes());
            break;
        }
        let started = Instant::now();
        let (frames, err) = run_once(&st.adb, &serial, &sess, &ch, if use_size { size } else { None });
        if sess.stopped() {
            break;
        }
        if frames > 0 && started.elapsed() > Duration::from_secs(2) {
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
            let msg = if err.is_empty() { "Video stream stopped".to_string() } else { err };
            send(&ch, K_ERROR, msg.as_bytes());
            break;
        }
        thread::sleep(Duration::from_millis(500));
    }
    sess.stop();
}

/// Chạy screenrecord một lượt. Trả (số khung đã gửi, nội dung stderr).
fn run_once(
    adb: &Adb,
    serial: &str,
    sess: &Arc<Session>,
    ch: &Channel<InvokeResponseBody>,
    size: Option<(u32, u32)>,
) -> (u32, String) {
    let size_arg = size.map(|(w, h)| format!("{w}x{h}"));
    let mut args: Vec<&str> = vec!["-s", serial, "exec-out", "screenrecord", "--output-format=h264", "--bit-rate", BIT_RATE];
    if let Some(s) = &size_arg {
        args.push("--size");
        args.push(s);
    }
    args.push("-");

    let mut child = match adb.spawn_piped(&args) {
        Ok(c) => c,
        Err(e) => return (0, e.to_string()),
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
    let mut emit = |nal: Vec<u8>| -> bool {
        if let Some(f) = builder.push(nal) {
            frames += 1;
            return send(ch, if f.key { K_KEY } else { K_DELTA }, &f.data);
        }
        true
    };
    'outer: loop {
        match rx.recv_timeout(IDLE_FLUSH) {
            Ok(chunk) => {
                for nal in splitter.push(&chunk) {
                    if !emit(nal) {
                        sess.stop(); // cửa sổ đã đóng: Channel không còn người nhận
                        break 'outer;
                    }
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
    (frames, err)
}
