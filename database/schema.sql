  -- NVT AGENCY CRM - MySQL schema
-- Chạy trong cPanel phpMyAdmin sau khi tạo database.
CREATE TABLE IF NOT EXISTS users (
  id VARCHAR(96) PRIMARY KEY,
  account_code VARCHAR(64) NULL UNIQUE,
  phone VARCHAR(20) NULL UNIQUE,
  email VARCHAR(254) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(160) NOT NULL,
  role ENUM('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER','HRM') NOT NULL DEFAULT 'UNASSIGNED',
  team_id VARCHAR(96) NULL,
  leader_id VARCHAR(96) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_users_role_active (role, active),
  INDEX idx_users_team (team_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customers (
  id VARCHAR(96) PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  email VARCHAR(254) NULL,
  source VARCHAR(120) NULL,
  campaign VARCHAR(160) NULL,
  website_id VARCHAR(96) NULL,
  status VARCHAR(40) NOT NULL DEFAULT 'NEW',
  sale_id VARCHAR(96) NULL,
  leader_id VARCHAR(96) NULL,
  team_id VARCHAR(96) NULL,
  note TEXT NULL,
  custom_fields_json JSON NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_customers_sale (sale_id), INDEX idx_customers_leader (leader_id),
  INDEX idx_customers_phone (phone), INDEX idx_customers_updated (updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS products (
  id VARCHAR(96) PRIMARY KEY,
  sku VARCHAR(60) NULL,
  name VARCHAR(200) NOT NULL,
  category VARCHAR(100) NULL,
  price DECIMAL(18,2) NOT NULL DEFAULT 0,
  type ENUM('SALE','RENTAL') NOT NULL DEFAULT 'SALE',
  rental_months INT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_products_active (active),
  UNIQUE KEY uq_products_sku (sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS orders (
  id VARCHAR(96) PRIMARY KEY,
  code VARCHAR(100) NOT NULL UNIQUE,
  customer_id VARCHAR(96) NOT NULL,
  sale_id VARCHAR(96) NULL,
  leader_id VARCHAR(96) NULL,
  team_id VARCHAR(96) NULL,
  total_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  status VARCHAR(40) NOT NULL DEFAULT 'PENDING',
  items_json JSON NULL,
  note TEXT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_customer (customer_id), INDEX idx_orders_sale (sale_id), INDEX idx_orders_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
  setting_key VARCHAR(160) PRIMARY KEY,
  setting_value JSON NOT NULL,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id VARCHAR(96) NOT NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  expires_at DATETIME NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at DATETIME NULL,
  last_activity VARCHAR(160) NULL,
  INDEX idx_sessions_expiry (expires_at), INDEX idx_sessions_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_activity_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  user_id VARCHAR(96) NOT NULL,
  action VARCHAR(48) NOT NULL,
  detail VARCHAR(255) NOT NULL DEFAULT '',
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(512) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_activity_user_time (user_id, created_at),
  INDEX idx_user_activity_time (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Danh mục sản phẩm mặc định NVT Agency CRM.
-- An toàn khi chạy lại: chỉ thêm khi cả ID và SKU đều chưa tồn tại.
-- Dữ liệu phụ và lịch sử thay đổi bền vững của CRM.
CREATE TABLE IF NOT EXISTS crm_documents (
  collection VARCHAR(64) NOT NULL,
  id VARCHAR(96) NOT NULL,
  body JSON NOT NULL,
  deleted TINYINT NOT NULL DEFAULT 0,
  PRIMARY KEY (collection, id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_changes (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  request_id VARCHAR(96) NOT NULL,
  actor_id VARCHAR(96) NOT NULL,
  changes_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_crm_changes_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS crm_write_lock (
  id INT PRIMARY KEY
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
INSERT IGNORE INTO crm_write_lock (id) VALUES (1);

-- Giữ nguyên mọi payload landing page trước khi tạo bản ghi khách hàng.
CREATE TABLE IF NOT EXISTS webhook_events (
  id VARCHAR(96) PRIMARY KEY,
  dedupe_key CHAR(64) NOT NULL UNIQUE,
  payload_json JSON NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cài sẵn danh mục sản phẩm; câu lệnh an toàn khi chạy lại.
START TRANSACTION;

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-kh-hhcb', 'KH-HHCB-09', 'Khóa học đầu tư hàng hóa cơ bản', 'Khóa học', 5000000, 'SALE', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-kh-hhcb' OR sku = 'KH-HHCB-09');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-kh-klcs', 'KH-KLCS-10', 'Khóa học chuyên sâu đầu tư kim loại', 'Khóa học', 10000000, 'SALE', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-kh-klcs' OR sku = 'KH-KLCS-10');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-kh-rsi', 'KH-RSIMA-11', 'Khóa học RSI MA vùng phản ứng chuyên sâu', 'Khóa học', 26000000, 'SALE', NULL, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-kh-rsi' OR sku = 'KH-RSIMA-11');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-ind-1m', 'IND-BF-R1M', 'Chỉ báo Breakout + Fake Breakout · thuê 1 tháng · 39$', 'Chỉ báo', 1014000, 'RENTAL', 1, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-ind-1m' OR sku = 'IND-BF-R1M');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-ind-3m', 'IND-BF-R3M', 'Chỉ báo Breakout + Fake Breakout · thuê 3 tháng · 117$', 'Chỉ báo', 3042000, 'RENTAL', 3, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-ind-3m' OR sku = 'IND-BF-R3M');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-ind-6m', 'IND-BF-R6M', 'Chỉ báo Breakout + Fake Breakout · thuê 6 tháng · 234$', 'Chỉ báo', 6084000, 'RENTAL', 6, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-ind-6m' OR sku = 'IND-BF-R6M');

INSERT INTO products (id, sku, name, category, price, type, rental_months, active)
SELECT 'p-ind-12m', 'IND-BF-R12M', 'Chỉ báo Breakout + Fake Breakout · thuê 1 năm · 468$', 'Chỉ báo', 12168000, 'RENTAL', 12, 1
WHERE NOT EXISTS (SELECT 1 FROM products WHERE id = 'p-ind-12m' OR sku = 'IND-BF-R12M');

INSERT INTO system_settings (setting_key, setting_value)
VALUES ('product_catalog_20260914_v1', 'true')
ON DUPLICATE KEY UPDATE setting_value = setting_value;

COMMIT;
