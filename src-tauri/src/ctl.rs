//! Kênh điều khiển thời gian thực qua scrcpy-server (Apache-2.0, https://github.com/Genymobile/scrcpy).
//!
//! Chỉ dùng phần điều khiển của server (`video=false audio=false control=true`): server chạy bằng `app_process`
//! quyền shell và tiêm cảm ứng / phím bằng đúng cơ chế mà `input tap` dùng (InputManager), nhưng qua MỘT socket
//! mở sẵn nên mỗi sự kiện chỉ tốn vài ms, kéo/thả/nhấn giữ/đa điểm đều thời gian thực.
//!
//! Luồng khởi động: đẩy jar lên /data/local/tmp (bỏ qua nếu đã có đúng kích thước) → chạy server → `adb forward`
//! tới socket trừu tượng `scrcpy_<scid>` → kết nối TCP, đọc 1 byte "dummy" xác nhận server đã nhận kết nối.
//! Không có video nên server không biết kích thước màn hình: nó dùng thẳng toạ độ điểm ảnh ta gửi
//! (cùng hệ toạ độ với `input tap`, tức theo hướng xoay hiện tại).
//!
//! Giao thức (big-endian), xem server/.../ControlMessageReader.java:
//!   INJECT_KEYCODE(0):     type u8, action u8, keycode i32, repeat i32, meta i32                       = 14 byte
//!   INJECT_TOUCH_EVENT(2): type u8, action u8, pointerId i64, x i32, y i32, w u16, h u16, pressure u16,
//!                          actionButton i32, buttons i32                                              = 32 byte

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, SocketAddr, TcpStream};
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::adb::Adb;

/// Phiên bản server PHẢI khớp tuyệt đối với jar (server từ chối nếu lệch).
pub const SERVER_VERSION: &str = "3.3.3";
const SERVER_JAR: &[u8] = include_bytes!("../scrcpy/scrcpy-server-v3.3.3.jar");
pub(crate) const REMOTE_JAR: &str = "/data/local/tmp/lumir-scrcpy-3.3.3.jar";

const ACTION_DOWN: u8 = 0;
const ACTION_UP: u8 = 1;
const ACTION_MOVE: u8 = 2;
/// Một ngón tay "chung" (scrcpy dùng -2); -1 là chuột nên không dùng.
const FINGER: i64 = -2;
const SHELL_TIMEOUT: Duration = Duration::from_secs(10);

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ───────────────────────── Dựng gói tin (thuần, có test) ─────────────────────────

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Act {
    Down,
    Move,
    Up,
}

/// (x, y) là điểm ảnh theo hướng hiển thị hiện tại, (w, h) là kích thước màn hình tương ứng.
pub fn touch_msg(act: Act, x: i32, y: i32, w: u16, h: u16) -> [u8; 32] {
    let (action, pressure) = match act {
        Act::Down => (ACTION_DOWN, 0xFFFFu16),
        Act::Move => (ACTION_MOVE, 0xFFFF),
        Act::Up => (ACTION_UP, 0),
    };
    let mut m = [0u8; 32];
    m[0] = 2;
    m[1] = action;
    m[2..10].copy_from_slice(&FINGER.to_be_bytes());
    m[10..14].copy_from_slice(&x.to_be_bytes());
    m[14..18].copy_from_slice(&y.to_be_bytes());
    m[18..20].copy_from_slice(&w.to_be_bytes());
    m[20..22].copy_from_slice(&h.to_be_bytes());
    m[22..24].copy_from_slice(&pressure.to_be_bytes());
    // actionButton, buttons = 0 (cảm ứng ngón tay không có nút)
    m
}

/// Nhấn rồi nhả một phím Android (keycode như `input keyevent`).
pub fn key_msgs(code: i32) -> [u8; 28] {
    let mut m = [0u8; 28];
    for (i, action) in [ACTION_DOWN, ACTION_UP].into_iter().enumerate() {
        let o = i * 14;
        m[o] = 0;
        m[o + 1] = action;
        m[o + 2..o + 6].copy_from_slice(&code.to_be_bytes());
        // repeat = 0, metaState = 0
    }
    m
}

