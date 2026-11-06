# Olympia Buzzer

Website bấm chuông nhiều người chơi, đồng bộ realtime bằng Socket.IO. Có giao diện Host, người chơi, đội, âm thanh, đồng hồ đếm ngược và bảng điểm.

## 1. Yêu cầu

- Node.js 20 trở lên
- npm
- Trình duyệt hiện đại

## 2. Chạy trên máy tính

Mở Terminal/PowerShell tại thư mục dự án:

```bash
npm install
npm run dev
```

Mở http://localhost:3000. Một cửa sổ tạo phòng Host, các cửa sổ khác tham gia bằng mã phòng. Để thử trên điện thoại cùng Wi-Fi, mở `http://IP-MAY-TINH:3000` trên điện thoại (cho phép Node.js qua Windows Firewall nếu được hỏi).

## 3. Đưa mã nguồn lên GitHub

Tạo repository mới trên GitHub, ví dụ `olympia-buzzer`. Trong thư mục dự án:

```bash
git init
git add .
git commit -m "Initial Olympia Buzzer"
git branch -M main
git remote add origin https://github.com/TEN-GITHUB/olympia-buzzer.git
git push -u origin main
```

Thay `TEN-GITHUB` bằng username GitHub của bạn.

## 4. Deploy online bằng Render

1. Đăng nhập https://render.com và chọn **New → Web Service**.
2. Kết nối GitHub, chọn repository `olympia-buzzer`.
3. Chọn runtime **Node**.
4. Build Command: `npm install`.
5. Start Command: `npm start`.
6. Chọn instance phù hợp rồi nhấn **Deploy Web Service**.
7. Mở URL `https://...onrender.com` do Render cấp.

Không cần tự đặt PORT; Render truyền biến môi trường `PORT` và ứng dụng đã đọc biến này. Dùng Web Service, không dùng Static Site vì Socket.IO cần server Node chạy liên tục.

## 5. Cách sử dụng

1. Host mở website, chọn **Tạo phòng Host**.
2. Đặt tên Host, thời gian mỗi lượt và danh sách đội (mỗi dòng một đội).
3. Chia sẻ mã phòng hoặc link tham gia cho người chơi.
4. Người chơi nhập tên, chọn đội và tham gia.
5. Host chọn **Mở chuông**. Máy chủ ghi nhận lượt bấm hợp lệ đầu tiên và khóa các chuông còn lại.
6. Host cộng/trừ điểm bằng các nút `+10`, `+20`, `−10`; có thể xóa người chơi.
7. Host chọn **Reset** để mở lượt mới.

## 6. Giới hạn của bản starter

- Dữ liệu phòng và điểm đang lưu trong RAM. Khi Render khởi động lại hoặc deploy phiên bản mới, phòng đang chơi sẽ mất. Không dùng bản này cho giải đấu có yêu cầu lưu kết quả lâu dài.
- Server là trọng tài: người bấm đầu tiên được xác định theo thứ tự gói tin đến máy chủ, không phải đồng hồ trên điện thoại. Kết nối mạng có độ trễ khác nhau nên không thể bảo đảm công bằng tuyệt đối giữa các mạng.
- Host hiện điều khiển bằng kết nối đang tạo phòng. Nếu Host mất kết nối, bản này chưa có quy trình khôi phục Host an toàn; tạo phòng mới là cách đơn giản nhất.
- Âm thanh được tạo bằng Web Audio API, không cần tải file nhạc. Người dùng cần tương tác với trang ít nhất một lần để trình duyệt cho phép phát âm thanh.
- Đây là bản nền tảng: chưa có đăng nhập, mã PIN Host, cơ sở dữ liệu, chống spam nâng cao hoặc giới hạn số người tham gia.

## 7. Trước khi dùng cho giải đấu thật

Nên bổ sung xác thực Host bằng mã bí mật, lưu dữ liệu vào Redis/PostgreSQL, giới hạn số người/phòng, cơ chế reconnect và nhật ký sự kiện. Không chia sẻ quyền Host hoặc mã quản trị công khai. Nếu cần nhiều instance server, phải dùng Socket.IO adapter (ví dụ Redis) và kho dữ liệu dùng chung.


### Answer Pad liên tục
- Khi Host mở lượt, ô nhập câu trả lời được kích hoạt và tự động focus.
- Người chơi có thể gửi nhiều câu trả lời; mỗi lần gửi được lưu thành một bản ghi riêng kèm thời gian tính từ lúc mở lượt.
- Bấm chuông hoặc Host khóa chuông không đóng Answer Pad. Ô nhập chỉ khóa khi đồng hồ hết giờ (hoặc Host reset lượt).
- Có thể nhấn Ctrl+Enter (Windows/Linux) hoặc Cmd+Enter (macOS) để gửi nhanh.
- Trên một số trình duyệt điện thoại, trình duyệt có thể không tự bật bàn phím ảo nếu việc focus đến từ sự kiện mạng; người chơi có thể cần chạm một lần vào vùng nhập để bật bàn phím.


## Điều khiển chuông và thời gian trả lời

- Trong giao diện Host, đặt **Thời gian mở chuông** (mặc định 5 giây), sau đó nhấn **MỞ CHUÔNG**.
- Bật **Chuông luôn mở** để một thí sinh bấm chuông không khóa chuông của các thí sinh khác. Khi tắt, cơ chế một người bấm đầu tiên khóa những người còn lại được giữ nguyên.
- Đồng hồ **Thời gian trả lời** là một bộ đếm riêng. Host đặt số giây rồi nhấn **BẮT ĐẦU**; chỉ khi đồng hồ này chạy, thí sinh mới có thể gửi câu trả lời. Đồng hồ này không tự chạy khi mở chuông.
- Host có thể tạm dừng hoặc đặt lại đồng hồ trả lời độc lập với chuông.
