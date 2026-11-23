//! Cầu nối Tauri: command (frontend → Rust) và event (Rust → frontend).
//!
//! Events:
//!   devices-changed  Vec<DeviceView>   danh sách USB thay đổi
//!   adb-status       AdbStatus         adb sẵn sàng / lỗi
//!   device-lost      String            thiết bị đang kết nối bị rút / mất

use std::sync::Arc;
use std::thread;
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{AppHandle, Emitter, LogicalSize, Manager, PhysicalPosition, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::adb::{self, AdbError};
use crate::device::{self, AdbStatus, AppState, DeviceView};
use crate::input::{Inputs, Phase};
use crate::keymap;
use crate::stream::{Quality, Streams};

type Shared<'a> = State<'a, Arc<AppState>>;

/// Chu kỳ quét. Sau này có thể thay bằng `adb track-devices` để phản hồi tức thì.
const POLL_INTERVAL: Duration = Duration::from_millis(1500);

fn emit_devices(app: &AppHandle, st: &AppState, devices: &[DeviceView]) {
    if let Ok(json) = serde_json::to_string(devices) {
        if st.devices_changed(&json) {
            let _ = app.emit("devices-changed", devices);
        }
    }
}

fn emit_adb(app: &AppHandle, st: &AppState, status: &AdbStatus) {
    if let Ok(json) = serde_json::to_string(status) {
        if st.adb_changed(&json) {
            let _ = app.emit("adb-status", status);
        }
    }
}

/// Quét thiết bị, phát event nếu có thay đổi, trả danh sách hiện tại.
pub fn publish(app: &AppHandle, st: &AppState) -> Result<Vec<DeviceView>, String> {
    match device::scan(st) {
        Ok(out) => {
            emit_adb(app, st, &device::adb_status(st, None));
            emit_devices(app, st, &out.devices);
            for name in out.lost {
                let _ = app.emit("device-lost", name);
            }
            Ok(out.devices)
        }
        Err(e) => {
            // adb hỏng: dừng mọi phiên an toàn, báo lỗi, trả danh sách rỗng.
            let lost = device::reset(st);
            emit_adb(app, st, &device::adb_status(st, Some(&e)));
            emit_devices(app, st, &[]);
            for name in lost {
                let _ = app.emit("device-lost", name);
            }
            Err(e.to_string())
        }
    }
}

pub fn spawn_poller(app: AppHandle, st: Arc<AppState>) {
    thread::Builder::new()
        .name("lumir-device-poller".into())
        .spawn(move || {
            if let Err(e) = st.adb.start_server() {
                eprintln!("[LUMIR] adb start-server: {e}");
            }
            st.set_version(st.adb.version().ok());
            loop {
                let _ = publish(&app, &st);
                thread::sleep(POLL_INTERVAL);
            }
        })
        .expect("không thể tạo luồng quét thiết bị");
}

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    // adb là tiến trình ngoài, có thể chậm: không chạy trên luồng UI/async.
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn adb_status(state: Shared<'_>) -> Result<AdbStatus, String> {
    let st = state.inner().clone();
    blocking(move || {
        Ok(match st.adb.version() {
            Ok(v) => {
                st.set_version(Some(v));
                device::adb_status(&st, None)
            }
            Err(e) => device::adb_status(&st, Some(&e)),
        })
    })
    .await
}

#[tauri::command]
pub async fn list_devices(app: AppHandle, state: Shared<'_>) -> Result<Vec<DeviceView>, String> {
    let st = state.inner().clone();
    blocking(move || publish(&app, &st)).await
}

#[tauri::command]
pub async fn connect_device(app: AppHandle, state: Shared<'_>, serial: String) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || {
        device::begin_connect(&st, &serial)?;
        let _ = publish(&app, &st); // UI hiện "Connecting" ngay
        let result = device::finish_connect(&st, &serial);
        let _ = publish(&app, &st); // Connected hoặc Error (kèm lý do)
        result
    })
    .await
}

