//! Quản lý thiết bị USB và máy trạng thái kết nối.
//! Không phụ thuộc Tauri: `commands.rs` mới là nơi phát event ra frontend.
//!
//! Trạng thái hiện có: Disconnected, Unauthorized, Connecting, Connected, Error.
//! (Detecting / Streaming / Reconnecting sẽ thêm khi có pipeline video.)

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, MutexGuard};

use serde::Serialize;

use crate::adb::{self, Adb, AdbEntry, AdbError};

pub const MSG_UNAUTHORIZED: &str = "Unlock the phone and allow USB debugging.";
pub const MSG_OFFLINE: &str = "Device is offline. Unplug the cable and plug it in again.";
pub const MSG_OLD_ANDROID: &str = "Android 5.0 or newer is required.";
pub const MSG_NOT_CONNECTED: &str = "Device is not connected.";
pub const MSG_OFFLINE_LAN: &str = "Device is offline. Check the Wi-Fi connection and connect again.";
pub const MSG_LAN_REFUSED: &str = "Connection refused. Turn on Wireless debugging on the phone and check the port.";
pub const MSG_LAN_TIMEOUT: &str = "Timed out. Check the IP address and that the phone is on the same Wi-Fi.";
/// scrcpy-server yêu cầu tối thiểu Android 5.0 (API 21).
const MIN_SDK: u32 = 21;

// ───────────────────────── Dữ liệu gửi ra frontend ─────────────────────────

#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Disconnected,
    Unauthorized,
    Connecting,
    Connected,
    Error,
}

/// Kiểu kết nối: cáp USB hay Wi-Fi/LAN (serial dạng `IP:cổng`).
#[derive(Serialize, Clone, Copy, PartialEq, Eq, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Usb,
    Lan,
}

#[derive(Serialize, Clone, PartialEq, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DeviceView {
    pub id: String,
    pub serial: String,
    pub kind: Kind,
    pub name: String,
    pub model: String,
    pub android: Option<String>,
    pub resolution: Option<String>,
    pub usb_speed: Option<String>,
    pub status: Status,
    pub message: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AdbStatus {
    pub ready: bool,
    pub version: Option<String>,
    pub path: String,
    pub error: Option<String>,
    /// not_found | timeout | failed
    pub error_code: Option<String>,
}

/// Thông tin đọc được từ điện thoại khi kết nối.
#[derive(Clone, Debug, PartialEq)]
pub struct Details {
    pub manufacturer: String,
    pub model: String,
    pub android: String,
    pub sdk: Option<u32>,
    pub resolution: Option<String>,
    pub usb_speed: Option<String>,
}

// ───────────────────────── Registry ─────────────────────────

#[derive(Default)]
pub struct Registry {
    /// Thông tin đã đọc (giữ lại khi ngắt kết nối, bỏ khi rút cáp).
    known: HashMap<String, Details>,
    connected: HashSet<String>,
    connecting: HashSet<String>,
    errors: HashMap<String, String>,
}

impl Registry {
    /// Đồng bộ với danh sách adb vừa quét. Trả về tên các thiết bị đang kết nối mà vừa mất.
    pub fn reconcile(&mut self, entries: &[AdbEntry]) -> Vec<String> {
        let state_of: HashMap<&str, &str> =
            entries.iter().map(|e| (e.serial.as_str(), e.state.as_str())).collect();

        let gone: Vec<String> = self
            .connected
            .iter()
            .filter(|s| state_of.get(s.as_str()).copied() != Some("device"))
            .cloned()
            .collect();
        let mut lost = Vec::new();
        for s in gone {
            lost.push(self.known.get(&s).map(|d| d.model.clone()).unwrap_or_else(|| s.clone()));
            self.connected.remove(&s);
        }

        self.connecting.retain(|s| state_of.contains_key(s.as_str()));
        self.known.retain(|s, _| state_of.contains_key(s.as_str()));
        // Lỗi chỉ có nghĩa khi thiết bị còn ở trạng thái "device"; nếu không, trạng thái adb quyết định.
        self.errors.retain(|s, _| state_of.get(s.as_str()).copied() == Some("device"));
        lost
    }

    /// Xóa mọi phiên (khi adb lỗi). Trả về tên thiết bị đang kết nối bị mất.
    pub fn clear(&mut self) -> Vec<String> {
        let lost = self
            .connected
            .iter()
            .map(|s| self.known.get(s).map(|d| d.model.clone()).unwrap_or_else(|| s.clone()))
            .collect();
        *self = Registry::default();
        lost
    }
}

