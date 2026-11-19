//! Lớp giao tiếp với `adb`: tìm file thực thi, chạy lệnh có timeout, phân tích đầu ra.
//! Cố ý không phụ thuộc Tauri để có thể test độc lập.

use std::collections::HashMap;
use std::fmt;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

/// Không bật cửa sổ console khi chạy adb từ app GUI.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
const ADB_NAME: &str = "adb.exe";
#[cfg(not(windows))]
const ADB_NAME: &str = "adb";

const T_DEVICES: Duration = Duration::from_secs(4);
const T_SHELL: Duration = Duration::from_secs(6);
const T_SERVER: Duration = Duration::from_secs(10);

// ───────────────────────── Lỗi ─────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub enum AdbError {
    /// Không tìm thấy file adb (đường dẫn đã thử).
    NotFound(String),
    Timeout,
    Failed(String),
}

impl AdbError {
    /// Mã ngắn để frontend chọn thông báo.
    pub fn code(&self) -> &'static str {
        match self {
            AdbError::NotFound(_) => "not_found",
            AdbError::Timeout => "timeout",
            AdbError::Failed(_) => "failed",
        }
    }
}

impl fmt::Display for AdbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            AdbError::NotFound(_) => write!(f, "ADB not found"),
            AdbError::Timeout => write!(f, "ADB timed out"),
            AdbError::Failed(m) => write!(f, "{m}"),
        }
    }
}

impl std::error::Error for AdbError {}

pub type Result<T> = std::result::Result<T, AdbError>;

// ───────────────────────── Kiểu dữ liệu ─────────────────────────

/// Một dòng của `adb devices -l`.
#[derive(Debug, Clone, PartialEq)]
pub struct AdbEntry {
    pub serial: String,
    /// device | offline | unauthorized | authorizing | connecting | bootloader | recovery | ...
    pub state: String,
    pub model: Option<String>,
    pub device: Option<String>,
    /// true nếu là thiết bị cắm cáp USB (không phải Wi-Fi/emulator).
    pub usb: bool,
}

#[derive(Debug, Clone)]
pub struct Adb {
    program: PathBuf,
}

impl Adb {
    /// Thứ tự tìm: biến môi trường LUMIR_ADB → resource_dir/adb → cạnh file exe → (dev) src-tauri/adb → PATH.
    pub fn locate(resource_dir: Option<&Path>) -> Self {
        if let Some(p) = std::env::var_os("LUMIR_ADB") {
            let p = PathBuf::from(p);
            if p.is_file() {
                return Self { program: p };
            }
        }
        let mut candidates: Vec<PathBuf> = Vec::new();
        if let Some(r) = resource_dir {
            candidates.push(r.join("adb").join(ADB_NAME));
        }
        if let Ok(exe) = std::env::current_exe() {
            if let Some(dir) = exe.parent() {
                candidates.push(dir.join("adb").join(ADB_NAME));
                candidates.push(dir.join(ADB_NAME));
            }
        }
        #[cfg(debug_assertions)]
        candidates.push(Path::new(env!("CARGO_MANIFEST_DIR")).join("adb").join(ADB_NAME));

        let program = candidates
            .into_iter()
            .find(|p| p.is_file())
            .unwrap_or_else(|| PathBuf::from(ADB_NAME)); // rơi về PATH
        Self { program }
    }

    #[cfg(test)]
    pub fn with_program(program: impl Into<PathBuf>) -> Self {
        Self { program: program.into() }
    }

    pub fn program(&self) -> &Path {
        &self.program
    }

    fn command(&self) -> Command {
        #[allow(unused_mut)] // cần `mut` trên Windows (creation_flags)
        let mut c = Command::new(&self.program);
        #[cfg(windows)]
        c.creation_flags(CREATE_NO_WINDOW);
        c
    }

