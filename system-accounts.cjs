"use strict";
const accounts = require('./system-accounts.json');
const MIGRATION_KEY = 'system_accounts_20260914_v1';
// Chỉ chạy cấu hình được chủ hệ thống yêu cầu một lần; không reset mật khẩu khi restart.
async function provisionSystemAccounts(pool) {
  const c = await pool.getConnection();
  let locked = false;
  try {
    // Chỉ mục đăng nhập phải được bảo đảm ở mỗi lần khởi động, kể cả khi seed tài khoản đã chạy trước đó.
    const [userIndexes] = await c.query('SHOW INDEX FROM users');
    const indexNames = new Set(userIndexes.map(index => String(index.Key_name)));
    if (!indexNames.has('idx_users_email_active')) await c.query('CREATE INDEX idx_users_email_active ON users(email, active)');
    if (!indexNames.has('idx_users_phone_active')) await c.query('CREATE INDEX idx_users_phone_active ON users(phone, active)');
    const [existingMarker] = await c.execute('SELECT setting_key FROM system_settings WHERE setting_key=?', [MIGRATION_KEY]);
    if (existingMarker.length) return { applied: false };
    const [lock] = await c.query("SELECT GET_LOCK(CONCAT(LEFT(DATABASE(),40), ':nvt-accounts-v1'),30) AS acquired");
    if (Number(lock[0]?.acquired) !== 1) throw new Error('Không lấy được khóa khởi tạo tài khoản');
    locked = true;
    const [done] = await c.execute('SELECT setting_key FROM system_settings WHERE setting_key=?', [MIGRATION_KEY]);
    if (done.length) return { applied: false };
    // Thêm vai trò vào cuối ENUM để giữ thứ tự các vai trò cũ; DDL nằm ngoài transaction.
    await c.query("ALTER TABLE users MODIFY role ENUM('ADMIN','LEADER','SALE','UNASSIGNED','MARKETING','ACCOUNTING','MANAGER','HRM') NOT NULL DEFAULT 'UNASSIGNED', MODIFY phone VARCHAR(20) NULL");
    await c.beginTransaction();
    for (const account of accounts) {
      // Ghép bằng email; riêng Admin nhận lại tài khoản seed cũ nếu chưa có email đích.
      const [matches] = await c.execute('SELECT id,email FROM users WHERE LOWER(email)=? FOR UPDATE', [account.email]);
      let existing = matches[0];
      if (!existing && account.role === 'ADMIN') {
        const [legacy] = await c.execute("SELECT id,email FROM users WHERE id='u-admin-start' AND role='ADMIN' FOR UPDATE");
        existing = legacy[0];
      }
      let id = existing?.id;
      if (id) {
        await c.execute('UPDATE users SET email=?,name=?,role=?,password_hash=?,active=1,team_id=NULL,leader_id=NULL WHERE id=?', [account.email,account.name,account.role,account.passwordHash,id]);
      } else {
        id = account.id;
        await c.execute('INSERT INTO users(id,phone,email,name,role,password_hash,active) VALUES (?,NULL,?,?,?,?,1)', [id,account.email,account.name,account.role,account.passwordHash]);
      }
      // Thu hồi phiên cũ sau khi thay mật khẩu/quyền; giữ ID và dữ liệu khách/đơn.
      await c.execute('DELETE FROM crm_sessions WHERE user_id=?', [id]);
      await c.execute("UPDATE crm_documents SET deleted=0 WHERE collection='members' AND id=?", [id]);
    }
    await c.execute('INSERT INTO system_settings(setting_key,setting_value) VALUES (?,?)', [MIGRATION_KEY,JSON.stringify({applied:true,accounts:accounts.map(a=>a.email)})]);
    await c.commit();
    return { applied: true };
  } catch (error) {
    await c.rollback().catch(()=>{});
    throw error;
  } finally {
    if (locked) await c.query("SELECT RELEASE_LOCK(CONCAT(LEFT(DATABASE(),40), ':nvt-accounts-v1'))").catch(()=>{});
    c.release();
  }
}
module.exports = { provisionSystemAccounts, MIGRATION_KEY };
