//! Video qua scrcpy-server (độ trễ thấp): `video=true control=false` chạy bằng chính file jar đã nhúng cho kênh điều khiển (ctl.rs).
//!
//! Luồng: đẩy jar (nếu chưa có) → `app_process` quyền shell → `adb forward` tới socket trừu tượng `scrcpy_<scid>` → kết nối TCP,
//! đọc 1 byte "dummy" → 12 byte codec meta → lặp: header 12 byte (pts+cờ u64, kích thước u32, big-endian) + dữ liệu H.264 Annex-B.
//! Bộ mã hoá MediaCodec của scrcpy không đệm khung như `screenrecord`, và header đã cho sẵn ranh giới khung nên không cần
//! tách NAL / chờ start code của khung sau: mỗi gói đọc xong là gửi đi ngay.
//!
//! Gói gửi sang WebView giữ nguyên định dạng của stream.rs (byte đầu = loại): K_KEY = SPS/PPS + IDR, K_DELTA = khung P,
//! K_ROTATE khi SPS/PPS đổi (máy xoay → bộ giải mã mở lại ở IDR kế tiếp).
//! Lỗi ở bất kỳ bước nào trước khi có khung đầu tiên → stream.rs tự rơi về `screenrecord`.

use std::io::{BufRead, BufReader, Read};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use tauri::ipc::{Channel, InvokeResponseBody};

use crate::adb::Adb;
use crate::ctl::{push_jar, REMOTE_JAR, SERVER_VERSION};
use crate::stream::{send_parts, Quality, Session, K_DELTA, K_KEY, K_ROTATE, K_STATS};

const SHELL_TIMEOUT: Duration = Duration::from_secs(10);
/// "h264" dạng u32 big-endian (codec id mà scrcpy gửi trong codec meta).
const CODEC_H264: u32 = 0x6832_3634;
const FLAG_CONFIG: u64 = 1 << 63;
const FLAG_KEY: u64 = 1 << 62;
const MAX_PACKET: usize = 16 * 1024 * 1024;
/// Tuỳ chọn MediaCodec ưu tiên độ trễ (khoá lạ sẽ bị encoder bỏ qua). Chỉnh ở một chỗ này nếu một máy kén.
const CODEC_OPTIONS: &str = "priority=0,low-latency=1";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Đặt biến môi trường `LUMIR_VIDEO=screenrecord` để tắt đường scrcpy (so sánh / chẩn đoán).
pub fn enabled() -> bool {
    std::env::var("LUMIR_VIDEO").map_or(true, |v| !v.eq_ignore_ascii_case("screenrecord"))
}

pub struct Outcome {
    pub frames: u32,
    pub err: String,
}

fn fail(err: impl Into<String>) -> Outcome {
    Outcome { frames: 0, err: err.into() }
}

fn server_cmd(scid: u32, q: Quality) -> String {
    format!(
        "CLASSPATH={REMOTE_JAR} app_process / com.genymobile.scrcpy.Server {SERVER_VERSION} scid={scid:08x} \
log_level=info video=true audio=false control=false tunnel_forward=true cleanup=false power_on=false \
clipboard_autosync=false send_device_meta=false send_codec_meta=true send_frame_meta=true \
video_codec=h264 max_size={} video_bit_rate={} max_fps={} video_codec_options={CODEC_OPTIONS} 2>&1",
        q.max_side, q.bit_rate, q.fps
    )
}

/// Header gói: (là cấu hình SPS/PPS, là khung IDR, kích thước dữ liệu).
fn parse_header(h: &[u8; 12]) -> (bool, bool, usize) {
    let mut p = [0u8; 8];
    p.copy_from_slice(&h[0..8]);
    let pts = u64::from_be_bytes(p);
    let size = u32::from_be_bytes([h[8], h[9], h[10], h[11]]) as usize;
    (pts & FLAG_CONFIG != 0, pts & FLAG_KEY != 0, size)
}

