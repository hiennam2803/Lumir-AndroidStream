//! LUMIR — Phase 2: kết nối USB thật (ADB) + truyền hình ảnh màn hình (screenrecord H.264 → WebCodecs).
//! Điều khiển: phím điều hướng + chạm/vuốt/cuộn bằng chuột (evdev thời gian thực), tự xoay theo máy; chưa có bàn phím; LAN: bước 1 = kết nối bằng `adb connect IP:cổng` (chưa có ghép nối bằng mã).

mod adb;
mod commands;
mod ctl;
mod device;
mod h264;
mod input;
mod scvideo;
mod stream;

use std::sync::Arc;

use tauri::{LogicalSize, Manager};

/// Kích thước mặc định theo thiết kế là 1024x720; màn hình nhỏ (vd. 1366x768) thì thu lại cho vừa,
/// nhưng không nhỏ hơn mức tối thiểu 800x560 của giao diện.
fn fit_to_monitor(app: &tauri::App) {
    let Some(win) = app.get_webview_window("main") else { return };
    let Ok(Some(mon)) = win.current_monitor() else { return };
    let size = mon.size().to_logical::<f64>(mon.scale_factor());
    let w = 900f64.min(size.width - 48.0).max(900.0);
    let h = 560f64.min(size.height - 96.0).max(560.0);
    let _ = win.set_size(LogicalSize::new(w, h));
    let _ = win.center();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            fit_to_monitor(app);

            let resource_dir = app.path().resource_dir().ok();
            let state = Arc::new(device::AppState::new(adb::Adb::locate(resource_dir.as_deref())));
            app.manage(state.clone());
            app.manage(Arc::new(stream::Streams::default()));
            app.manage(Arc::new(input::Inputs::default()));
            commands::spawn_poller(app.handle().clone(), state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::adb_status,
            commands::list_devices,
            commands::connect_device,
            commands::connect_lan,
            commands::discover_lan,
            commands::disconnect_device,
            commands::restart_adb,
            commands::open_phone_window,
            commands::phone_context,
            commands::send_key,
            commands::input_key,
            commands::input_text,
            commands::input_copy,
            commands::touch_pointer,
            commands::touch_event,
            commands::touch_scroll,
            commands::fit_phone_window,
            commands::start_stream,
            commands::stop_stream,
            commands::set_always_on_top,
            commands::set_fullscreen,
            commands::focus_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("không thể khởi chạy ứng dụng LUMIR");
}