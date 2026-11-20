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
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::adb::Adb;

/// Phiên bản server PHẢI khớp tuyệt đối với jar (server từ chối nếu lệch).
pub const SERVER_VERSION: &str = "3.3.3";
const SERVER_JAR: &[u8] = include_bytes!("../scrcpy/scrcpy-server-v3.3.3.jar");
const REMOTE_JAR: &str = "/data/local/tmp/lumir-scrcpy-3.3.3.jar";

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

// ───────────────────────── Kênh ─────────────────────────

pub struct Ctl {
    adb: Adb,
    serial: String,
    port: u16,
    stream: Mutex<TcpStream>,
    alive: Arc<AtomicBool>,
    server: Mutex<Option<Child>>,
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

        // Server có thể gửi tin ngược (clipboard…): phải đọc bỏ để socket không đầy, và biết khi nào nó đóng.
        let alive = Arc::new(AtomicBool::new(true));
        if let Ok(mut r) = stream.try_clone() {
            let alive = alive.clone();
            let _ = thread::Builder::new().name("lumir-ctl-read".into()).spawn(move || {
                let mut buf = [0u8; 4096];
                while matches!(r.read(&mut buf), Ok(n) if n > 0) {}
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
        }))
    }
}

/// Đẩy jar lên máy nếu chưa có bản đúng kích thước (tên file có kèm phiên bản nên không bao giờ lẫn bản cũ).
fn push_jar(adb: &Adb, serial: &str) -> Result<(), String> {
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