/// Số liệu chẩn đoán gửi kèm luồng video mỗi ~1 giây (gói `K_STATS`) để biết khung bị giữ ở khâu nào khi hình giật rồi nhảy:
/// - `pts_gap_max`: khoảng cách lớn nhất giữa hai khung theo ĐỒNG HỒ ĐIỆN THOẠI (bộ mã hoá có xuất khung đều không?);
/// - `read_gap_max`: khoảng cách lớn nhất giữa hai gói đọc xong ở Rust (đường USB/ADB + socket có đều không?);
/// - `send_max`: lần `Channel::send` lâu nhất (kênh Tauri → WebView có nghẽn không?);
/// - thời điểm gửi (epoch ms): WebView so với giờ của nó để ra độ trễ Rust → JS (gói này xếp sau các khung nên phản ánh cả hàng đợi).
/// Gói 24 byte big-endian: pts_gap_ms u32 · read_gap_ms u32 · send_ms u32 · số gói u32 · epoch_ms u64.
struct WinStats {
    start: Instant,
    last_done: Option<Instant>,
    last_pts: Option<u64>,
    pts_gap_max_us: u64,
    read_gap_max: Duration,
    send_max: Duration,
    packets: u32,
}

impl WinStats {
    fn new() -> Self {
        WinStats { start: Instant::now(), last_done: None, last_pts: None, pts_gap_max_us: 0, read_gap_max: Duration::ZERO, send_max: Duration::ZERO, packets: 0 }
    }
    /// Gói khung (không phải config) vừa đọc xong lúc `done`, có pts (micro giây, đồng hồ điện thoại).
    fn on_packet(&mut self, done: Instant, pts_us: u64) {
        if let Some(l) = self.last_done {
            let g = done.saturating_duration_since(l);
            if g > self.read_gap_max {
                self.read_gap_max = g;
            }
        }
        self.last_done = Some(done);
        if let Some(p) = self.last_pts {
            let g = pts_us.saturating_sub(p);
            if g > self.pts_gap_max_us {
                self.pts_gap_max_us = g;
            }
        }
        self.last_pts = Some(pts_us);
        self.packets += 1;
    }
    fn on_send(&mut self, d: Duration) {
        if d > self.send_max {
            self.send_max = d;
        }
    }
    fn due(&self) -> bool {
        self.start.elapsed() >= Duration::from_secs(1)
    }
    /// Đóng gói số liệu của cửa sổ vừa rồi và mở cửa sổ mới (giữ mốc "gói trước" để không mất khoảng cách xuyên cửa sổ).
    fn take(&mut self) -> [u8; 24] {
        let mut p = [0u8; 24];
        let ms32 = |x: u128| x.min(u32::MAX as u128) as u32;
        p[0..4].copy_from_slice(&ms32((self.pts_gap_max_us / 1000) as u128).to_be_bytes());
        p[4..8].copy_from_slice(&ms32(self.read_gap_max.as_millis()).to_be_bytes());
        p[8..12].copy_from_slice(&ms32(self.send_max.as_millis()).to_be_bytes());
        p[12..16].copy_from_slice(&self.packets.to_be_bytes());
        let now_ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0);
        p[16..24].copy_from_slice(&now_ms.to_be_bytes());
        self.start = Instant::now();
        self.pts_gap_max_us = 0;
        self.read_gap_max = Duration::ZERO;
        self.send_max = Duration::ZERO;
        self.packets = 0;
        p
    }
}

fn new_scid() -> u32 {
    let t = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.subsec_nanos() ^ (d.as_secs() as u32).rotate_left(13))
        .unwrap_or(1);
    (t ^ std::process::id().rotate_left(7) ^ 0x5a5a_0000) & 0x7fff_ffff
}