/// Nhấn rồi nhả một phím Android kèm trạng thái phím bổ trợ (Shift 0x1, Alt 0x2, Ctrl 0x1000...).
pub fn key_meta_msgs(code: i32, meta: u32) -> [u8; 28] {
    let mut m = [0u8; 28];
    for (i, action) in [ACTION_DOWN, ACTION_UP].into_iter().enumerate() {
        let o = i * 14;
        m[o] = 0;
        m[o + 1] = action;
        m[o + 2..o + 6].copy_from_slice(&code.to_be_bytes());
        // repeat = 0
        m[o + 10..o + 14].copy_from_slice(&meta.to_be_bytes());
    }
    m
}

/// INJECT_TEXT (type 1): u32 độ dài + UTF-8. scrcpy giới hạn 300 byte và chỉ gõ được ký tự có trên bàn phím ảo (ASCII).
pub fn text_msg(text: &str) -> Option<Vec<u8>> {
    let b = text.as_bytes();
    if b.is_empty() || b.len() > 300 {
        return None;
    }
    let mut m = Vec::with_capacity(5 + b.len());
    m.push(1);
    m.extend_from_slice(&(b.len() as u32).to_be_bytes());
    m.extend_from_slice(b);
    Some(m)
}

/// Giới hạn một gói SET_CLIPBOARD của scrcpy (256 KB trừ phần header).
const CLIP_MAX: usize = (1 << 18) - 14;

/// SET_CLIPBOARD (type 9) kèm lệnh dán: u64 sequence (0 = không cần ack), u8 paste, u32 độ dài + UTF-8.
/// Đây là cách duy nhất gõ được tiếng Việt có dấu, emoji... (INJECT_TEXT chỉ nhận ASCII).
pub fn paste_msg(text: &str) -> Option<Vec<u8>> {
    let b = text.as_bytes();
    if b.is_empty() || b.len() > CLIP_MAX {
        return None;
    }
    let mut m = Vec::with_capacity(14 + b.len());
    m.push(9);
    m.extend_from_slice(&0u64.to_be_bytes());
    m.push(1);
    m.extend_from_slice(&(b.len() as u32).to_be_bytes());
    m.extend_from_slice(b);
    Some(m)
}

/// GET_CLIPBOARD (type 8): bảo server lấy clipboard của điện thoại; `key` = 0 chỉ đọc, 1 bấm COPY rồi đọc, 2 bấm CUT rồi đọc.
pub fn get_clipboard_msg(key: u8) -> [u8; 2] {
    [8, key]
}

/// Tin server gửi ngược (DeviceMessage): CLIPBOARD(0) = u32 độ dài + UTF-8; ACK_CLIPBOARD(1) = u64; UHID_OUTPUT(2) = u16 id, u16 size, dữ liệu.
#[derive(Debug, PartialEq)]
enum DevMsg {
    Clipboard(String),
    Other,
}

const MAX_CLIP_IN: usize = 1 << 20;

/// Đọc đúng một tin. `Ok(None)` = loại tin lạ (không biết độ dài nên không đọc tiếp được).
fn read_dev_msg<R: Read>(r: &mut R) -> std::io::Result<Option<DevMsg>> {
    let mut t = [0u8; 1];
    r.read_exact(&mut t)?;
    match t[0] {
        0 => {
            let mut l = [0u8; 4];
            r.read_exact(&mut l)?;
            let n = u32::from_be_bytes(l) as usize;
            if n > MAX_CLIP_IN {
                return Ok(None);
            }
            let mut b = vec![0u8; n];
            r.read_exact(&mut b)?;
            Ok(Some(DevMsg::Clipboard(String::from_utf8_lossy(&b).into_owned())))
        }
        1 => {
            let mut b = [0u8; 8];
            r.read_exact(&mut b)?;
            Ok(Some(DevMsg::Other))
        }
        2 => {
            let mut h = [0u8; 4];
            r.read_exact(&mut h)?;
            let mut b = vec![0u8; u16::from_be_bytes([h[2], h[3]]) as usize];
            r.read_exact(&mut b)?;
            Ok(Some(DevMsg::Other))
        }
        _ => Ok(None),
    }
}

