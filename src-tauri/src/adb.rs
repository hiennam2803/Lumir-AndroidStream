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
/// `adb connect` tới máy không với tới được có thể chờ rất lâu: tự cắt sớm.
const T_CONNECT: Duration = Duration::from_secs(12);

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

/// Một dịch vụ mDNS: tên instance, loại dịch vụ (`_adb-tls-connect._tcp`, `_adb-tls-pairing._tcp`...), địa chỉ `IP:cổng`.
#[derive(Debug, Clone, PartialEq)]
pub struct MdnsEntry {
    pub name: String,
    pub service: String,
    pub addr: String,
}

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
    /// Resolve only the application-bundled ADB. Release builds never consult PATH,
    /// LUMIR_ADB, or a machine-wide Android SDK installation.
    /// In development, the checked-in src-tauri/adb directory remains available.
    pub fn locate(resource_dir: Option<&Path>) -> Self {
        let bundled = resource_dir
            .map(|r| r.join("adb").join(ADB_NAME))
            .or_else(|| {
                std::env::current_exe()
                    .ok()
                    .and_then(|exe| exe.parent().map(|dir| dir.join("resources").join("adb").join(ADB_NAME)))
            });

        #[cfg(debug_assertions)]
        let candidate = bundled
            .filter(|p| p.is_file())
            .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")).join("adb").join(ADB_NAME));

        #[cfg(not(debug_assertions))]
        let candidate = bundled.unwrap_or_else(|| {
            // Last-resort diagnostic location only; never ask Windows to search PATH.
            std::env::current_dir()
                .unwrap_or_default()
                .join("resources")
                .join("adb")
                .join(ADB_NAME)
        });

        // Store an absolute path even when a development fallback was used.
        let program = candidate.canonicalize().unwrap_or(candidate);
        eprintln!("[LUMIR][ADB] Resolved executable: {}", program.display());
        if !program.is_file() {
            eprintln!("[LUMIR][ADB] ERROR: bundled executable does not exist: {}", program.display());
        }
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
        // ADB loads its Windows USB support DLLs from its executable directory.
        // Using the same directory as cwd also makes relative ADB sidecar lookups stable.
        if let Some(dir) = self.program.parent().filter(|p| !p.as_os_str().is_empty()) {
            c.current_dir(dir);
        }
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

    /// `adb connect IP:cổng` (Wi-Fi/LAN). adb luôn thoát với mã 0 kể cả khi thất bại nên phải đọc nội dung trả về.
    pub fn connect(&self, addr: &str) -> Result<()> {
        let out = self.run(&["connect", addr], T_CONNECT)?;
        parse_connect(&out).map_err(AdbError::Failed)
    }

    /// `adb mdns services` (đầu ra thô): các dịch vụ adb mà máy tính nhìn thấy trong mạng (Gỡ lỗi không dây của điện thoại).
    pub fn mdns_services_raw(&self) -> Result<String> {
        self.run(&["mdns", "services"], T_DEVICES)
    }

    /// `adb mdns check`: mDNS của adb có đang chạy không (lỗi nếu không).
    pub fn mdns_check(&self) -> Result<String> {
        self.run(&["mdns", "check"], T_DEVICES).map(|s| s.trim().to_string())
    }

    /// `adb disconnect IP:cổng`.
    pub fn disconnect_addr(&self, addr: &str) -> Result<()> {
        self.run(&["disconnect", addr], T_DEVICES).map(|_| ())
    }

    pub fn get_state(&self, serial: &str) -> Result<String> {
        Ok(self.run(&["-s", serial, "get-state"], T_DEVICES)?.trim().to_string())
    }

    /// Chạy `adb <args>` dài hạn (luồng video): trả tiến trình với stdout/stderr dạng pipe, không timeout.
    pub fn spawn_piped(&self, args: &[&str]) -> Result<std::process::Child> {
        self.command()
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| self.spawn_err(e))
    }

    /// Tiến trình dài hạn hai chiều (phiên shell lâu dài, theo dõi hướng xoay): stdin là pipe để ghi lệnh,
    /// stderr bỏ đi (không ai đọc thì pipe đầy sẽ làm treo adb), stdout là pipe nếu `read_out`.
    pub fn spawn_session(&self, args: &[&str], read_out: bool) -> Result<std::process::Child> {
        self.command()
            .args(args)
            .stdin(Stdio::piped())
            .stdout(if read_out { Stdio::piped() } else { Stdio::null() })
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| self.spawn_err(e))
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

