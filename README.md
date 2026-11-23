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

## Game Key Mapping (chơi game bằng bàn phím máy tính)

Nút **gamepad** trên thanh dọc (tách hẳn khỏi nút **keyboard** = Chat Keyboard, chỉ để gõ chữ). Hai hệ thống có module, state và sự kiện riêng; chúng dùng chung bàn phím vật lý nên không chạy cùng lúc (bật cái này thì cái kia tắt; đang sửa mapping thì không bật được Chat Keyboard).

**Dùng:** bấm nút gamepad → chế độ chỉnh sửa (màn hình tối ~25%, bảng công cụ kéo/thu gọn được) → thêm điều khiển, kéo để di chuyển, kéo chấm nhỏ ở mép để đổi cỡ, chọn rồi gán phím (bấm ô phím → nhấn phím), `Delete` để xoá → **Save** (lưu, ở lại) · **Done** (lưu + chơi) · **Cancel** (bỏ thay đổi). Khi chơi có thanh nhỏ phía trên: đổi profile, **Sửa**, **Dừng**.

| Loại | Hành vi |
|---|---|
| Circular Joystick | 8 hướng, mặc định WASD (gán lại được). Chạm xuống ở tâm rồi trượt mượt tới hướng giữ; chéo chuẩn hoá (không nhanh hơn); A+D triệt tiêu nhau |
| Directional Joystick | 4 nút W/A/S/D rời nhau, mỗi nút kéo/đổi cỡ độc lập; nhấn 2 nút = 2 ngón = đi chéo |
| Custom Button | Phím bất kỳ, đặt tên, kích thước, vị trí; nhấn = chạm, giữ = giữ, thả = nhấc |

Phím dành cho cửa sổ nên không gán được: `F3`, `F11`, `Escape`, phím Windows. Mỗi phím chỉ thuộc một ô trong một profile. Tối đa 9 ngón cùng lúc (1 ngón dành cho chuột); quá thì lần nhấn đó bị bỏ qua.

**Profile:** tạo / đặt tên / đổi tên / nhân bản / xoá; mỗi profile lưu nền tảng (Android, máy, độ phân giải, hướng), danh sách điều khiển, loại, phím, toạ độ, kích thước, và game gắn kèm (nút ⌖ nhận diện game đang chạy qua `dumpsys window`; mở lại thì tự chọn profile theo game, tắt được). **⋯ → Import / Export** JSON (xuất ra thư mục Tải xuống; nhập bằng hộp chọn file).

**Lưu trữ:** `keymap.json` riêng trong thư mục dữ liệu của app (Windows: `%APPDATA%\com.lumir.desktop\`), nhiều profile, toạ độ chuẩn hoá 0–1 trên khung hình, kích thước = đường kính / cạnh ngắn của khung → vị trí không đổi khi đổi độ phân giải hay cỡ cửa sổ. Ghi nguyên tử (file tạm → `.bak` → đổi tên); file hỏng được giữ lại thành `keymap.corrupt-<giờ>.json` và khôi phục từ `.bak`. Lưu ở cửa sổ này thì cửa sổ điện thoại khác tự nạp lại.

**An toàn ngón chạm:** thoát chế độ chơi, mất focus, ẩn/thu nhỏ cửa sổ, rút cáp, đóng cửa sổ → nhả hết phím và ngón. Phía Rust (`input.rs::PointerTracker`) theo dõi các ngón đang giữ: nhả được tất cả (`touch_release_all`, cả khi `Link` bị huỷ) và bỏ các lệnh Move/Up tới muộn — thứ nếu lọt vào scrcpy-server sẽ tạo "ngón ma" kẹt trên màn hình.

**Giới hạn:** cần kênh điều khiển scrcpy (đa điểm chạm không có đường dự phòng `input`/evdev); hết bể 9 ngón thì bỏ lần nhấn; profile không tự quy đổi khi xoay máy (cảnh báo hướng ở bảng; xoay máy giữa chừng thì nhả hết); bảng công cụ khá rộng so với cửa sổ điện thoại dọc nhỏ — kéo đi hoặc thu gọn.

**Kiểm thử:** `npm run test:core` (Node: schema, profile, xung đột phím, engine nhấn/giữ/thả đa điểm + fuzz bất biến) · `npm run test:e2e` (Playwright + Chromium, mock Tauri) · `npm run test:rust` (`cargo test`: lưu JSON/phục hồi, `PointerTracker`, phân tích `dumpsys`, command qua mock IPC).

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
  scripts/keymap-core.js  Game Key Mapping: schema, profile, engine (thuần, có test)
  scripts/keymap.js       Game Key Mapping: giao diện chỉnh sửa, chế độ chơi, lưu/nạp
  styles/keymap.css       Game Key Mapping
  scripts/phone.js  cửa sổ điện thoại: giải mã WebCodecs, vẽ canvas, nút điều hướng
  scripts/tauri-bridge.js  kéo cửa sổ, Thu nhỏ, Phóng to, Đóng
  assets/fonts/          Inter Variable (latin, latin-ext, vietnamese)
src-tauri/
  src/main.rs, src/lib.rs
  src/adb.rs        chạy adb (timeout), phân tích đầu ra
  src/device.rs     registry thiết bị + máy trạng thái kết nối (có unit test)
  src/keymap.rs     Game Key Mapping: keymap.json (ghi nguyên tử, phục hồi), xuất file, nhận diện game
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

## Kết nối LAN (Wi-Fi) — bước 1

Thiết bị Wi-Fi dùng chung toàn bộ đường video/điều khiển như USB, chỉ khác serial (`IP:cổng`).

1. Trên điện thoại (Android 11+): Tuỳ chọn nhà phát triển → bật **Gỡ lỗi không dây**. Điện thoại và máy tính phải cùng mạng Wi-Fi.
   Android cũ hơn: cắm cáp một lần và chạy `adb tcpip 5555`, sau đó rút cáp.
2. Trong LUMIR: tab **LAN** → **Add device** → nhập IP và cổng (cổng hiển thị ở màn hình Gỡ lỗi không dây, thường 5555 với `adb tcpip`). App tự chạy `adb connect` rồi kết nối.
3. Danh sách LAN được lưu trên máy (localStorage); thiết bị chưa kết nối vẫn hiện để bấm Connect lại.

Chưa có: ghép nối bằng mã 6 số (`adb pair`, bước 2) và tự tìm thiết bị trong mạng. LAN thường chậm hơn USB: nên dùng preset **Mượt**.
