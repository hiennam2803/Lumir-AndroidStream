# LUMIR Performance Monitor

## Cách sử dụng
1. Build và chạy LUMIR như bình thường.
2. Mở cửa sổ điện thoại và kết nối thiết bị.
3. Nhấn phím `F2` trong cửa sổ điện thoại để bật/tắt bảng PERF (`Esc` để đóng). `F3` ẩn/hiện thanh công cụ bên phải.
4. Để TikTok chạy qua nhiều video; theo dõi Packet FPS, Decoder FPS, Render FPS và Decode Queue.
5. Bấm `Export CSV` để lưu các mẫu đang giữ. Mẫu được ghi theo khối 2 phút: ghi đủ 4 phút thì 2 phút cũ nhất bị xoá rồi ghi tiếp, nên file CSV luôn chứa từ 2 đến 4 phút gần nhất. Biểu đồ hiển thị 60 mẫu gần nhất.

## Ý nghĩa và giới hạn
- **Packet FPS**: số packet khung hình H.264 mà JavaScript nhận được mỗi giây. Đây không phải bộ đếm trực tiếp ở đầu đọc USB/Rust.
- **Decoder FPS**: số frame WebCodecs xuất ra mỗi giây.
- **Render FPS**: số lần callback vẽ frame lên Canvas mỗi giây; không phải phép đo photon-to-photon hay tần số quét thực tế của màn hình.
- **Decode Queue**: `VideoDecoder.decodeQueueSize` tại thời điểm lấy mẫu. Nó không thể hiện toàn bộ frame đang nằm trong decoder hoặc compositor.
- **Decode → output**: thời gian gần đúng từ lúc gọi `decode()` đến callback output, ghép theo thứ tự FIFO; dùng để so sánh xu hướng, không xem là phép đo chính xác cho từng frame nếu codec reorder frame.
- **Canvas draw**: thời gian gọi `drawImage()` và phần xử lý đồng bộ xung quanh nó.
- **JS memory**: chỉ hiện khi WebView cung cấp `performance.memory`; nếu không hỗ trợ sẽ hiện `N/A`.
- **Decoder errors**: số lỗi WebCodecs được báo về callback.

Bản này chỉ bổ sung đo lường phía WebView. Chưa đo trực tiếp USB input FPS, Rust mpsc queue depth, Rust parsing time, Tauri transit time, GPU presentation hay số frame bị drop thực tế. Không thay đổi thuật toán truyền/giải mã hiện tại.

## Chỉ số mở rộng
Tên cột CSV ở trong ngoặc. Tất cả tính trên 1 giây vừa qua trừ khi ghi khác.

- **FPS 1s / FPS 5s** (`fps_1s`, `fps_5s`): số lần vẽ Canvas trong 1 giây / 5 giây gần nhất chia cho độ dài cửa sổ (chưa đủ 5 giây thì chia theo thời gian đã có). Màn hình tĩnh thì encoder không xuất khung nên số này thấp là bình thường.
- **Frame interval avg / max** (`frame_arrival_interval_avg_ms`, `_max_ms`): khoảng cách giữa hai packet khung hình liên tiếp mà JavaScript nhận. Max lớn trên màn hình tĩnh không phải lỗi.
- **IPC RTT** (`network_rtt_ms`): thời gian một lệnh Tauri `ping` đi từ WebView sang Rust và về lại, trung bình 5 lần gần nhất. **Không phải RTT tới điện thoại** (USB/ADB không có khái niệm này; với LAN cũng chưa đo riêng). Cần lệnh `ping` ở Rust; thiếu thì hiện `N/A`.
- **Packet loss** (`packet_loss_pct`): % packet khung hình đã nhận nhưng bị bỏ trước/trong lúc giải mã (chưa có decoder, đang chờ IDR, `decode()` ném lỗi). Đường truyền USB/ADB là tin cậy nên đây **không phải mất gói mạng**; stream không có số thứ tự nên cũng không phát hiện được mất gói giữa Rust và WebView.
- **Dropped frames** (`dropped_frames` tích luỹ, `dropped_frames_1s`): packet bị bỏ như trên cộng các khung đã nộp cho decoder nhưng chưa ra output thì decoder bị đóng/mở lại.
- **Event loop lag avg / max** (`event_loop_lag_avg_ms`, `_max_ms`): timer 50 ms chạy trễ bao nhiêu so với dự kiến. Bỏ qua khi cửa sổ bị ẩn.
- **Long task max** (`long_task_duration_max_ms`, `long_task_count`): `PerformanceObserver` loại `longtask` (tác vụ main thread > 50 ms). WebView không hỗ trợ thì `N/A`.
- **GPU usage** (`gpu_usage_pct`): WebView **không** đọc được mức dùng GPU. Luôn `N/A` trừ khi bạn gắn `window.__lumirGpuUsage = () => số 0..100` (hoặc trả Promise), ví dụ từ một lệnh Rust đọc bộ đếm hệ điều hành.
- **Draw load (est.)** (`render_load_pct`): thời gian `drawImage` × số khung/giây ÷ 1000 ms. Chỉ là mức bận của main thread khi vẽ, **không phải GPU**.

## Chẩn đoán "hình giật rồi nhảy" (cần video qua scrcpy-server)
Rust gửi một gói `K_STATS` mỗi ~1 giây kèm luồng video. Bảng hiện `N/A` nếu video đang đi đường `screenrecord`. Cả 4 giá trị là **lớn nhất trong 1 giây**:

| Chỉ số (CSV) | Đo gì |
|---|---|
| Đt: khoảng khung (`device_pts_gap_max_ms`) | khoảng cách giữa hai khung theo **đồng hồ điện thoại** |
| Rust: khoảng đọc (`rust_read_gap_max_ms`) | khoảng cách giữa hai gói Rust đọc xong từ socket |
| Rust: gửi lâu nhất (`rust_send_max_ms`) | một lần `Channel::send` mất bao lâu |
| Rust → JS (`rust_to_js_transit_ms`) | gói thống kê đi từ Rust tới WebView mất bao lâu (xếp sau các khung nên gồm cả hàng đợi) |

Cách đọc khi thấy FPS tụt rồi vọt:
- **Đt: khoảng khung lớn** → chính điện thoại/bộ mã hoá không xuất khung (màn hình không đổi, máy nóng/hạn xung, app đang vẽ chậm).
- **Đt đều, Rust: khoảng đọc lớn** → khung bị giữ ở **USB/ADB/socket**: đổi cáp/cổng, tắt USB selective suspend, nghi tiến trình quét `adb` định kỳ.
- **Đọc đều, Rust: gửi lâu nhất lớn hoặc Rust → JS lớn** → nghẽn ở **kênh Tauri/WebView**.
- Cả bốn đều thấp mà FPS vẫn tụt → vấn đề nằm ở WebView (xem Event loop lag, Long task).

**Khung gộp** (`coalesced_frames_1s`): khi khung dồn về cả loạt, chỉ khung mới nhất được vẽ ở nhịp hiển thị kế tiếp; các khung cũ hơn bị bỏ, không vẽ (không tính vào Dropped frames). Hình sẽ đứng rồi nhảy thẳng tới hiện tại thay vì chạy bù như tua nhanh.

