//! LUMIR — giai đoạn UI prototype.
//! Backend Rust chỉ dựng cửa sổ + WebView. Chưa có ADB / USB / LAN / streaming thật
//! (đúng phạm vi: toàn bộ tương tác là mô phỏng ở frontend), nên chưa cần command nào.

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("không thể khởi chạy ứng dụng LUMIR");
}
