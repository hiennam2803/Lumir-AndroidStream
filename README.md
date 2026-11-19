# LUMIR — Desktop UI Prototype (Tauri 2 + Rust)

Giao diện **LUMIR Android Device Manager**, bọc trong ứng dụng Tauri 2 cho Windows 10/11.
Giai đoạn hiện tại (Phase 1): **kết nối USB thật** qua ADB — phát hiện thiết bị, kiểm tra quyền USB debugging, đọc thông tin máy. **Chưa** có streaming, điều khiển (input) hay LAN.

## Yêu cầu (Windows)

1. Node.js 18+  2. Rust (rustup, toolchain MSVC, >= 1.90)  3. Visual Studio Build Tools (workload "Desktop development with C++")  4. WebView2 (có sẵn trên Win 11 / Win 10 mới).

## Chạy

```
npm install
npm run tauri dev
```

## ADB

Lumir tìm `adb` theo thứ tự: biến môi trường `LUMIR_ADB` → thư mục `adb/` cạnh app → (khi dev) `src-tauri/adb/` → `PATH`.

Khi dev: tải [SDK Platform-Tools](https://developer.android.com/tools/releases/platform-tools) và chép `adb.exe`, `AdbWinApi.dll`, `AdbWinUsbApi.dll` vào `src-tauri/adb/` (hoặc để `adb` trong PATH).

Khi đóng gói: thêm vào `bundle` trong `tauri.conf.json` dòng `"resources": ["adb/*"]` (sau khi thư mục `src-tauri/adb/` đã có file).

## Build bộ cài

```
npm run tauri build
```

Kết quả: `src-tauri/target/release/bundle/nsis/LUMIR_0.1.0_x64-setup.exe`

## Cấu trúc

```
src/                     frontend (không cần Vite, được đóng gói thẳng vào app)
  index.html             markup gốc
  styles/main.css        CSS gốc, giữ nguyên
  styles/fonts.css       @font-face Inter (cục bộ)
  styles/tauri.css       override chỉ áp dụng trong Tauri
  scripts/main.js        JS gốc (sửa 2 dòng lỗi: $$ và regex IP)
  scripts/tauri-bridge.js  kéo cửa sổ, Thu nhỏ, Phóng to, Đóng
  assets/fonts/          Inter Variable (latin, latin-ext, vietnamese)
src-tauri/
  src/main.rs, src/lib.rs
  src/adb.rs        chạy adb (timeout), phân tích đầu ra
  src/device.rs     registry thiết bị + máy trạng thái kết nối (có unit test)
  src/commands.rs   Tauri command, event, luồng quét thiết bị
  capabilities/default.json
  icons/  tauri.conf.json  Cargo.toml  build.rs
app-icon.png             icon nguồn (npx tauri icon app-icon.png)
```

## Cửa sổ

Mặc định 1024×720 (tự thu nhỏ nếu màn hình nhỏ), tối thiểu 800×560, kéo giãn/phóng to được. Header tự vẽ: kéo ở vùng trống, nhấp đúp để phóng to. Các nút Thu nhỏ / Phóng to / Đóng được thêm lúc chạy trong Tauri vì thiết kế gốc không có.