/// Quét mạng bằng mDNS: các điện thoại đang bật Gỡ lỗi không dây (không cần biết IP trước).
#[tauri::command]
pub async fn discover_lan(state: Shared<'_>) -> Result<Vec<device::LanService>, String> {
    let st = state.inner().clone();
    blocking(move || device::discover_lan(&st)).await
}

/// Kết nối thiết bị qua Wi-Fi/LAN: `adb connect IP:cổng`, chờ adb thấy máy, rồi đọc thông tin như thiết bị USB.
#[tauri::command]
pub async fn connect_lan(app: AppHandle, state: Shared<'_>, host: String, port: u16) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || {
        let serial = format!("{host}:{port}");
        if !adb::is_lan_serial(&serial) {
            return Err("Enter a valid IP address and port.".to_string());
        }
        if device::connected_view(&st, &serial).is_some() {
            return Ok(()); // đã kết nối rồi
        }
        st.adb.connect(&serial).map_err(|e| device::friendly_connect_error(&e.to_string()))?;
        // Sau `adb connect` máy có thể ở trạng thái offline/connecting trong chốc lát: chờ tới khi sẵn sàng (tối đa ~3 giây).
        for _ in 0..15 {
            if matches!(st.adb.get_state(&serial).as_deref(), Ok("device") | Ok("unauthorized")) {
                break;
            }
            thread::sleep(Duration::from_millis(200));
        }
        device::begin_connect(&st, &serial)?;
        let _ = publish(&app, &st); // UI hiện "Connecting" ngay
        let result = device::finish_connect(&st, &serial);
        let _ = publish(&app, &st); // Connected hoặc Error (kèm lý do)
        result
    })
    .await
}

#[tauri::command]
pub async fn disconnect_device(
    app: AppHandle,
    state: Shared<'_>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
) -> Result<(), String> {
    let st = state.inner().clone();
    let inputs = inputs.inner().clone();
    blocking(move || {
        inputs.stop(&serial);
        device::disconnect(&st, &serial);
        if adb::is_lan_serial(&serial) {
            let _ = st.adb.disconnect_addr(&serial); // gỡ khỏi danh sách adb để không còn hiện "offline"
        }
        let _ = publish(&app, &st);
        Ok(())
    })
    .await
}

/// Khởi động lại ADB server (dùng khi adb bị treo hoặc không thấy thiết bị).
#[tauri::command]
pub async fn restart_adb(app: AppHandle, state: Shared<'_>) -> Result<AdbStatus, String> {
    let st = state.inner().clone();
    blocking(move || {
        let _ = st.adb.kill_server();
        st.adb.start_server().map_err(|e: AdbError| e.to_string())?;
        st.set_version(st.adb.version().ok());
        let _ = publish(&app, &st);
        Ok(device::adb_status(&st, None))
    })
    .await
}

// ───────────────────────── Cửa sổ điện thoại (Floating Stream) ─────────────────────────

#[derive(Serialize)]
pub struct PhoneContext {
    pub serial: String,
    pub device: Option<DeviceView>,
}

/// Mở (hoặc đưa lên trước) cửa sổ nổi của một thiết bị đang kết nối.
/// Kết nối nằm ở backend nên đóng/mở cửa sổ không làm gián đoạn phiên.
#[tauri::command]
pub async fn open_phone_window(app: AppHandle, state: Shared<'_>, serial: String) -> Result<(), String> {
    let st = state.inner().clone();
    let view = device::connected_view(&st, &serial)
        .ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let label = device::phone_label(&serial);

    if let Some(w) = app.get_webview_window(&label) {
        let _ = w.unminimize();
        let _ = w.show();
        let _ = w.set_focus();
        return Ok(());
    }

    let (w, h) = device::phone_window_size(view.resolution.as_deref());
    st.register_phone(&label, &serial);
    let win = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App("phone.html".into()))
        .title(format!("LUMIR — {}", view.name))
        .inner_size(w, h)
        .min_inner_size(300.0, 470.0)
        .decorations(false)
        .transparent(true)
        .always_on_top(true)
        .resizable(true)
        .center()
        .build()
        .map_err(|e| {
            st.unregister_phone(&label);
            e.to_string()
        })?;

    let (st2, label2, serial2) = (st.clone(), label.clone(), serial.clone());
    let streams = app.state::<Arc<Streams>>().inner().clone();
    let inputs = app.state::<Arc<Inputs>>().inner().clone();
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
            streams.stop(&label2); // đóng cửa sổ → dừng adb screenrecord
            inputs.stop(&serial2); // và phiên shell / theo dõi xoay của thiết bị
            st2.unregister_phone(&label2);
        }
    });
    Ok(())
}