    fn spawn_err(&self, e: std::io::Error) -> AdbError {
        if e.kind() == std::io::ErrorKind::NotFound {
            AdbError::NotFound(self.program.display().to_string())
        } else {
            AdbError::Failed(e.to_string())
        }
    }

    /// Chạy `adb <args>`, trả stdout. Có timeout; quá hạn thì kill tiến trình.
    pub fn run(&self, args: &[&str], timeout: Duration) -> Result<String> {
        let mut child = self
            .command()
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| self.spawn_err(e))?;

        let rx_out = drain(child.stdout.take());
        let rx_err = drain(child.stderr.take());

        let deadline = Instant::now() + timeout;
        let status = loop {
            match child.try_wait() {
                Ok(Some(s)) => break s,
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(AdbError::Timeout);
                    }
                    thread::sleep(Duration::from_millis(10));
                }
                Err(e) => return Err(AdbError::Failed(e.to_string())),
            }
        };

        let out = collect(rx_out);
        let err = collect(rx_err);
        if status.success() {
            Ok(out)
        } else {
            let msg = [err.trim(), out.trim()]
                .into_iter()
                .find(|s| !s.is_empty())
                .map(str::to_owned)
                .unwrap_or_else(|| format!("adb exited with {status}"));
            Err(AdbError::Failed(msg))
        }
    }

    /// `adb start-server`. Daemon giữ pipe mở nên không đọc stdio (tránh treo).
    pub fn start_server(&self) -> Result<()> {
        let mut child = self
            .command()
            .arg("start-server")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| self.spawn_err(e))?;
        let deadline = Instant::now() + T_SERVER;
        loop {
            match child.try_wait() {
                Ok(Some(s)) if s.success() => return Ok(()),
                Ok(Some(s)) => return Err(AdbError::Failed(format!("adb start-server exited with {s}"))),
                Ok(None) => {
                    if Instant::now() >= deadline {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(AdbError::Timeout);
                    }
                    thread::sleep(Duration::from_millis(20));
                }
                Err(e) => return Err(AdbError::Failed(e.to_string())),
            }
        }
    }

    pub fn kill_server(&self) -> Result<()> {
        self.run(&["kill-server"], T_SERVER).map(|_| ())
    }

    /// Dòng đầu của `adb version`, vd. "Android Debug Bridge version 1.0.41".
    pub fn version(&self) -> Result<String> {
        let out = self.run(&["version"], T_DEVICES)?;
        Ok(out.lines().next().unwrap_or("").trim().to_string())
    }

    pub fn devices(&self) -> Result<Vec<AdbEntry>> {
        Ok(parse_devices(&self.run(&["devices", "-l"], T_DEVICES)?))
    }

    pub fn get_state(&self, serial: &str) -> Result<String> {
        Ok(self.run(&["-s", serial, "get-state"], T_DEVICES)?.trim().to_string())
    }

    pub fn shell(&self, serial: &str, cmd: &str) -> Result<String> {
        self.run(&["-s", serial, "shell", cmd], T_SHELL)
    }
}

fn drain<R: Read + Send + 'static>(pipe: Option<R>) -> mpsc::Receiver<Vec<u8>> {
    let (tx, rx) = mpsc::channel();
    match pipe {
        Some(mut p) => {
            thread::spawn(move || {
                let mut buf = Vec::new();
                let _ = p.read_to_end(&mut buf);
                let _ = tx.send(buf);
            });
        }
        None => {
            let _ = tx.send(Vec::new());
        }
    }
    rx
}

fn collect(rx: mpsc::Receiver<Vec<u8>>) -> String {
    let bytes = rx.recv_timeout(Duration::from_millis(500)).unwrap_or_default();
    String::from_utf8_lossy(&bytes).into_owned()
}

// ───────────────────────── Phân tích đầu ra ─────────────────────────

const KNOWN_STATES: &[&str] = &[
    "device",
    "offline",
    "unauthorized",
    "authorizing",
    "connecting",
    "bootloader",
    "recovery",
    "sideload",
    "rescue",
    "host",
];

