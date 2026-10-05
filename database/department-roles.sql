-- Bổ sung vai trò phòng ban, giữ thứ tự ENUM cũ và cho phép tài khoản chỉ có email.
-- Chạy trên database CRM đã có users. Không xóa hoặc reset dữ liệu.
ALTER TABLE users
  MODIFY role ENUM('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER','HRM') NOT NULL DEFAULT 'UNASSIGNED',
  MODIFY phone VARCHAR(20) NULL;