/// Cửa sổ điện thoại hỏi: "tôi đang hiển thị thiết bị nào?"
#[tauri::command]
pub async fn phone_context(window: tauri::WebviewWindow, state: Shared<'_>) -> Result<PhoneContext, String> {
    let st = state.inner().clone();
    let serial = st
        .phone_serial(window.label())
        .ok_or_else(|| "Unknown phone window".to_string())?;
    let device = device::connected_view(&st, &serial);
    Ok(PhoneContext { serial, device })
}

/// Gửi phím điều hướng / phần cứng (back, home, recents, volume_up, volume_down, power).
/// Có phiên shell sẵn thì đi qua đó (không tốn thời gian khởi động adb), không thì chạy `adb shell` như trước.
#[tauri::command]
pub async fn send_key(state: Shared<'_>, inputs: State<'_, Arc<Inputs>>, serial: String, key: String) -> Result<(), String> {
    let st = state.inner().clone();
    let inputs = inputs.inner().clone();
    blocking(move || match (device::key_code(&key), inputs.get(&serial)) {
        (Some(code), Some(link)) => {
            if device::connected_view(&st, &serial).is_none() {
                return Err(device::MSG_NOT_CONNECTED.to_string());
            }
            // Kênh scrcpy → phiên shell → `adb shell` trực tiếp: phím không bao giờ "mất".
            link.key(&st.adb, code).or_else(|_| device::send_key(&st, &serial, &key))
        }
        _ => device::send_key(&st, &serial, &key),
    })
    .await
}

/// Phím từ bàn phím máy tính (Enter, Backspace, mũi tên, Ctrl+A/C/X/Z...). `code` là mã phím Android.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn input_key(
    state: Shared<'_>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
    code: u32,
    ctrl: bool,
    shift: bool,
    alt: bool,
) -> Result<(), String> {
    if code == 0 || code > 400 {
        return Err("Unknown key".to_string());
    }
    let st = state.inner().clone();
    device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    // META_SHIFT_ON|LEFT, META_ALT_ON|LEFT, META_CTRL_ON|LEFT của Android.
    let mut meta = 0u32;
    if shift {
        meta |= 0x1 | 0x40;
    }
    if alt {
        meta |= 0x2 | 0x10;
    }
    if ctrl {
        meta |= 0x1000 | 0x2000;
    }
    blocking(move || link.key_meta(&st.adb, code, meta)).await
}

/// Gõ chữ từ bàn phím máy tính vào ô nhập đang focus trên điện thoại (hỗ trợ cả tiếng Việt có dấu, emoji).
/// Frontend gọi tuần tự nên thứ tự các ký tự và phím (Backspace...) được giữ nguyên.
#[tauri::command]
pub async fn input_text(state: Shared<'_>, inputs: State<'_, Arc<Inputs>>, serial: String, text: String) -> Result<(), String> {
    if text.is_empty() {
        return Ok(());
    }
    if text.chars().count() > 20_000 {
        return Err("Text is too long".to_string());
    }
    let st = state.inner().clone();
    device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    blocking(move || link.text(&text)).await
}