fn is_usb_serial(serial: &str) -> bool {
    !(serial.contains(':') || serial.starts_with("emulator-") || serial.contains("_adb-tls"))
}

pub fn parse_devices(out: &str) -> Vec<AdbEntry> {
    out.lines()
        .filter_map(|line| {
            let line = line.trim();
            if line.is_empty() || line.starts_with("List of devices") || line.starts_with('*') {
                return None;
            }
            let mut it = line.split_whitespace();
            let serial = it.next()?.to_string();
            let state = it.next()?.to_string();
            if !KNOWN_STATES.contains(&state.as_str()) {
                return None; // vd. dòng cảnh báo "adb server version ... doesn't match"
            }
            let (mut model, mut device, mut has_usb) = (None, None, false);
            for tok in it {
                if let Some(v) = tok.strip_prefix("model:") {
                    model = Some(v.replace('_', " "));
                } else if let Some(v) = tok.strip_prefix("device:") {
                    device = Some(v.to_string());
                } else if tok.starts_with("usb:") {
                    has_usb = true;
                }
            }
            let usb = has_usb || is_usb_serial(&serial);
            Some(AdbEntry { serial, state, model, device, usb })
        })
        .collect()
}

/// Lệnh shell đọc mọi thông tin cần thiết trong MỘT lần gọi adb (nhanh hơn gọi từng lệnh).
/// `; true` ở cuối để cờ thoát luôn là 0 dù `cat` không đọc được.
pub const PROBE_CMD: &str = "echo @@mfr; getprop ro.product.manufacturer; \
echo @@model; getprop ro.product.model; \
echo @@ver; getprop ro.build.version.release; \
echo @@sdk; getprop ro.build.version.sdk; \
echo @@wm; wm size; \
echo @@usb; cat /sys/class/udc/*/current_speed 2>/dev/null; true";

/// Tách đầu ra có đánh dấu `@@tên` thành các phần.
pub fn parse_sections(out: &str) -> HashMap<String, String> {
    let mut map: HashMap<String, String> = HashMap::new();
    let mut cur: Option<String> = None;
    for line in out.lines() {
        let line = line.trim_end_matches('\r');
        if let Some(name) = line.strip_prefix("@@") {
            let name = name.trim().to_string();
            map.entry(name.clone()).or_default();
            cur = Some(name);
        } else if let Some(name) = &cur {
            let slot = map.get_mut(name).expect("section exists");
            if !slot.is_empty() {
                slot.push('\n');
            }
            slot.push_str(line);
        }
    }
    map
}

/// "Physical size: 1080x2340" → "1080×2340".
pub fn parse_wm_size(s: &str) -> Option<String> {
    let line = s
        .lines()
        .find(|l| l.contains("Physical size:"))
        .or_else(|| s.lines().find(|l| l.contains("size:")))?;
    let v = line.split(':').nth(1)?.trim();
    let (w, h) = v.split_once('x')?;
    let (w, h) = (w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?);
    Some(format!("{w}×{h}"))
}

