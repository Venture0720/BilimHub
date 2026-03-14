require('dotenv').config();
const bcrypt = require('bcryptjs');
const { db, shutdown } = require('./database');

(async () => {
  try {
    // Delete all demo data (order matters due to FK constraints)
    await db.run('DELETE FROM submissions');
    await db.run('DELETE FROM attendance');
    await db.run('DELETE FROM notifications');
    await db.run('DELETE FROM schedules');
    await db.run('DELETE FROM enrollments');
    await db.run('DELETE FROM assignments');
    await db.run('DELETE FROM classes');
    await db.run('DELETE FROM parent_student');
    await db.run('DELETE FROM invite_tokens');
    await db.run('DELETE FROM refresh_tokens');
    await db.run('DELETE FROM audit_logs');
    await db.run('DELETE FROM users');
    await db.run('DELETE FROM centers');
    console.log('All demo data deleted');

    // Create superadmin
    const hash = bcrypt.hashSync('Lox1997aya', 12);
    await db.run(
      `INSERT INTO users (center_id, name, username, email, password_hash, role, is_active)
       VALUES (NULL, ?, ?, ?, ?, ?, 1)`,
      ['Super Admin', 'admin', 'admin@bilimhub.local', hash, 'super_admin']
    );

    const u = await db.get('SELECT id, username, role FROM users WHERE username = ?', ['admin']);
    console.log('Created superadmin:', JSON.stringify(u));
  } catch (e) {
    console.error('Error:', e.message);
  }
  await shutdown();
})();