pub fn build_views(entries: &[AdbEntry], reg: &Registry) -> Vec<DeviceView> {
    entries
        .iter()
        .map(|e| {
            let details = reg.known.get(&e.serial);
            let (status, message) = match e.state.as_str() {
                "unauthorized" => (Status::Unauthorized, Some(MSG_UNAUTHORIZED.to_string())),
                "offline" => (
                    Status::Error,
                    Some((if adb::is_lan_serial(&e.serial) { MSG_OFFLINE_LAN } else { MSG_OFFLINE }).to_string()),
                ),
                "authorizing" | "connecting" => (Status::Connecting, None),
                "device" => {
                    if reg.connected.contains(&e.serial) {
                        (Status::Connected, None)
                    } else if reg.connecting.contains(&e.serial) {
                        (Status::Connecting, None)
                    } else if let Some(m) = reg.errors.get(&e.serial) {
                        (Status::Error, Some(m.clone()))
                    } else {
                        (Status::Disconnected, None)
                    }
                }
                other => (Status::Error, Some(format!("Unsupported ADB state: {other}"))),
            };
            let name = details
                .map(|d| d.model.clone())
                .or_else(|| e.model.clone())
                .unwrap_or_else(|| e.serial.clone());
            let model = match details {
                Some(d) if !d.manufacturer.is_empty() => format!("{} {}", d.manufacturer, d.model),
                _ => e.device.clone().unwrap_or_else(|| e.serial.clone()),
            };
            DeviceView {
                id: e.serial.clone(),
                serial: e.serial.clone(),
                kind: if adb::is_lan_serial(&e.serial) { Kind::Lan } else { Kind::Usb },
                name,
                model,
                android: details.map(|d| d.android.clone()),
                resolution: details.and_then(|d| d.resolution.clone()),
                usb_speed: details.and_then(|d| d.usb_speed.clone()),
                status,
                message,
            }
        })
        .collect()
}

// ───────────────────────── Trạng thái dùng chung ─────────────────────────

pub struct AppState {
    pub adb: Adb,
    reg: Mutex<Registry>,
    version: Mutex<Option<String>>,
    last_devices: Mutex<String>,
    last_adb: Mutex<String>,
    /// label cửa sổ điện thoại → serial thiết bị
    phones: Mutex<HashMap<String, String>>,
}

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

impl AppState {
    pub fn new(adb: Adb) -> Self {
        Self {
            adb,
            reg: Mutex::new(Registry::default()),
            version: Mutex::new(None),
            last_devices: Mutex::new(String::new()),
            last_adb: Mutex::new(String::new()),
            phones: Mutex::new(HashMap::new()),
        }
    }

    pub fn register_phone(&self, label: &str, serial: &str) {
        lock(&self.phones).insert(label.to_string(), serial.to_string());
    }
    pub fn unregister_phone(&self, label: &str) {
        lock(&self.phones).remove(label);
    }
    pub fn phone_serial(&self, label: &str) -> Option<String> {
        lock(&self.phones).get(label).cloned()
    }

    pub fn set_version(&self, v: Option<String>) {
        *lock(&self.version) = v;
    }

    /// true nếu `json` khác lần phát trước (để không bắn event thừa).
    pub fn devices_changed(&self, json: &str) -> bool {
        changed(&self.last_devices, json)
    }
    pub fn adb_changed(&self, json: &str) -> bool {
        changed(&self.last_adb, json)
    }
}

fn changed(slot: &Mutex<String>, json: &str) -> bool {
    let mut cur = lock(slot);
    if *cur == json {
        false
    } else {
        *cur = json.to_string();
        true
    }
}

pub fn adb_status(st: &AppState, err: Option<&AdbError>) -> AdbStatus {
    AdbStatus {
        ready: err.is_none(),
        version: lock(&st.version).clone(),
        path: st.adb.program().display().to_string(),
        error: err.map(|e| e.to_string()),
        error_code: err.map(|e| e.code().to_string()),
    }
}

// ───────────────────────── Thao tác ─────────────────────────

pub struct ScanOutcome {
    pub devices: Vec<DeviceView>,
    pub lost: Vec<String>,
}

