# LUMIR Performance Monitor

## Cách sử dụng
1. Build và chạy LUMIR như bình thường.
2. Mở cửa sổ điện thoại và kết nối thiết bị.
3. Nhấn phím `F2` trong cửa sổ điện thoại để bật/tắt bảng PERF (`Esc` để đóng). `F3` ẩn/hiện thanh công cụ bên phải.
4. Để TikTok chạy qua nhiều video; theo dõi Packet FPS, Decoder FPS, Render FPS và Decode Queue.
5. Bấm `Export CSV` để lưu tối đa 120 mẫu gần nhất (khoảng 2 phút). Biểu đồ hiển thị 60 mẫu gần nhất.

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
