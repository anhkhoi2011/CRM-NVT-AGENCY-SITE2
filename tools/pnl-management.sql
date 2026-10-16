-- PnL Management migration for CRM NVT Agency.
-- The Node runtime also runs these statements automatically on first PnL API use.
CREATE TABLE IF NOT EXISTS pnl_customers (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_code VARCHAR(96) NOT NULL UNIQUE,
  customer_name VARCHAR(160) NOT NULL,
  cqg_account VARCHAR(96) NOT NULL UNIQUE,
  initial_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
  current_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
  default_lot DECIMAL(10,2) NOT NULL DEFAULT 0,
  assigned_to VARCHAR(96) NULL,
  created_by VARCHAR(96) NOT NULL,
  status ENUM('active','inactive') NOT NULL DEFAULT 'active',
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_pnl_created_by (created_by), INDEX idx_pnl_assigned_to (assigned_to), INDEX idx_pnl_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_daily_logs (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  trade_date DATE NOT NULL,
  lot_volume DECIMAL(10,2) NOT NULL DEFAULT 0,
  pnl_amount DECIMAL(18,2) NOT NULL DEFAULT 0,
  source ENUM('web','telegram') NOT NULL DEFAULT 'web',
  notes TEXT NULL,
  recorded_by VARCHAR(96) NOT NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnl_customer_date (customer_id, trade_date),
  INDEX idx_pnl_log_date (trade_date), INDEX idx_pnl_log_recorded_by (recorded_by),
  CONSTRAINT fk_pnl_log_customer FOREIGN KEY (customer_id) REFERENCES pnl_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pnl_weekly_summaries (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  customer_id BIGINT NOT NULL,
  week_start_date DATE NOT NULL,
  week_end_date DATE NOT NULL,
  total_lots DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_pnl DECIMAL(18,2) NOT NULL DEFAULT 0,
  ending_capital DECIMAL(18,2) NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pnl_week (customer_id, week_start_date),
  INDEX idx_pnl_week_end (week_end_date),
  CONSTRAINT fk_pnl_week_customer FOREIGN KEY (customer_id) REFERENCES pnl_customers(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