/// Chạy một lượt scrcpy-video cho tới khi luồng đứt / bị dừng. `frames` = số khung đã gửi (0 = chưa lên được).
pub(crate) fn run_once(adb: &Adb, serial: &str, sess: &Arc<Session>, ch: &Channel<InvokeResponseBody>, q: Quality) -> Outcome {
    if let Err(e) = push_jar(adb, serial) {
        return fail(e);
    }
    let scid = new_scid();
    let socket = format!("scrcpy_{scid:08x}");
    let cmd = server_cmd(scid, q);

    let mut server = match adb.spawn_session(&["-s", serial, "shell", &cmd], true) {
        Ok(c) => c,
        Err(e) => return fail(e.to_string()),
    };
    let log = Arc::new(Mutex::new(Vec::<String>::new()));
    if let Some(out) = server.stdout.take() {
        let log = log.clone();
        let _ = thread::Builder::new().name("lumir-scvideo-log".into()).spawn(move || {
            for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                eprintln!("[lumir/scrcpy-video] {line}");
                let mut l = lock(&log);
                l.push(line);
                if l.len() > 8 {
                    l.remove(0);
                }
            }
        });
    }
    *lock(&sess.child) = Some(server);
    if sess.stopped() {
        sess.stop(); // stop() đến trước khi child được đăng ký
    }

    let mut port: Option<u16> = None;
    let outcome = run_connected(adb, serial, sess, ch, &socket, &log, &mut port);

    // Dọn dẹp: đóng socket, diệt server (adb shell), gỡ forward.
    if let Some(s) = lock(&sess.sock).take() {
        let _ = s.shutdown(Shutdown::Both);
    }
    let child = lock(&sess.child).take();
    if let Some(mut c) = child {
        let _ = c.kill();
        let _ = c.wait();
    }
    if let Some(p) = port {
        let _ = adb.run(&["-s", serial, "forward", "--remove", &format!("tcp:{p}")], Duration::from_secs(4));
    }
    outcome
}

