-- Chỉ thêm MANAGER vào cuối ENUM; không xóa/seed/reset bất kỳ dữ liệu hay mật khẩu nào.
-- Backend mới tự áp dụng khi khởi động. Có thể chạy lệnh này trước nếu deploy thủ công.
ALTER TABLE users
  MODIFY role ENUM('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER','HRM')
  NOT NULL DEFAULT 'UNASSIGNED';
-- Quan hệ quản lý lưu tại crm_documents: collection='members', body.managerId của Leader.
-- Sale được xác định theo leaderId + teamId; không cần tạo lại bảng khách/đơn.