/// Clipboard điện thoại → máy tính: số thứ tự tin + nội dung mới nhất, kèm Condvar để chờ tin mới.
#[derive(Default)]
struct ClipState {
    seq: u64,
    text: String,
}
type Clip = Arc<(Mutex<ClipState>, Condvar)>;

// ───────────────────────── Kênh ─────────────────────────

pub struct Ctl {
    adb: Adb,
    serial: String,
    port: u16,
    stream: Mutex<TcpStream>,
    alive: Arc<AtomicBool>,
    server: Mutex<Option<Child>>,
    clip: Clip,
}

impl Ctl {
    pub fn is_alive(&self) -> bool {
        self.alive.load(Ordering::SeqCst)
    }

    fn send(&self, bytes: &[u8]) -> bool {
        if !self.is_alive() {
            return false;
        }
        let ok = lock(&self.stream).write_all(bytes).is_ok();
        if !ok {
            self.alive.store(false, Ordering::SeqCst);
        }
        ok
    }

    pub fn touch(&self, act: Act, x: i32, y: i32, w: u16, h: u16) -> bool {
        self.send(&touch_msg(act, x, y, w, h))
    }

    pub fn key(&self, code: i32) -> bool {
        self.send(&key_msgs(code))
    }

    /// Phím kèm Ctrl/Shift/Alt (Ctrl+A, Ctrl+C...).
    pub fn key_meta(&self, code: i32, meta: u32) -> bool {
        self.send(&key_meta_msgs(code, meta))
    }

    /// Gửi GET_CLIPBOARD và đợi server trả clipboard (tối đa `wait`). None = không có phản hồi.
    fn fetch_clipboard(&self, key: u8, wait: Duration) -> Option<String> {
        let (m, cv) = &*self.clip;
        let start = lock(m).seq;
        if !self.send(&get_clipboard_msg(key)) {
            return None;
        }
        let g = lock(m);
        let (g, _) = cv.wait_timeout_while(g, wait, |s| s.seq == start).unwrap_or_else(|e| e.into_inner());
        (g.seq != start).then(|| g.text.clone())
    }

    /// Chép đoạn đang chọn trên điện thoại (bấm COPY hoặc CUT) và trả nội dung để đặt vào clipboard máy tính.
    /// Server có thể đọc clipboard trước khi COPY xong: nếu nội dung y hệt lần trước thì đợi một chút rồi đọc lại một lần.
    pub fn copy(&self, cut: bool) -> Option<String> {
        let before = lock(&self.clip.0).text.clone();
        let first = self.fetch_clipboard(if cut { 2 } else { 1 }, Duration::from_millis(1500))?;
        if first != before {
            return Some(first);
        }
        thread::sleep(Duration::from_millis(120));
        Some(self.fetch_clipboard(0, Duration::from_millis(800)).unwrap_or(first))
    }

    /// Gõ một chuỗi vào ô nhập đang focus trên điện thoại. ASCII thường → INJECT_TEXT (từng đoạn ≤300 byte);
    /// có ký tự khác (tiếng Việt, emoji), xuống dòng hay ký tự điều khiển → đặt clipboard rồi dán.
    pub fn text(&self, s: &str) -> bool {
        if s.is_empty() {
            return true;
        }
        if s.chars().all(|c| c.is_ascii() && !c.is_ascii_control()) {
            let mut rest = s;
            while !rest.is_empty() {
                let (head, tail) = rest.split_at(rest.len().min(300)); // toàn ASCII nên cắt ở byte nào cũng hợp lệ
                match text_msg(head) {
                    Some(m) if self.send(&m) => {}
                    _ => return false,
                }
                rest = tail;
            }
            true
        } else {
            paste_msg(s).is_some_and(|m| self.send(&m))
        }
    }