fn run_connected(
    adb: &Adb,
    serial: &str,
    sess: &Arc<Session>,
    ch: &Channel<InvokeResponseBody>,
    socket: &str,
    log: &Arc<Mutex<Vec<String>>>,
    port_out: &mut Option<u16>,
) -> Outcome {
    let with_log = |why: String| -> String {
        let tail = lock(log).join(" | ");
        if tail.is_empty() { why } else { format!("{why} ({tail})") }
    };

    let port = match adb
        .run(&["-s", serial, "forward", "tcp:0", &format!("localabstract:{socket}")], SHELL_TIMEOUT)
        .ok()
        .and_then(|o| o.trim().parse::<u16>().ok())
    {
        Some(p) => p,
        None => return fail("adb forward failed"),
    };
    *port_out = Some(port);

    // Server cần ~0,5–1,5 giây để lên: thử lại cho tới khi nhận được byte "dummy".
    let addr = SocketAddr::from(([127, 0, 0, 1], port));
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut stream = loop {
        if sess.stopped() {
            return fail("stopped");
        }
        let exited = lock(&sess.child).as_mut().and_then(|c| c.try_wait().ok().flatten());
        if let Some(status) = exited {
            return fail(with_log(format!("server exited ({status})")));
        }
        if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
            let _ = s.set_read_timeout(Some(Duration::from_millis(600)));
            let mut b = [0u8; 1];
            if matches!(s.read(&mut b), Ok(1)) {
                let _ = s.set_nodelay(true);
                break s;
            }
        }
        if Instant::now() > deadline {
            return fail(with_log("server did not accept the video connection".into()));
        }
        thread::sleep(Duration::from_millis(60));
    };
    if let Ok(c) = stream.try_clone() {
        *lock(&sess.sock) = Some(c);
        if sess.stopped() {
            sess.stop();
        }
    }

    // Codec meta: codec id, rộng, cao (u32 mỗi trường).
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut meta = [0u8; 12];
    if stream.read_exact(&mut meta).is_err() {
        return fail(with_log("no codec meta".into()));
    }
    if u32::from_be_bytes([meta[0], meta[1], meta[2], meta[3]]) != CODEC_H264 {
        return fail(with_log("unexpected video codec".into()));
    }

    let mut frames = 0u32;
    let mut err = String::new();
    let mut cfg: Vec<u8> = Vec::new();
    let mut buf: Vec<u8> = Vec::new();
    let mut hdr = [0u8; 12];
    let mut win = WinStats::new();
    loop {
        if stream.read_exact(&mut hdr).is_err() {
            break;
        }
        let (is_cfg, is_key, size) = parse_header(&hdr);
        if size == 0 || size > MAX_PACKET {
            err = "bad video packet".into();
            break;
        }
        buf.resize(size, 0);
        if stream.read_exact(&mut buf).is_err() {
            break;
        }
        if frames == 0 {
            let _ = stream.set_read_timeout(None); // màn hình tĩnh có thể im lặng lâu: không coi là lỗi
        }
        if is_cfg {
            if cfg != buf {
                if !cfg.is_empty() && !send_parts(ch, K_ROTATE, &[]) {
                    sess.stop();
                    break;
                }
                cfg.clear();
                cfg.extend_from_slice(&buf);
            }
            continue;
        }
        let done = Instant::now();
        let pts = u64::from_be_bytes([hdr[0], hdr[1], hdr[2], hdr[3], hdr[4], hdr[5], hdr[6], hdr[7]]) & !(FLAG_CONFIG | FLAG_KEY);
        win.on_packet(done, pts);
        let ok = if is_key {
            send_parts(ch, K_KEY, &[&cfg[..], &buf[..]])
        } else {
            send_parts(ch, K_DELTA, &[&buf[..]])
        };
        win.on_send(done.elapsed());
        if !ok {
            sess.stop(); // cửa sổ đã đóng: Channel không còn người nhận
            break;
        }
        frames += 1;
        if win.due() {
            let st = win.take();
            if !send_parts(ch, K_STATS, &[&st[..]]) {
                sess.stop();
                break;
            }
        }
    }
    Outcome { frames, err: if err.is_empty() { err } else { with_log(err) } }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn win_stats_tracks_gaps_and_resets() {
        let mut w = WinStats::new();
        let t0 = Instant::now();
        w.on_packet(t0, 1_000_000);
        w.on_packet(t0 + Duration::from_millis(40), 1_033_000);
        w.on_packet(t0 + Duration::from_millis(50), 1_050_000);
        w.on_send(Duration::from_millis(7));
        let p = w.take();
        assert_eq!(u32::from_be_bytes([p[0], p[1], p[2], p[3]]), 33); // pts: 33 ms là khoảng lớn nhất
        assert_eq!(u32::from_be_bytes([p[4], p[5], p[6], p[7]]), 40); // đọc: 40 ms
        assert_eq!(u32::from_be_bytes([p[8], p[9], p[10], p[11]]), 7); // gửi: 7 ms
        assert_eq!(u32::from_be_bytes([p[12], p[13], p[14], p[15]]), 3);
        let q = w.take();
        assert_eq!(u32::from_be_bytes([q[12], q[13], q[14], q[15]]), 0);
        assert_eq!(&q[0..12], &[0u8; 12]);
    }

    #[test]
    fn header_flags() {
        let mut h = [0u8; 12];
        h[0] = 0x80; // config
        h[11] = 7;
        assert_eq!(parse_header(&h), (true, false, 7));
        let mut k = [0u8; 12];
        k[0] = 0x40; // key
        k[10] = 1; // 256
        assert_eq!(parse_header(&k), (false, true, 256));
        assert_eq!(parse_header(&[0u8; 12]), (false, false, 0));
    }

    #[test]
    fn command_has_video_only_flags() {
        let c = server_cmd(0x1234, Quality::new(Some(720), Some(4), None));
        assert!(c.contains("video=true audio=false control=false"));
        assert!(c.contains("max_size=720 video_bit_rate=4000000 max_fps=60"));
        assert!(c.contains("scid=00001234"));
        assert!(c.ends_with("2>&1"));
    }

    #[test]
    fn command_uses_requested_fps() {
        let c = server_cmd(0x1234, Quality::new(Some(1280), Some(8), Some(120)));
        assert!(c.contains("max_fps=120"));
        assert!(!c.contains("max_fps=60"));
    }

    #[test]
    fn codec_id_is_h264() {
        assert_eq!(&CODEC_H264.to_be_bytes(), b"h264");
    }
}