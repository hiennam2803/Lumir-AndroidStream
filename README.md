# LUMIR — Android Device Manager for Windows

LUMIR là ứng dụng desktop dùng để kết nối điện thoại Android với máy tính Windows, xem màn hình điện thoại theo thời gian thực và tương tác bằng chuột, bàn phím hoặc bộ ánh xạ phím chơi game.

Ứng dụng được xây dựng bằng **Tauri 2, Rust, HTML, CSS và JavaScript**. ADB được sử dụng làm lớp giao tiếp với thiết bị Android.

> **Trạng thái dự án:** bản prototype/đang phát triển. Một số tính năng, đặc biệt là kết nối LAN và điều khiển trên các thiết bị khác nhau, có thể còn giới hạn tùy môi trường.

## Tính năng

### 1. Kết nối và quản lý thiết bị Android

- Phát hiện thiết bị Android qua ADB.
- Hiển thị trạng thái kết nối và thông tin thiết bị.
- Kết nối, ngắt kết nối và khởi động lại ADB.
- Hỗ trợ kết nối USB.
- Có bước đầu hỗ trợ kết nối qua Wi-Fi/LAN bằng `adb connect IP:cổng`.
- Có chức năng dò tìm thiết bị LAN trong phạm vi mạng được hỗ trợ.

### 2. Truyền màn hình điện thoại

- Mở màn hình điện thoại trong một cửa sổ riêng.
- Ưu tiên truyền video bằng `scrcpy-server` để giảm độ trễ.
- Có đường dự phòng `screenrecord` khi scrcpy-server không hoạt động.
- Rust xử lý luồng video và chuyển dữ liệu H.264 sang frontend qua Tauri Channel.
- Frontend giải mã bằng WebCodecs `VideoDecoder` và hiển thị lên Canvas.
- Tự khởi động lại luồng trong một số trường hợp lỗi hoặc khi tiến trình ghi màn hình kết thúc.

Một số giới hạn hiện tại:

- Chưa truyền âm thanh.
- Việc xoay màn hình có thể chưa được xử lý đồng nhất ở mọi trạng thái.
- Chất lượng và độ trễ phụ thuộc vào cáp USB, thiết bị Android, encoder và cấu hình máy tính.

### 3. Điều khiển điện thoại

- Gửi phím điều hướng và thao tác nhập liệu.
- Hỗ trợ chạm, vuốt và cuộn bằng chuột.
- Theo dõi các điểm chạm đang được giữ và gửi lệnh nhả khi cần thiết để hạn chế tình trạng ngón chạm bị kẹt.
- Có các thao tác điều khiển cửa sổ điện thoại như thay đổi kích thước, luôn nổi và toàn màn hình.

Khả năng điều khiển cụ thể có thể phụ thuộc vào phiên bản Android và quyền ADB của thiết bị.

### 4. Game Key Mapping

Game Key Mapping cho phép sử dụng bàn phím máy tính để mô phỏng thao tác chạm trên điện thoại khi chơi game.

Các loại điều khiển:

| Loại | Mô tả |
|---|---|
| Circular Joystick | Joystick ảo 8 hướng, mặc định dùng WASD và có thể gán lại phím |
| Directional Joystick | Bốn hướng riêng biệt; có thể nhấn đồng thời để di chuyển chéo |
| Custom Button | Nút tùy chỉnh, hỗ trợ nhấn, giữ và thả |

Các thao tác cấu hình:

- Thêm, chọn, di chuyển và thay đổi kích thước điều khiển.
- Gán phím bằng cách chọn ô phím rồi nhấn phím mong muốn.
- Xóa điều khiển và lưu cấu hình.
- Chuyển giữa chế độ chỉnh sửa và chế độ chơi.
- Tạo, đổi tên, nhân bản và xóa profile.
- Nhập và xuất profile dưới dạng JSON.
- Có thể gắn profile với game đang chạy thông qua thông tin ứng dụng foreground.

**Chat Keyboard và Game Key Mapping là hai chức năng riêng biệt.** Chúng sử dụng bàn phím vật lý nên không hoạt động đồng thời; khi bật một chức năng, chức năng còn lại sẽ được tắt hoặc khóa theo trạng thái hiện tại.

#### Lưu profile

