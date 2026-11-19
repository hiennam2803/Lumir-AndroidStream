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
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder, WindowEvent};

use crate::adb::AdbError;
use crate::device::{self, AdbStatus, AppState, DeviceView};

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

#[tauri::command]
pub async fn disconnect_device(app: AppHandle, state: Shared<'_>, serial: String) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || {
        device::disconnect(&st, &serial);
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
        .min_inner_size(300.0, 440.0)
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

    let (st2, label2) = (st.clone(), label.clone());
    win.on_window_event(move |e| {
        if let WindowEvent::Destroyed = e {
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
#[tauri::command]
pub async fn send_key(state: Shared<'_>, serial: String, key: String) -> Result<(), String> {
    let st = state.inner().clone();
    blocking(move || device::send_key(&st, &serial, &key)).await
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