/// Serial của thiết bị Wi-Fi/LAN: `IPv4:cổng` (vd. `192.168.1.42:5555`). Không nhận emulator hay mục mDNS `_adb-tls`.
pub fn is_lan_serial(serial: &str) -> bool {
    let Some((host, port)) = serial.rsplit_once(':') else { return false };
    let octets: Vec<&str> = host.split('.').collect();
    octets.len() == 4
        && octets
            .iter()
            .all(|o| !o.is_empty() && o.len() <= 3 && o.chars().all(|c| c.is_ascii_digit()) && o.parse::<u32>().is_ok_and(|n| n < 256))
        && port.parse::<u16>().is_ok_and(|p| p > 0)
}

/// Đầu ra của `adb connect`: "connected to X" / "already connected to X" là thành công, còn lại là lỗi (trả dòng lỗi).
pub fn parse_connect(out: &str) -> std::result::Result<(), String> {
    let line = out.lines().map(str::trim).find(|l| !l.is_empty() && !l.starts_with('*')).unwrap_or("");
    let low = line.to_lowercase();
    if low.starts_with("connected to") || low.starts_with("already connected to") {
        Ok(())
    } else if line.is_empty() {
        Err("No response from adb connect".into())
    } else {
        Err(line.to_string())
    }
}

/// Đầu ra `adb mdns services`: mỗi dòng "tên<TAB>loại<TAB>IP:cổng"; dòng tiêu đề bị bỏ.
pub fn parse_mdns(out: &str) -> Vec<MdnsEntry> {
    out.lines()
        .filter_map(|l| {
            let mut it = l.split_whitespace();
            let (name, service, addr) = (it.next()?, it.next()?, it.next()?);
            if !service.starts_with('_') {
                return None;
            }
            Some(MdnsEntry { name: name.into(), service: service.trim_end_matches('.').into(), addr: addr.into() })
        })
        .collect()
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
    fn locate_uses_absolute_bundled_path() {
        let root = std::env::temp_dir().join(format!("lumir adb bundle {}", std::process::id()));
        let adb_dir = root.join("adb");
        std::fs::create_dir_all(&adb_dir).unwrap();
        let executable = adb_dir.join(ADB_NAME);
        std::fs::write(&executable, b"test executable placeholder").unwrap();

        let adb = Adb::locate(Some(&root));
        assert!(adb.program().is_absolute());
        assert_eq!(adb.program(), executable.canonicalize().unwrap());

        let _ = std::fs::remove_dir_all(root);
    }

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

#[cfg(test)]
mod lan_tests {
    use super::*;

    #[test]
    fn lan_serials() {
        assert!(is_lan_serial("192.168.1.42:5555"));
        assert!(is_lan_serial("10.0.0.5:37123"));
        assert!(!is_lan_serial("R5CW31ABXYZ"));
        assert!(!is_lan_serial("emulator-5554"));
        assert!(!is_lan_serial("adb-XYZ._adb-tls-connect._tcp"));
        assert!(!is_lan_serial("192.168.1.42"));
        assert!(!is_lan_serial("999.1.1.1:5555"));
        assert!(!is_lan_serial("192.168.1.42:0"));
        assert!(!is_lan_serial("192.168.1.42:99999"));
    }

    #[test]
    fn connect_output() {
        assert!(parse_connect("connected to 192.168.1.42:5555\n").is_ok());
        assert!(parse_connect("already connected to 192.168.1.42:5555").is_ok());
        assert!(parse_connect("* daemon started successfully *\nconnected to 10.0.0.2:5555").is_ok());
        let e = parse_connect("failed to connect to '192.168.1.9:5555': Connection refused\n").unwrap_err();
        assert!(e.contains("Connection refused"));
        assert!(parse_connect("").is_err());
    }
}

#[cfg(test)]
mod mdns_parse_tests {
    use super::*;

    #[test]
    fn parses_services() {
        let out = "List of discovered mdns services\nadb-R5CW31ABXYZ-AbCdEf\t_adb-tls-connect._tcp.\t192.168.1.42:37123\nadb-R5CW31ABXYZ\t_adb-tls-pairing._tcp.\t192.168.1.42:41234\n";
        let v = parse_mdns(out);
        assert_eq!(v.len(), 2);
        assert_eq!(v[0].name, "adb-R5CW31ABXYZ-AbCdEf");
        assert_eq!(v[0].service, "_adb-tls-connect._tcp");
        assert_eq!(v[0].addr, "192.168.1.42:37123");
        assert!(parse_mdns("List of discovered mdns services\n").is_empty());
    }
}