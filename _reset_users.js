require('./load-env');
const bcrypt = require('bcryptjs');
const { db, shutdown } = require('./database');

(async () => {
  try {
    // Get all tables
    const tables = await db.all("SELECT tablename FROM pg_tables WHERE schemaname='public'");
    console.log('Tables:', tables.map(t => t.tablename).join(', '));

    // Delete dependent data first
    const depTables = [
      'audit_logs', 'refresh_tokens', 'notifications',
      'submissions', 'grades', 'assignments',
      'attendance', 'schedule',
      'class_students', 'classes',
      'invite_tokens', 'parent_children'
    ];
    for (const t of depTables) {
      try {
        await db.run(`DELETE FROM ${t}`);
        console.log(`Cleared ${t}`);
      } catch (e) {
        console.log(`Skip ${t}: ${e.message}`);
      }
    }

    // Delete all users
    await db.run('DELETE FROM users');
    console.log('All users deleted');

    // Create superadmin
    const hash = bcrypt.hashSync('Lox1997aya', 12);
    await db.run(
      'INSERT INTO users (center_id, name, username, email, password_hash, role, is_active) VALUES (NULL, ?, ?, ?, ?, ?, 1)',
      ['Super Administrator', 'admin', 'admin@bilimhub.local', hash, 'super_admin']
    );

    const u = await db.get("SELECT id, username, role FROM users WHERE username='admin'");
    console.log('Created:', JSON.stringify(u));
  } catch (e) {
    console.error('Error:', e.message);
  }
  await shutdown();
})();