    /// Đóng kết nối (server tự thoát khi mất socket điều khiển), diệt tiến trình adb và gỡ `adb forward`.
    pub fn shutdown(&self) {
        self.alive.store(false, Ordering::SeqCst);
        let _ = lock(&self.stream).shutdown(Shutdown::Both);
        if let Some(mut c) = lock(&self.server).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
        let _ = self.adb.run(
            &["-s", &self.serial, "forward", "--remove", &format!("tcp:{}", self.port)],
            Duration::from_secs(4),
        );
    }

    /// Chạy nền (mất ~1–2 giây): thất bại thì trả lỗi để phía trên dùng đường dự phòng.
    pub fn start(adb: &Adb, serial: &str) -> Result<Arc<Ctl>, String> {
        push_jar(adb, serial)?;

        let scid = {
            let t = std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.subsec_nanos() ^ (d.as_secs() as u32).rotate_left(13))
                .unwrap_or(1);
            (t ^ std::process::id().rotate_left(7)) & 0x7fff_ffff
        };
        let socket = format!("scrcpy_{scid:08x}");

        let cmd = format!(
            "CLASSPATH={REMOTE_JAR} app_process / com.genymobile.scrcpy.Server {SERVER_VERSION} scid={scid:08x} \
log_level=info video=false audio=false control=true tunnel_forward=true cleanup=false power_on=false \
clipboard_autosync=false send_device_meta=false 2>&1"
        );
        let mut server = adb
            .spawn_session(&["-s", serial, "shell", &cmd], true)
            .map_err(|e| e.to_string())?;

        // Giữ vài dòng log cuối của server để báo lỗi dễ hiểu và để bạn đọc trong terminal khi cần.
        let log = Arc::new(Mutex::new(Vec::<String>::new()));
        if let Some(out) = server.stdout.take() {
            let log = log.clone();
            let _ = thread::Builder::new().name("lumir-ctl-log".into()).spawn(move || {
                for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                    eprintln!("[lumir/scrcpy-server] {line}");
                    let mut l = lock(&log);
                    l.push(line);
                    if l.len() > 8 {
                        l.remove(0);
                    }
                }
            });
        }

        let fail = |server: &mut Child, adb: &Adb, port: Option<u16>, why: String| -> String {
            let _ = server.kill();
            let _ = server.wait();
            if let Some(p) = port {
                let _ = adb.run(&["-s", serial, "forward", "--remove", &format!("tcp:{p}")], Duration::from_secs(4));
            }
            let tail = lock(&log).join(" | ");
            if tail.is_empty() { why } else { format!("{why} ({tail})") }
        };

        let port = match adb
            .run(&["-s", serial, "forward", "tcp:0", &format!("localabstract:{socket}")], SHELL_TIMEOUT)
            .ok()
            .and_then(|o| o.trim().parse::<u16>().ok())
        {
            Some(p) => p,
            None => return Err(fail(&mut server, adb, None, "adb forward failed".into())),
        };

        // Server cần ~0,5–1,5 giây để lên và mở socket: thử lại cho tới khi nhận được byte "dummy".
        let addr = SocketAddr::from(([127, 0, 0, 1], port));
        let deadline = Instant::now() + Duration::from_secs(8);
        let stream = loop {
            if let Ok(Some(status)) = server.try_wait() {
                return Err(fail(&mut server, adb, Some(port), format!("server exited ({status})")));
            }
            if let Ok(mut s) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) {
                let _ = s.set_read_timeout(Some(Duration::from_millis(600)));
                let mut b = [0u8; 1];
                if matches!(s.read(&mut b), Ok(1)) {
                    let _ = s.set_read_timeout(None);
                    let _ = s.set_nodelay(true);
                    break s;
                }
            }
            if Instant::now() > deadline {
                return Err(fail(&mut server, adb, Some(port), "server did not accept the control connection".into()));
            }
            thread::sleep(Duration::from_millis(100));
        };

        // Server gửi tin ngược (clipboard…): luôn phải đọc để socket không đầy, và biết khi nào nó đóng.
        // Tin CLIPBOARD (trả lời GET_CLIPBOARD khi bấm Ctrl+C trên điện thoại) được lưu lại cho `copy`.
        let alive = Arc::new(AtomicBool::new(true));
        let clip: Clip = Arc::new((Mutex::new(ClipState::default()), Condvar::new()));
        if let Ok(mut r) = stream.try_clone() {
            let alive = alive.clone();
            let clip = clip.clone();
            let _ = thread::Builder::new().name("lumir-ctl-read".into()).spawn(move || {
                loop {
                    match read_dev_msg(&mut r) {
                        Ok(Some(DevMsg::Clipboard(text))) => {
                            let (m, cv) = &*clip;
                            let mut g = lock(m);
                            g.seq += 1;
                            g.text = text;
                            cv.notify_all();
                        }
                        Ok(Some(DevMsg::Other)) => {}
                        Ok(None) => {
                            // Loại tin không biết: bỏ phân tích nhưng vẫn xả socket cho tới khi nó đóng.
                            let mut buf = [0u8; 4096];
                            while matches!(r.read(&mut buf), Ok(n) if n > 0) {}
                            break;
                        }
                        Err(_) => break,
                    }
                }
                alive.store(false, Ordering::SeqCst);
            });
        }
        Ok(Arc::new(Ctl {
            adb: adb.clone(),
            serial: serial.to_string(),
            port,
            stream: Mutex::new(stream),
            alive,
            server: Mutex::new(Some(server)),
            clip,
        }))
    }
}

