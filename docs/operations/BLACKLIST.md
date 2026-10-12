# Blacklist IP

Admin mở **Hệ thống → Blacklist**, bấm **Chặn IP**, nhập địa chỉ IPv4/IPv6 và lý do. Chặn theo địa chỉ IP cụ thể; không nhập dải CIDR.

Form landing page phải gửi IP khách trong payload webhook, ví dụ:

```json
{"name":"Khách hàng","phone":"0912345678","visitorIp":"203.0.113.10"}
```

Các tên trường được hỗ trợ: `ip`, `ipAddress`, `clientIp`, `visitorIp`, `remoteIp`, `ipKhachHang`, `diaChiIp`. Không dùng IP kết nối hoặc header của máy chủ LadiPage thay cho IP người điền form. Nếu form không gửi IP khách hợp lệ thì server không thể đối chiếu Blacklist cho lần gửi đó.

IP bị chặn được lưu cùng data vào danh sách **Chờ duyệt**. Server trả HTTP 200 với `status: "BLACKLISTED"` và `customerId: null` để nhà cung cấp xác nhận đã nhận form. Data này không tạo khách hàng, lượt chia data, lời mời nhận data hoặc thông báo CRM/Telegram cho Sale. Gửi lại cùng sự kiện không tạo thêm dòng.

**Chấp nhận** đưa data qua quy trình nhận webhook hiện có, gồm kiểm tra trùng khách, thông báo và chia data theo cấu hình. Data thiếu hoặc sai thông tin không được duyệt vào CRM. Duyệt lại hoặc duyệt đồng thời không tạo khách hay thông báo lặp. IP vẫn bị chặn; lần gửi mới từ IP đó tiếp tục vào Blacklist.

**Bỏ chặn** cho phép các lần gửi mới từ IP đi vào luồng CRM bình thường. Những data đang chờ không tự được duyệt. Có thể tìm theo tên, SĐT, email, IP và lọc **Chờ duyệt / Đã chấp nhận / Tất cả**. Danh sách đã chấp nhận giữ người và thời điểm duyệt để đối chiếu.

Production lưu hai collection `blacklistIps` và `blacklistEntries` trong bảng `crm_documents` hiện có. Chặn/bỏ chặn, nhận form và duyệt data dùng cùng khóa giao dịch CRM. Blacklist chỉ Admin được đọc; cập nhật trạng thái trực tiếp qua API state bị từ chối. Demo dùng dữ liệu RAM và không gửi Telegram.

API quản lý yêu cầu phiên Admin:

- `POST /api/admin/blacklist/ips` — body `{ "ip": "203.0.113.10", "reason": "Spam" }`.
- `DELETE /api/admin/blacklist/ips/:id` — bỏ chặn IP.
- `POST /api/admin/blacklist/entries/:id/accept` — chấp nhận data đã lưu; không lấy thông tin khách từ body của yêu cầu duyệt.

Kiểm tra bằng `npm test`; các bài kiểm thử gồm HTTP demo, phân quyền, chuẩn hóa IP, kiểm tra chặn trước thông báo/chia data, duyệt đồng thời và rollback khi lưu thất bại.