/// Quét thiết bị USB và Wi-Fi/LAN (`IP:cổng`) qua `adb devices -l` và cập nhật registry.
pub fn scan(st: &AppState) -> Result<ScanOutcome, AdbError> {
    let usb: Vec<AdbEntry> = st.adb.devices()?.into_iter().filter(|e| e.usb || adb::is_lan_serial(&e.serial)).collect();
    let mut reg = lock(&st.reg);
    let lost = reg.reconcile(&usb);
    Ok(ScanOutcome { devices: build_views(&usb, &reg), lost })
}

/// ADB không dùng được: bỏ hết phiên, trả tên các thiết bị bị mất.
pub fn reset(st: &AppState) -> Vec<String> {
    lock(&st.reg).clear()
}

/// Bước 1 của kết nối: đánh dấu "Connecting" để UI hiện ngay.
pub fn begin_connect(st: &AppState, serial: &str) -> Result<(), String> {
    let mut reg = lock(&st.reg);
    if reg.connected.contains(serial) {
        return Err("Device is already connected.".into());
    }
    if reg.connecting.contains(serial) {
        return Err("Connection is already in progress.".into());
    }
    reg.errors.remove(serial);
    reg.connecting.insert(serial.to_string());
    Ok(())
}

/// Bước 2: kiểm tra quyền, đọc thông tin máy. Thành công → Connected, thất bại → Error (kèm lý do).
pub fn finish_connect(st: &AppState, serial: &str) -> Result<(), String> {
    let result = probe(&st.adb, serial);
    let mut reg = lock(&st.reg);
    reg.connecting.remove(serial);
    match result {
        Ok(d) => {
            reg.errors.remove(serial);
            reg.known.insert(serial.to_string(), d);
            reg.connected.insert(serial.to_string());
            Ok(())
        }
        Err(msg) => {
            reg.errors.insert(serial.to_string(), msg.clone());
            Err(msg)
        }
    }
}

pub fn disconnect(st: &AppState, serial: &str) {
    // Sau này: dừng pipeline video/input của thiết bị này trước khi gỡ khỏi tập kết nối.
    let mut reg = lock(&st.reg);
    reg.connected.remove(serial);
    reg.connecting.remove(serial);
    reg.errors.remove(serial);
}

/// Phím điều hướng / phần cứng được phép gửi (danh sách trắng, không nhận mã tùy ý từ frontend).
pub fn key_code(name: &str) -> Option<u32> {
    match name {
        "back" => Some(4),
        "home" => Some(3),
        "recents" => Some(187), // KEYCODE_APP_SWITCH
        "volume_up" => Some(24),
        "volume_down" => Some(25),
        "power" => Some(26),
        _ => None,
    }
}

/// Gửi một phím tới điện thoại (tạm thời qua `adb shell input keyevent`;
/// sẽ chuyển sang kênh điều khiển riêng khi có pipeline stream).
pub fn send_key(st: &AppState, serial: &str, key: &str) -> Result<(), String> {
    let code = key_code(key).ok_or_else(|| format!("Unknown key: {key}"))?;
    if !lock(&st.reg).connected.contains(serial) {
        return Err(MSG_NOT_CONNECTED.into());
    }
    st.adb
        .shell(serial, &format!("input keyevent {code}"))
        .map(|_| ())
        .map_err(map_adb_err)
}

/// "1080×2400" / "1080x2400" → (1080, 2400).
pub fn parse_resolution(r: &str) -> Option<(u32, u32)> {
    let (w, h) = r.split_once(['×', 'x'])?;
    let (w, h) = (w.trim().parse::<u32>().ok()?, h.trim().parse::<u32>().ok()?);
    (w > 1 && h > 1).then_some((w, h))
}

/// Thông tin thiết bị nếu đang ở trạng thái Connected (không gọi adb).
pub fn connected_view(st: &AppState, serial: &str) -> Option<DeviceView> {
    let reg = lock(&st.reg);
    if !reg.connected.contains(serial) {
        return None;
    }
    let e = AdbEntry {
        serial: serial.to_string(),
        state: "device".into(),
        model: None,
        device: None,
        usb: true,
    };
    build_views(&[e], &reg).into_iter().next()
}

/// Label cửa sổ Tauri hợp lệ (chỉ chữ, số, `-`, `_`) cho cửa sổ điện thoại của một serial.
pub fn phone_label(serial: &str) -> String {
    let safe: String = serial
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
    format!("phone-{safe}")
}