/// Tốc độ liên kết USB thực tế mà điện thoại báo (UDC current_speed).
pub fn parse_usb_speed(s: &str) -> Option<String> {
    s.lines().find_map(|l| match l.trim() {
        "low-speed" => Some("USB 1.0 (1.5 Mbps)"),
        "full-speed" => Some("USB 1.1 (12 Mbps)"),
        "high-speed" => Some("USB 2.0 (480 Mbps)"),
        "super-speed" => Some("USB 3.x (5 Gbps)"),
        "super-speed-plus" => Some("USB 3.x (10 Gbps+)"),
        _ => None,
    })
    .map(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_devices_list() {
        let out = "\
* daemon not running; starting now at tcp:5037
* daemon started successfully
List of devices attached
R5CW31ABXYZ            device usb:1-2 product:dm1qxxx model:SM_S911B device:dm1q transport_id:1
1A2B3C4D5E6F           unauthorized usb:1-3 transport_id:2
9f8e7d6c5b4a           offline usb:1-4 transport_id:3
192.168.1.42:5555      device product:x model:Tab_P11 device:y transport_id:4
emulator-5554          device product:sdk model:sdk_gphone device:emu transport_id:5
adb server version (41) doesn't match this client (40); killing...

";
        let v = parse_devices(out);
        assert_eq!(v.len(), 5);
        assert_eq!(v[0].serial, "R5CW31ABXYZ");
        assert_eq!(v[0].state, "device");
        assert_eq!(v[0].model.as_deref(), Some("SM S911B"));
        assert_eq!(v[0].device.as_deref(), Some("dm1q"));
        assert!(v[0].usb);
        assert_eq!(v[1].state, "unauthorized");
        assert!(v[1].usb);
        assert_eq!(v[2].state, "offline");
        assert!(!v[3].usb, "ip:port là Wi-Fi");
        assert!(!v[4].usb, "emulator không phải USB");
    }

    #[test]
    fn empty_list() {
        assert!(parse_devices("List of devices attached\n\n").is_empty());
        assert!(parse_devices("").is_empty());
    }

    #[test]
    fn parses_probe_sections() {
        let out = "@@mfr\nsamsung\n@@model\nSM-S911B\n@@ver\n14\n@@sdk\n34\n@@wm\nPhysical size: 1080x2340\n@@usb\nsuper-speed\n";
        let s = parse_sections(out);
        assert_eq!(s["mfr"].trim(), "samsung");
        assert_eq!(s["model"].trim(), "SM-S911B");
        assert_eq!(s["sdk"].trim().parse::<u32>().unwrap(), 34);
        assert_eq!(parse_wm_size(&s["wm"]).as_deref(), Some("1080×2340"));
        assert_eq!(parse_usb_speed(&s["usb"]).as_deref(), Some("USB 3.x (5 Gbps)"));
    }

    #[test]
    fn probe_handles_missing_usb_and_crlf() {
        let out = "@@wm\r\nPhysical size: 1344x2992\r\nOverride size: 1080x2400\r\n@@usb\r\n";
        let s = parse_sections(out);
        assert_eq!(parse_wm_size(&s["wm"]).as_deref(), Some("1344×2992"));
        assert_eq!(parse_usb_speed(&s["usb"]), None);
    }

    #[test]
    fn usb_speed_labels() {
        assert_eq!(parse_usb_speed("high-speed\n").as_deref(), Some("USB 2.0 (480 Mbps)"));
        assert_eq!(parse_usb_speed("unknown\nsuper-speed-plus").as_deref(), Some("USB 3.x (10 Gbps+)"));
        assert_eq!(parse_usb_speed("unknown"), None);
    }

    #[test]
    fn wm_size_garbage() {
        assert_eq!(parse_wm_size(""), None);
        assert_eq!(parse_wm_size("Physical size: abc"), None);
    }

    #[cfg(unix)]
    #[test]
    fn run_success_failure_timeout_notfound() {
        let echo = Adb::with_program("echo");
        assert_eq!(echo.run(&["hi"], Duration::from_secs(2)).unwrap().trim(), "hi");

        let sh = Adb::with_program("sh");
        let e = sh.run(&["-c", "echo boom >&2; exit 3"], Duration::from_secs(2)).unwrap_err();
        assert_eq!(e, AdbError::Failed("boom".into()));

        let sleep = Adb::with_program("sleep");
        let t0 = Instant::now();
        assert_eq!(sleep.run(&["5"], Duration::from_millis(200)).unwrap_err(), AdbError::Timeout);
        assert!(t0.elapsed() < Duration::from_secs(2));

        let none = Adb::with_program("/definitely/not/adb");
        assert!(matches!(none.run(&["x"], Duration::from_secs(1)), Err(AdbError::NotFound(_))));
    }
}