/// Ctrl+C / Ctrl+X trên điện thoại: chép (hoặc cắt) đoạn đang chọn và trả nội dung để frontend đặt vào clipboard máy tính.
#[tauri::command]
pub async fn input_copy(state: Shared<'_>, inputs: State<'_, Arc<Inputs>>, serial: String, cut: bool) -> Result<String, String> {
    let st = state.inner().clone();
    device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    blocking(move || link.copy(cut)).await
}

/// Chạm bằng ngón số `pointer` (0..) cho ánh xạ phím: nhiều phím giữ cùng lúc = nhiều ngón. Cùng hệ toạ độ với `touch_event`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn touch_pointer(
    state: Shared<'_>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
    pointer: u32,
    phase: String,
    x: f64,
    y: f64,
    landscape: bool,
) -> Result<(), String> {
    if pointer >= 1000 {
        return Err("Unknown pointer".to_string());
    }
    let st = state.inner().clone();
    let phase = Phase::parse(&phase).ok_or_else(|| "Unknown touch phase".to_string())?;
    let view = device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    let res = view.resolution.as_deref().and_then(device::parse_resolution);
    // id 100+ để không trùng ngón của chuột (-2).
    blocking(move || link.touch_ptr(100 + i64::from(pointer), phase, x, y, res, landscape)).await
}

/// Chạm thời gian thực: phase = down | move | up, (x, y) chuẩn hoá 0..1 trên khung hình đang hiển thị.
/// Frontend gọi tuần tự (đợi lệnh trước xong mới gửi lệnh sau) nên thứ tự down → move → up được giữ nguyên.
/// Nhấc mọi ngón của ánh xạ phím đang chạm (thoát chế độ chơi / mất focus). Không cần thiết bị đang kết nối:
/// phải chạy được cả lúc rút cáp. Trả số ngón đã nhả.
#[tauri::command]
pub async fn touch_release_all(inputs: State<'_, Arc<Inputs>>, serial: String) -> Result<u32, String> {
    let Some(link) = inputs.get(&serial) else { return Ok(0) };
    blocking(move || Ok(link.release_pointers() as u32)).await
}

/// Gói ứng dụng đang ở foreground trên điện thoại (chuỗi rỗng nếu không xác định, vd. đang ở màn hình khoá).
/// Dùng để gắn profile Game Key Mapping với từng game.
#[tauri::command]
pub async fn foreground_app(state: Shared<'_>, serial: String) -> Result<String, String> {
    let st = state.inner().clone();
    device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    blocking(move || {
        // `; echo` để grep không khớp dòng nào (exit 1) cũng không bị adb coi là lỗi.
        let out = st
            .adb
            .shell(&serial, "dumpsys window 2>/dev/null | grep -E 'mCurrentFocus|mFocusedApp' | head -n 6; echo")
            .map_err(|e| e.to_string())?;
        Ok(keymap::parse_foreground(&out).unwrap_or_default())
    })
    .await
}

#[tauri::command]
pub async fn touch_event(
    state: Shared<'_>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
    phase: String,
    x: f64,
    y: f64,
    landscape: bool,
) -> Result<(), String> {
    let st = state.inner().clone();
    let phase = Phase::parse(&phase).ok_or_else(|| "Unknown touch phase".to_string())?;
    let view = device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    let res = view.resolution.as_deref().and_then(device::parse_resolution);
    blocking(move || link.touch(&st.adb, phase, x, y, res, landscape)).await
}

/// Cuộn chuột: vuốt từ (x, y) một đoạn `dy` (chuẩn hoá; âm = ngón tay đi lên = nội dung cuộn xuống).
#[tauri::command]
pub async fn touch_scroll(
    state: Shared<'_>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
    x: f64,
    y: f64,
    dy: f64,
    landscape: bool,
) -> Result<(), String> {
    let st = state.inner().clone();
    let view = device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    let link = inputs.get(&serial).unwrap_or_else(|| inputs.start(&st, &serial));
    let res = view.resolution.as_deref().and_then(device::parse_resolution);
    blocking(move || link.scroll(&st.adb, x, y, dy, res, landscape)).await
}

