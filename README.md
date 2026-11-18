# LUMIR — Desktop UI Prototype (Tauri 2 + Rust)

<<<<<<< HEAD
Giao diện **Unified Control Desk** gốc được

```
```

 giữ nguyên, bọc trong ứng dụng Tauri 2 cho Windows 10/11.
Giai đoạn này chỉ là UI + mô phỏng: **không** có ADB, USB, LAN discovery, streaming hay injection thật.

## Yêu cầu (Windows)

1. Node.js 18+  2. Rust (rustup, toolchain MSVC, >= 1.90)  3. Visual Studio Build Tools (workload "Desktop development with C++")  4. WebView2 (có sẵn trên Win 11 / Win 10 mới).

## Chạy

=======
Giao diện **LUMIR Android Device Manager**, bọc trong ứng dụng Tauri 2 cho Windows 10/11.
Giai đoạn này chỉ là UI + mô phỏng: **không** có ADB, USB, LAN discovery, streaming hay injection thật.

## Yêu cầu (Windows)
1. Node.js 18+  2. Rust (rustup, toolchain MSVC, >= 1.90)  3. Visual Studio Build Tools (workload "Desktop development with C++")  4. WebView2 (có sẵn trên Win 11 / Win 10 mới).

## Chạy
>>>>>>> 01c7b91 (resign ui)
```
npm install
npm run tauri dev
```

## Build bộ cài
<<<<<<< HEAD

```
npm run tauri build
```

Kết quả: `src-tauri/target/release/bundle/nsis/LUMIR_0.1.0_x64-setup.exe`

## Cấu trúc

=======
```
npm run tauri build
```
Kết quả: `src-tauri/target/release/bundle/nsis/LUMIR_0.1.0_x64-setup.exe`

## Cấu trúc
>>>>>>> 01c7b91 (resign ui)
```
src/                     frontend (không cần Vite, được đóng gói thẳng vào app)
  index.html             markup gốc
  styles/main.css        CSS gốc, giữ nguyên
  styles/fonts.css       @font-face Inter (cục bộ)
  styles/tauri.css       override chỉ áp dụng trong Tauri
<<<<<<< HEAD
  scripts/main.js        JS gốc (1 chỉnh sửa: lề scale)
  scripts/tauri-bridge.js  kéo cửa sổ, Thu nhỏ, Đóng
=======
  scripts/main.js        JS gốc (sửa 2 dòng lỗi: $$ và regex IP)
  scripts/tauri-bridge.js  kéo cửa sổ, Thu nhỏ, Phóng to, Đóng
>>>>>>> 01c7b91 (resign ui)
  assets/fonts/          Inter Variable (latin, latin-ext, vietnamese)
src-tauri/
  src/main.rs, src/lib.rs
  capabilities/default.json
  icons/  tauri.conf.json  Cargo.toml  build.rs
app-icon.png             icon nguồn (npx tauri icon app-icon.png)
```
<<<<<<< HEAD
=======

## Cửa sổ
Mặc định 1024×720 (tự thu nhỏ nếu màn hình nhỏ), tối thiểu 800×560, kéo giãn/phóng to được. Header tự vẽ: kéo ở vùng trống, nhấp đúp để phóng to. Các nút Thu nhỏ / Phóng to / Đóng được thêm lúc chạy trong Tauri vì thiết kế gốc không có.
>>>>>>> 01c7b91 (resign ui)