/// Kích thước cửa sổ điện thoại (logical px) theo tỉ lệ màn hình; khung chứa vừa với 640×760.
/// Cộng thêm (khớp phone.css): chiều ngang 12 + 12 + thanh nút dọc 52 + 12; chiều dọc: thanh tiêu đề 34 + lề trên 8 + lề dưới 12.
pub fn phone_window_size(resolution: Option<&str>) -> (f64, f64) {
    let ar = resolution
        .and_then(|r| {
            let (w, h) = r.split_once(['×', 'x'])?;
            let (w, h) = (w.trim().parse::<f64>().ok()?, h.trim().parse::<f64>().ok()?);
            (w > 0.0 && h > 0.0).then_some(w / h)
        })
        .unwrap_or(9.0 / 20.0);
    let (pw, ph) = if ar <= 1.0 {
        (640.0 * ar, 640.0)
    } else {
        (760.0, 760.0 / ar)
    };
    ((pw + 12.0 + 12.0 + 52.0 + 12.0).round(), (ph + 34.0 + 8.0 + 12.0).round())
}

/// Thông báo dễ hiểu cho lỗi `adb connect` (Windows và Linux in lỗi khác nhau).
pub fn friendly_connect_error(msg: &str) -> String {
    let m = msg.to_lowercase();
    if m.contains("refused") || m.contains("10061") {
        MSG_LAN_REFUSED.into()
    } else if m.contains("timed out") || m.contains("timeout") || m.contains("10060") || m.contains("no route") || m.contains("unreachable") {
        MSG_LAN_TIMEOUT.into()
    } else {
        msg.to_string()
    }
}

fn map_adb_err(e: AdbError) -> String {
    let m = e.to_string();
    if m.to_lowercase().contains("unauthorized") {
        MSG_UNAUTHORIZED.to_string()
    } else {
        m
    }
}