/// Máy xoay ngang/dọc → đổi cửa sổ điện thoại sang tỉ lệ tương ứng, giữ nguyên tâm cửa sổ.
#[tauri::command]
pub async fn fit_phone_window(window: tauri::WebviewWindow, state: Shared<'_>, landscape: bool) -> Result<(), String> {
    let st = state.inner().clone();
    let serial = st.phone_serial(window.label()).ok_or_else(|| "Unknown phone window".to_string())?;
    let view = device::connected_view(&st, &serial).ok_or_else(|| device::MSG_NOT_CONNECTED.to_string())?;
    if window.is_maximized().unwrap_or(false) || window.is_fullscreen().unwrap_or(false) {
        return Ok(()); // người dùng đã tự phóng to: để yên
    }
    let (w, h) = view
        .resolution
        .as_deref()
        .and_then(device::parse_resolution)
        .ok_or_else(|| "Unknown screen size".to_string())?;
    let (long, short) = (w.max(h), w.min(h));
    let res = if landscape { format!("{long}x{short}") } else { format!("{short}x{long}") };
    let (ww, wh) = device::phone_window_size(Some(&res));

    let pos = window.outer_position().map_err(|e| e.to_string())?;
    let old = window.outer_size().map_err(|e| e.to_string())?;
    let (cx, cy) = (f64::from(pos.x) + f64::from(old.width) / 2.0, f64::from(pos.y) + f64::from(old.height) / 2.0);
    window.set_size(LogicalSize::new(ww, wh)).map_err(|e| e.to_string())?;
    let new = window.outer_size().map_err(|e| e.to_string())?;
    window
        .set_position(PhysicalPosition::new(
            (cx - f64::from(new.width) / 2.0).round() as i32,
            (cy - f64::from(new.height) / 2.0).round() as i32,
        ))
        .map_err(|e| e.to_string())
}

/// Bắt đầu truyền hình ảnh màn hình tới cửa sổ gọi lệnh. Dữ liệu đi qua `on_frame` (xem stream.rs).
/// Gọi lại sẽ thay phiên cũ của cùng cửa sổ.
#[tauri::command]
pub async fn start_stream(
    window: tauri::WebviewWindow,
    state: Shared<'_>,
    streams: State<'_, Arc<Streams>>,
    inputs: State<'_, Arc<Inputs>>,
    serial: String,
    on_frame: Channel<InvokeResponseBody>,
    max_side: Option<u32>,
    bit_rate_mbps: Option<u32>,
    fps: Option<u32>,
) -> Result<(), String> {
    let st = state.inner().clone();
    if st.phone_serial(window.label()).as_deref() != Some(serial.as_str()) {
        return Err("Unknown phone window".into());
    }
    if device::connected_view(&st, &serial).is_none() {
        return Err(device::MSG_NOT_CONNECTED.into());
    }
    let link = inputs.start(&st, &serial); // phiên shell + theo dõi xoay + dò màn hình cảm ứng (chạy nền)
    streams.start(window.label(), st, serial, on_frame, link, Quality::new(max_side, bit_rate_mbps, fps));
    Ok(())
}

#[tauri::command]
pub fn stop_stream(window: tauri::WebviewWindow, streams: State<'_, Arc<Streams>>) {
    streams.stop(window.label());
}

#[tauri::command]
pub fn set_fullscreen(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window.set_fullscreen(on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn set_always_on_top(window: tauri::WebviewWindow, on: bool) -> Result<(), String> {
    window.set_always_on_top(on).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn focus_main_window(app: AppHandle) -> Result<(), String> {
    let w = app.get_webview_window("main").ok_or_else(|| "Main window not found".to_string())?;
    let _ = w.unminimize();
    let _ = w.show();
    w.set_focus().map_err(|e| e.to_string())
}

/// Đo vòng đi-về IPC (WebView → Rust → WebView) cho bảng Performance (`network_rtt`). Không làm gì khác.
#[tauri::command]
pub async fn ping() -> u8 {
    0
}