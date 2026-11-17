// Ẩn cửa sổ console trên Windows ở bản release. KHÔNG xoá dòng này.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    lumir_lib::run()
}