- Dữ liệu được lưu trong file `keymap.json` tại thư mục dữ liệu riêng của ứng dụng.
- Trên Windows, thư mục dữ liệu thường nằm dưới `%APPDATA%\com.lumir.desktop\`.
- Tọa độ được chuẩn hóa theo khung hình để giữ vị trí tương đối khi thay đổi kích thước cửa sổ hoặc độ phân giải.
- Cơ chế lưu có file tạm và bản sao dự phòng để hỗ trợ phục hồi khi dữ liệu bị lỗi.
- Profile có thể được xuất ra thư mục Downloads và nhập lại bằng hộp thoại chọn file.

### 5. Performance Monitor

LUMIR có bảng theo dõi hiệu năng ở cửa sổ điện thoại:

1. Kết nối thiết bị và mở cửa sổ điện thoại.
2. Nhấn `F2` để bật/tắt bảng PERF.
3. Nhấn `Esc` để đóng bảng.
4. Nhấn `F3` để ẩn/hiện thanh công cụ bên phải.
5. Dùng **Export CSV** để xuất tối đa 120 mẫu gần nhất.

Các chỉ số được theo dõi gồm:

- **Packet FPS:** số packet khung hình H.264 frontend nhận mỗi giây.
- **Decoder FPS:** số frame WebCodecs giải mã đầu ra mỗi giây.
- **Render FPS:** số lần callback vẽ frame lên Canvas mỗi giây.
- **Decode Queue:** giá trị `VideoDecoder.decodeQueueSize` tại thời điểm lấy mẫu.
- **Decode → output:** thời gian gần đúng từ lúc gọi `decode()` đến callback output.
- **Canvas draw:** thời gian gọi `drawImage()` và xử lý đồng bộ liên quan.
- **JS memory:** bộ nhớ JavaScript nếu WebView cung cấp `performance.memory`.
- **Decoder errors:** số lỗi decoder được ghi nhận.

Lưu ý: đây là các chỉ số đo ở phía WebView, không phải phép đo toàn bộ độ trễ từ điện thoại đến màn hình máy tính. Hiện chưa đo trực tiếp USB input FPS, thời gian xử lý Rust, Tauri transit time, GPU presentation hoặc số frame drop thực tế.

Xem thêm: [`PERFORMANCE-MONITOR.md`](PERFORMANCE-MONITOR.md).

## Công nghệ

| Thành phần | Công nghệ |
|---|---|
| Desktop framework | Tauri 2 |
| Backend | Rust |
| Frontend | HTML, CSS, JavaScript |
| Android communication | Android Debug Bridge (ADB) |
| Video transport | scrcpy-server / `screenrecord` fallback |
| Video decoding | WebCodecs `VideoDecoder` |
| Rendering | HTML Canvas |
| Data format | JSON |
| Tests | Node.js Test Runner, Playwright, Rust tests |

## Yêu cầu môi trường

Dự án hiện hướng tới **Windows 10/11**.

Cần cài đặt:

1. **Node.js 18 trở lên** và npm.
2. **Rust** thông qua rustup, với toolchain MSVC.
3. **Visual Studio Build Tools**, workload `Desktop development with C++`.
4. **Microsoft Edge WebView2 Runtime**.
5. Điện thoại Android đã bật **Developer options** và **USB debugging**.
6. Cáp USB có hỗ trợ truyền dữ liệu nếu kết nối qua USB.

Phiên bản Rust nên đáp ứng yêu cầu của các dependency trong `src-tauri/Cargo.toml` và `Cargo.lock`.

## Cài đặt và chạy ở chế độ phát triển

Clone hoặc giải nén dự án, sau đó mở terminal tại thư mục gốc:

```bash
npm install
npm run tauri dev
```

Tauri sẽ khởi chạy frontend và backend Rust ở chế độ phát triển.

## Cấu hình ADB

LUMIR tìm ADB theo thứ tự:

1. Đường dẫn trong biến môi trường `LUMIR_ADB`.
2. Thư mục `adb/` cạnh ứng dụng.
3. Thư mục `src-tauri/adb/` khi chạy ở chế độ phát triển.
4. ADB có sẵn trong `PATH`.

Repository có thư mục `src-tauri/adb/` để chứa các thành phần ADB dành cho Windows. Nếu cần thay thế hoặc cập nhật, tải **Android SDK Platform-Tools** từ trang chính thức:

https://developer.android.com/tools/releases/platform-tools

Các file Windows thường cần có:

- `adb.exe`
- `AdbWinApi.dll`
- `AdbWinUsbApi.dll`

Không tải các file ADB từ nguồn không đáng tin cậy.

## Kết nối điện thoại qua USB

1. Bật Developer options trên điện thoại Android.
2. Bật **USB debugging**.
3. Kết nối điện thoại với máy tính bằng cáp USB hỗ trợ dữ liệu.
4. Mở LUMIR.
5. Chấp nhận hộp thoại cho phép USB debugging trên điện thoại.
6. Chọn thiết bị trong ứng dụng để kết nối.

Nếu thiết bị không xuất hiện, kiểm tra cáp, cổng USB, driver của thiết bị và trạng thái ADB.

## Kết nối qua Wi-Fi/LAN

Đường kết nối LAN hiện hỗ trợ bước kết nối bằng địa chỉ IP và cổng ADB.

### Android 11 trở lên

1. Điện thoại và máy tính kết nối cùng mạng Wi-Fi.
2. Trên điện thoại, mở Developer options và bật **Wireless debugging**.
3. Lấy địa chỉ IP và cổng kết nối hiển thị trên điện thoại.
4. Trong LUMIR, mở tab LAN và thêm thiết bị bằng IP cùng cổng tương ứng.
5. Chọn kết nối.

### Android phiên bản cũ hơn

Có thể cần kết nối USB lần đầu và bật ADB TCP/IP bằng lệnh:

```bash
adb tcpip 5555
```

Sau đó lấy địa chỉ IP của điện thoại và kết nối:

```bash
adb connect IP:5555
```

Thay `IP` bằng địa chỉ IP thực tế của điện thoại.

**Giới hạn:** ghép nối bằng mã (`adb pair`) và tự động dò tìm thiết bị có thể chưa được hỗ trợ đầy đủ trong phiên bản hiện tại. Kết nối Wi-Fi thường có độ trễ cao hơn USB.

## Chạy kiểm thử

Chạy các lệnh tại thư mục gốc dự án.

### JavaScript core tests

```bash
npm run test:core
```

Kiểm thử schema, profile, xung đột phím và engine xử lý thao tác nhấn/giữ/thả.

### End-to-end tests

```bash
npm run test:e2e
```

Chạy kiểm thử giao diện Game Key Mapping với Playwright và Tauri mock IPC. Môi trường kiểm thử cần có các dependency tương ứng.

### Rust tests

```bash
npm run test:rust
```

Chạy bộ kiểm thử Rust, bao gồm các phần lưu/đọc dữ liệu, phục hồi file, theo dõi điểm chạm và xử lý lệnh.

## Build ứng dụng Windows

```bash
npm run tauri build
```

Cấu hình Tauri hiện tại tạo bộ cài Windows dạng **NSIS**.

Đường dẫn đầu ra dự kiến:

```text
src-tauri/target/release/bundle/nsis/
```

Tên file bộ cài phụ thuộc vào phiên bản và cấu hình build trong `src-tauri/tauri.conf.json`.

## Cấu trúc dự án

```text
Lumir-AndroidStream-main/
├── src/
│   ├── index.html
│   ├── phone.html
│   ├── assets/
│   │   └── fonts/
│   ├── scripts/
│   │   ├── main.js
│   │   ├── phone.js
│   │   ├── playout.js
│   │   ├── popups.js
│   │   ├── performance.js
│   │   ├── keymap-core.js
│   │   ├── keymap.js
│   │   └── tauri-bridge.js
│   └── styles/
│       ├── main.css
│       ├── phone.css
│       ├── keymap.css
│       ├── fonts.css
│       ├── tauri.css
│       └── patches.css
├── src-tauri/
│   ├── adb/
│   ├── scrcpy/
│   ├── icons/
│   ├── capabilities/
│   ├── src/
│   │   ├── main.rs
│   │   ├── lib.rs
│   │   ├── adb.rs
│   │   ├── commands.rs
│   │   ├── ctl.rs
│   │   ├── device.rs
│   │   ├── h264.rs
│   │   ├── input.rs
│   │   ├── keymap.rs
│   │   ├── scvideo.rs
│   │   └── stream.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/
│   ├── keymap-core.test.js
│   └── e2e-keymap.mjs
├── PERFORMANCE-MONITOR.md
├── package.json
└── README.md
```

## Ghi chú phát triển

- Frontend nằm trong `src/` và được Tauri đóng gói trực tiếp thông qua `frontendDist`.
- Backend Rust nằm trong `src-tauri/`.
- Các lệnh giao tiếp giữa frontend và backend được đăng ký trong `src-tauri/src/lib.rs`.
- Logic Game Key Mapping phía frontend được tách thành `keymap-core.js` và `keymap.js`.
- Logic lưu profile và nhận diện game nằm ở backend Rust trong `keymap.rs`.
- Luồng video scrcpy được xử lý trong `scvideo.rs`; đường dự phòng `screenrecord` nằm trong `stream.rs`.
- Cấu hình cửa sổ, quyền và đóng gói nằm trong `src-tauri/tauri.conf.json` cùng thư mục `capabilities/`.
