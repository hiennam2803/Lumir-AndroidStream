# LUMIR — Desktop UI Prototype (Tauri 2 + Rust)

Giao diện **LUMIR Android Device Manager**, bọc trong ứng dụng Tauri 2 cho Windows 10/11.
Giai đoạn hiện tại (Phase 2): **kết nối USB thật** qua ADB (phát hiện thiết bị, quyền USB debugging, thông tin máy) và **hiển thị truyền màn hình** trong cửa sổ điện thoại nổi. **Chưa** có điều khiển cảm ứng/bàn phím hay LAN.

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

## Truyền màn hình

Không cần cài gì lên điện thoại. Rust chạy `adb exec-out screenrecord --output-format=h264 --size WxH --bit-rate 8000000 -`, tách luồng H.264 thành từng khung (`h264.rs`), gửi nhị phân qua Tauri `Channel` (`stream.rs`). Cửa sổ điện thoại (`phone.js`) giải mã bằng **WebCodecs `VideoDecoder`** (có sẵn trong WebView2) và vẽ lên `<canvas>`.

- Cạnh dài video ≤ 1280 px, 8 Mbps. Nếu encoder từ chối `--size`, tự thử lại với kích thước gốc của máy.
- `screenrecord` tự dừng sau 180 giây: app tự nối lại, hình cuối được giữ nguyên trong lúc chờ khung IDR mới.
- Màn hình tĩnh thì encoder không xuất khung mới; khung cuối được đẩy đi sau 25 ms im lặng.
- Lỗi giải mã → tự khởi động lại luồng (tối đa 4 lần), sau đó hiện lỗi kèm nút **Thử lại**.
- Đóng cửa sổ điện thoại hoặc rút cáp → dừng tiến trình adb.
- Mở `src/phone.html` bằng trình duyệt sẽ chạy chế độ demo (hình mẫu) để xem bố cục.

Giới hạn đã biết: xoay ngang màn hình điện thoại thì hình bị co vào khung dọc (cần đọc hướng xoay và mở lại luồng — để giai đoạn sau); không có âm thanh.

Test phần tách H.264: `rustc --test src-tauri/src/h264.rs -o h264test && ./h264test` (hoặc `cargo test` trong `src-tauri`).

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
  scripts/phone.js  cửa sổ điện thoại: giải mã WebCodecs, vẽ canvas, nút điều hướng
  scripts/tauri-bridge.js  kéo cửa sổ, Thu nhỏ, Phóng to, Đóng
  assets/fonts/          Inter Variable (latin, latin-ext, vietnamese)
src-tauri/
  src/main.rs, src/lib.rs
  src/adb.rs        chạy adb (timeout), phân tích đầu ra
  src/device.rs     registry thiết bị + máy trạng thái kết nối (có unit test)
  src/commands.rs   Tauri command, event, luồng quét thiết bị, start_stream/stop_stream
  src/stream.rs     chạy screenrecord, gửi khung H.264 qua Channel
  src/h264.rs       tách NAL / ghép khung / tính --size (có unit test)
  capabilities/default.json
  icons/  tauri.conf.json  Cargo.toml  build.rs
app-icon.png             icon nguồn (npx tauri icon app-icon.png)
```

## Cửa sổ

Mặc định 1024×720 (tự thu nhỏ nếu màn hình nhỏ), tối thiểu 800×560, kéo giãn/phóng to được. Header tự vẽ: kéo ở vùng trống, nhấp đúp để phóng to. Các nút Thu nhỏ / Phóng to / Đóng được thêm lúc chạy trong Tauri vì thiết kế gốc không có.

## Video độ trễ thấp (scrcpy-server)

Video mặc định đi qua `scrcpy-server` (file `src-tauri/scrcpy/scrcpy-server-v3.3.3.jar`, code ở `src-tauri/src/scvideo.rs`) thay cho `screenrecord`.
Nếu scrcpy không chạy được trên một máy, app tự rơi về `screenrecord` (xem log `[lumir] using screenrecord video fallback`).

- Ép dùng đường cũ để so sánh: đặt biến môi trường `LUMIR_VIDEO=screenrecord` rồi chạy app.
- Tuỳ chọn encoder (độ trễ thấp) nằm ở hằng `CODEC_OPTIONS` trong `scvideo.rs`.
- Log server in ra terminal với tiền tố `[lumir/scrcpy-video]`.
- Chạy `cargo test` trong `src-tauri/` để kiểm tra phần parse header/lệnh.