fn probe(adb: &Adb, serial: &str) -> Result<Details, String> {
    let state = adb.get_state(serial).map_err(map_adb_err)?;
    match state.as_str() {
        "device" => {}
        "unauthorized" => return Err(MSG_UNAUTHORIZED.into()),
        "offline" => return Err(MSG_OFFLINE.into()),
        other => return Err(format!("Unsupported ADB state: {other}")),
    }

    let out = adb.shell(serial, adb::PROBE_CMD).map_err(map_adb_err)?;
    let s = adb::parse_sections(&out);
    let get = |k: &str| s.get(k).map(|v| v.trim().to_string()).unwrap_or_default();

    let sdk = get("sdk").parse::<u32>().ok();
    if matches!(sdk, Some(v) if v < MIN_SDK) {
        return Err(MSG_OLD_ANDROID.into());
    }
    Ok(Details {
        manufacturer: get("mfr"),
        model: get("model"),
        android: get("ver"),
        sdk,
        resolution: adb::parse_wm_size(&get("wm")),
        usb_speed: adb::parse_usb_speed(&get("usb")),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(serial: &str, state: &str) -> AdbEntry {
        AdbEntry {
            serial: serial.into(),
            state: state.into(),
            model: Some("Pixel 8 Pro".into()),
            device: Some("husky".into()),
            usb: true,
        }
    }

    fn details() -> Details {
        Details {
            manufacturer: "Google".into(),
            model: "Pixel 8 Pro".into(),
            android: "14".into(),
            sdk: Some(34),
            resolution: Some("1344×2992".into()),
            usb_speed: Some("USB 3.x (5 Gbps)".into()),
        }
    }

    #[test]
    fn views_map_adb_states() {
        let reg = Registry::default();
        let v = build_views(
            &[entry("A", "device"), entry("B", "unauthorized"), entry("C", "offline")],
            &reg,
        );
        assert_eq!(v[0].status, Status::Disconnected);
        assert_eq!(v[0].name, "Pixel 8 Pro");
        assert_eq!(v[0].model, "husky");
        assert_eq!(v[1].status, Status::Unauthorized);
        assert_eq!(v[1].message.as_deref(), Some(MSG_UNAUTHORIZED));
        assert_eq!(v[2].status, Status::Error);
    }

    #[test]
    fn connected_view_has_details() {
        let mut reg = Registry::default();
        reg.known.insert("A".into(), details());
        reg.connected.insert("A".into());
        let v = build_views(&[entry("A", "device")], &reg);
        assert_eq!(v[0].status, Status::Connected);
        assert_eq!(v[0].model, "Google Pixel 8 Pro");
        assert_eq!(v[0].android.as_deref(), Some("14"));
        assert_eq!(v[0].resolution.as_deref(), Some("1344×2992"));
        assert_eq!(v[0].usb_speed.as_deref(), Some("USB 3.x (5 Gbps)"));
    }

    #[test]
    fn unplugging_connected_device_is_reported_lost() {
        let mut reg = Registry::default();
        reg.known.insert("A".into(), details());
        reg.connected.insert("A".into());
        let lost = reg.reconcile(&[]);
        assert_eq!(lost, vec!["Pixel 8 Pro".to_string()]);
        assert!(reg.connected.is_empty());
        assert!(reg.known.is_empty());
    }

    #[test]
    fn going_offline_drops_session() {
        let mut reg = Registry::default();
        reg.connected.insert("A".into());
        let lost = reg.reconcile(&[entry("A", "offline")]);
        assert_eq!(lost, vec!["A".to_string()]);
        assert_eq!(build_views(&[entry("A", "offline")], &reg)[0].status, Status::Error);
    }

    #[test]
    fn stale_error_cleared_when_device_state_changes() {
        let mut reg = Registry::default();
        reg.errors.insert("A".into(), "x".into());
        reg.reconcile(&[entry("A", "unauthorized")]);
        assert!(reg.errors.is_empty());
        // Sau khi người dùng cấp quyền: về Disconnected, không còn Error cũ.
        reg.reconcile(&[entry("A", "device")]);
        assert_eq!(build_views(&[entry("A", "device")], &reg)[0].status, Status::Disconnected);
    }

    #[test]
    fn connecting_flow_and_conflicts() {
        let st = AppState::new(Adb::with_program("/definitely/not/adb"));
        begin_connect(&st, "A").unwrap();
        assert!(begin_connect(&st, "A").is_err(), "không connect đôi");
        let v = build_views(&[entry("A", "device")], &lock(&st.reg));
        assert_eq!(v[0].status, Status::Connecting);

        // adb không có → finish thất bại, ghi lỗi, thoát khỏi Connecting
        let err = finish_connect(&st, "A").unwrap_err();
        assert_eq!(err, "ADB not found");
        let v = build_views(&[entry("A", "device")], &lock(&st.reg));
        assert_eq!(v[0].status, Status::Error);
        assert_eq!(v[0].message.as_deref(), Some("ADB not found"));

        // thử lại được, và disconnect dọn sạch
        begin_connect(&st, "A").unwrap();
        disconnect(&st, "A");
        let v = build_views(&[entry("A", "device")], &lock(&st.reg));
        assert_eq!(v[0].status, Status::Disconnected);
    }

    #[test]
    fn dedupe_only_fires_on_change() {
        let st = AppState::new(Adb::with_program("adb"));
        assert!(st.devices_changed("[]"));
        assert!(!st.devices_changed("[]"));
        assert!(st.devices_changed("[1]"));
    }

    #[test]
    fn serializes_camel_case_for_frontend() {
        let reg = Registry::default();
        let v = build_views(&[entry("A", "device")], &reg);
        let j = serde_json::to_string(&v[0]).unwrap();
        assert!(j.contains("\"usbSpeed\":null"), "{j}");
        assert!(j.contains("\"status\":\"disconnected\""), "{j}");
    }

    #[test]
    fn key_whitelist() {
        assert_eq!(key_code("back"), Some(4));
        assert_eq!(key_code("home"), Some(3));
        assert_eq!(key_code("recents"), Some(187));
        assert_eq!(key_code("power"), Some(26));
        assert_eq!(key_code("reboot"), None);
        assert_eq!(key_code("4; rm -rf /"), None, "không nhận chuỗi tùy ý");
    }

    #[test]
    fn send_key_requires_connection_and_known_key() {
        let st = AppState::new(Adb::with_program("/definitely/not/adb"));
        assert_eq!(send_key(&st, "A", "back").unwrap_err(), MSG_NOT_CONNECTED);
        assert!(send_key(&st, "A", "nope").unwrap_err().starts_with("Unknown key"));
    }

    #[test]
    fn parses_resolution() {
        assert_eq!(parse_resolution("1080×2400"), Some((1080, 2400)));
        assert_eq!(parse_resolution("1080x2400"), Some((1080, 2400)));
        assert_eq!(parse_resolution("rác"), None);
    }

    #[test]
    fn phone_labels_are_valid() {
        assert_eq!(phone_label("WOR4CIHM69XGV4LR"), "phone-WOR4CIHM69XGV4LR");
        assert_eq!(phone_label("192.168.1.5:5555"), "phone-192_168_1_5_5555");
    }

    #[test]
    fn phone_window_sizes() {
        let (w, h) = phone_window_size(Some("1080×2400"));
        assert_eq!((w, h), (376.0, 694.0)); // 288 + 88 , 640 + 54
        assert!(w < h, "máy dọc → cửa sổ cao");
        let (w, h) = phone_window_size(Some("2400×1080"));
        assert!(w > h, "máy ngang → cửa sổ rộng");
        assert_eq!(phone_window_size(None), phone_window_size(Some("1080x2400")));
        assert_eq!(phone_window_size(Some("rác")), phone_window_size(None));
    }

    #[test]
    fn phone_registry() {
        let st = AppState::new(Adb::with_program("adb"));
        st.register_phone("phone-A", "A");
        assert_eq!(st.phone_serial("phone-A").as_deref(), Some("A"));
        st.unregister_phone("phone-A");
        assert_eq!(st.phone_serial("phone-A"), None);
    }

    #[cfg(unix)]
    #[test]
    fn send_key_runs_keyevent_on_the_device() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("lumir-fake-key-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("adb");
        std::fs::write(&script, "#!/bin/sh\necho \"$@\" > \"$(dirname \"$0\")/args\"\n").unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let st = AppState::new(Adb::with_program(&script));
        lock(&st.reg).connected.insert("R5CW".into());
        send_key(&st, "R5CW", "recents").unwrap();
        let args = std::fs::read_to_string(dir.join("args")).unwrap();
        assert_eq!(args.trim(), "-s R5CW shell input keyevent 187");
        assert!(connected_view(&st, "R5CW").is_some());
        assert!(connected_view(&st, "other").is_none());
        let _ = std::fs::remove_dir_all(dir);
    }

    #[cfg(unix)]
    #[test]
    fn probe_with_fake_adb_script() {
        use std::os::unix::fs::PermissionsExt;
        let dir = std::env::temp_dir().join(format!("lumir-fake-adb-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let script = dir.join("adb");
        std::fs::write(
            &script,
            r#"#!/bin/sh
# giả lập: adb -s SERIAL get-state | adb -s SERIAL shell CMD
case "$3" in
  get-state) echo device ;;
  shell) printf '@@mfr\nSamsung\n@@model\nSM-S911B\n@@ver\n14\n@@sdk\n34\n@@wm\nPhysical size: 1080x2340\n@@usb\nhigh-speed\n' ;;
esac
"#,
        )
        .unwrap();
        std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755)).unwrap();

        let st = AppState::new(Adb::with_program(&script));
        begin_connect(&st, "R5CW").unwrap();
        finish_connect(&st, "R5CW").unwrap();
        let v = build_views(&[entry("R5CW", "device")], &lock(&st.reg));
        assert_eq!(v[0].status, Status::Connected);
        assert_eq!(v[0].name, "SM-S911B");
        assert_eq!(v[0].model, "Samsung SM-S911B");
        assert_eq!(v[0].resolution.as_deref(), Some("1080×2340"));
        assert_eq!(v[0].usb_speed.as_deref(), Some("USB 2.0 (480 Mbps)"));
        let _ = std::fs::remove_dir_all(dir);
    }
}

#[cfg(test)]
mod lan_tests {
    use super::*;

    fn lan_entry(state: &str) -> AdbEntry {
        AdbEntry { serial: "192.168.1.42:5555".into(), state: state.into(), model: None, device: None, usb: false }
    }

    #[test]
    fn lan_view_kind_and_offline_message() {
        let reg = Registry::default();
        let v = build_views(&[lan_entry("offline")], &reg);
        assert_eq!(v[0].kind, Kind::Lan);
        assert_eq!(v[0].message.as_deref(), Some(MSG_OFFLINE_LAN));
        let j = serde_json::to_string(&v[0]).unwrap();
        assert!(j.contains("\"kind\":\"lan\""), "{j}");
    }

    #[test]
    fn friendly_errors() {
        assert_eq!(friendly_connect_error("failed to connect to '1.2.3.4:5555': Connection refused"), MSG_LAN_REFUSED);
        assert_eq!(friendly_connect_error("cannot connect to 1.2.3.4:5555: (10060)"), MSG_LAN_TIMEOUT);
        assert_eq!(friendly_connect_error("ADB timed out"), MSG_LAN_TIMEOUT);
        assert_eq!(friendly_connect_error("something else"), "something else");
    }
}
