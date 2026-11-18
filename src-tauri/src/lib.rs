//! LUMIR — giai đoạn UI prototype.
//! Backend Rust chỉ dựng cửa sổ + WebView. Chưa có ADB / USB / LAN / streaming thật
//! (toàn bộ tương tác là mô phỏng ở frontend), nên chưa cần command nào.

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
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("không thể khởi chạy ứng dụng LUMIR");
}