/// Đẩy jar lên máy nếu chưa có bản đúng kích thước (tên file có kèm phiên bản nên không bao giờ lẫn bản cũ).
/// Hai nơi (điều khiển + video) cùng gọi lúc khởi động: khoá lại để không đẩy jar chồng lên nhau.
static PUSH_LOCK: Mutex<()> = Mutex::new(());

pub(crate) fn push_jar(adb: &Adb, serial: &str) -> Result<(), String> {
    let _guard = PUSH_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let want = SERVER_JAR.len().to_string();
    let have = adb
        .run(&["-s", serial, "shell", &format!("wc -c < {REMOTE_JAR} 2>/dev/null")], SHELL_TIMEOUT)
        .unwrap_or_default();
    if have.trim() == want {
        return Ok(());
    }
    let local = std::env::temp_dir().join(format!("lumir-scrcpy-server-{SERVER_VERSION}.jar"));
    std::fs::write(&local, SERVER_JAR).map_err(|e| format!("cannot write temp jar: {e}"))?;
    let local_s = local.to_string_lossy().to_string();
    adb.run(&["-s", serial, "push", &local_s, REMOTE_JAR], Duration::from_secs(20))
        .map(|_| ())
        .map_err(|e| format!("adb push failed: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn touch_layout() {
        let m = touch_msg(Act::Down, 540, 1200, 1080, 2400);
        assert_eq!(m.len(), 32);
        assert_eq!(&m[0..2], &[2, 0]);
        assert_eq!(&m[2..10], &(-2i64).to_be_bytes());
        assert_eq!(&m[10..14], &540i32.to_be_bytes());
        assert_eq!(&m[14..18], &1200i32.to_be_bytes());
        assert_eq!(&m[18..22], &[0x04, 0x38, 0x09, 0x60]); // 1080, 2400
        assert_eq!(&m[22..24], &[0xFF, 0xFF]);
        assert_eq!(&m[24..32], &[0u8; 8]);
        let up = touch_msg(Act::Up, 1, 2, 3, 4);
        assert_eq!((up[1], &up[22..24]), (1, &[0u8, 0][..]));
        assert_eq!(touch_msg(Act::Move, 0, 0, 1, 1)[1], 2);
    }

    #[test]
    fn key_layout() {
        let m = key_msgs(4);
        assert_eq!(&m[0..6], &[0, 0, 0, 0, 0, 4]); // KEYCODE_BACK, ACTION_DOWN
        assert_eq!(&m[14..20], &[0, 1, 0, 0, 0, 4]); // ACTION_UP
        assert_eq!(m.len(), 28);
    }

    #[test]
    fn jar_is_embedded() {
        assert!(SERVER_JAR.len() > 50_000 && &SERVER_JAR[0..2] == b"PK");
    }
}

#[cfg(test)]
mod kbd_tests {
    use super::*;

    #[test]
    fn key_with_meta_layout() {
        let m = key_meta_msgs(29, 0x1000 | 0x2000);
        assert_eq!(m[0], 0);
        assert_eq!(m[1], ACTION_DOWN);
        assert_eq!(&m[2..6], &29i32.to_be_bytes());
        assert_eq!(&m[6..10], &[0, 0, 0, 0]); // repeat
        assert_eq!(&m[10..14], &0x3000u32.to_be_bytes());
        assert_eq!(m[15], ACTION_UP);
        assert_eq!(&m[24..28], &0x3000u32.to_be_bytes());
    }

    #[test]
    fn text_message_limits() {
        let m = text_msg("abc").unwrap();
        assert_eq!(m, vec![1, 0, 0, 0, 3, b'a', b'b', b'c']);
        assert!(text_msg("").is_none());
        assert!(text_msg(&"a".repeat(301)).is_none());
        assert!(text_msg(&"a".repeat(300)).is_some());
    }

    #[test]
    fn paste_message_layout() {
        let m = paste_msg("Việt").unwrap();
        assert_eq!(m[0], 9);
        assert_eq!(&m[1..9], &[0u8; 8]); // sequence 0
        assert_eq!(m[9], 1); // paste
        let n = u32::from_be_bytes([m[10], m[11], m[12], m[13]]) as usize;
        assert_eq!(n, "Việt".len());
        assert_eq!(&m[14..], "Việt".as_bytes());
        assert!(paste_msg("").is_none());
    }
}

#[cfg(test)]
mod clip_tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn get_clipboard_layout() {
        assert_eq!(get_clipboard_msg(1), [8, 1]);
        assert_eq!(get_clipboard_msg(2), [8, 2]);
    }

    #[test]
    fn device_messages() {
        let text = "Việt Nam";
        let mut v = vec![0u8];
        v.extend_from_slice(&(text.len() as u32).to_be_bytes());
        v.extend_from_slice(text.as_bytes());
        v.push(1); // ACK_CLIPBOARD
        v.extend_from_slice(&7u64.to_be_bytes());
        v.extend_from_slice(&[2, 0, 1, 0, 3, 9, 9, 9]); // UHID_OUTPUT id=1 size=3
        v.push(77); // loại lạ
        let mut r = Cursor::new(v);
        assert_eq!(read_dev_msg(&mut r).unwrap(), Some(DevMsg::Clipboard(text.into())));
        assert_eq!(read_dev_msg(&mut r).unwrap(), Some(DevMsg::Other));
        assert_eq!(read_dev_msg(&mut r).unwrap(), Some(DevMsg::Other));
        assert_eq!(read_dev_msg(&mut r).unwrap(), None);
        assert!(read_dev_msg(&mut r).is_err()); // hết dữ liệu
    }

    #[test]
    fn oversized_clipboard_is_rejected() {
        let mut v = vec![0u8];
        v.extend_from_slice(&((MAX_CLIP_IN as u32) + 1).to_be_bytes());
        assert_eq!(read_dev_msg(&mut Cursor::new(v)).unwrap(), None);
    }
}