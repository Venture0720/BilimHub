'use strict';
require('dotenv').config();
const bcrypt = require('bcryptjs');

const env = process.env.NODE_ENV || 'development';
const config = require('./knexfile')[env];
const knex = require('knex')(config);

// ── Thin async helpers (backward-compatible surface for route files) ─────────

/**
 * Execute a raw SQL query and return the first row (or undefined).
 * Use `?` placeholders — Knex converts them to $1, $2, … for PostgreSQL.
 */
async function get(sql, params = []) {
  const result = await knex.raw(sql, params);
  return result.rows[0] || undefined;
}

/**
 * Execute a raw SQL query and return all rows.
 */
async function all(sql, params = []) {
  const result = await knex.raw(sql, params);
  return result.rows;
}

/**
 * Execute a mutating SQL query (INSERT / UPDATE / DELETE).
 * Returns { changes, lastInsertRowid }.
 * For INSERT, append RETURNING id to your SQL to populate lastInsertRowid.
 */
async function run(sql, params = []) {
  const result = await knex.raw(sql, params);
  return {
    changes: result.rowCount,
    lastInsertRowid: result.rows?.[0]?.id,
  };
}

const db = { get, all, run };

/**
 * Run an async callback inside a PostgreSQL transaction.
 * The callback receives a transaction-scoped `trx` object with the same
 * { get, all, run } interface — use it for all queries inside the txn.
 */
async function transaction(fn) {
  return knex.transaction(async (trxKnex) => {
    const trx = {
      async get(sql, params = []) {
        const result = await trxKnex.raw(sql, params);
        return result.rows[0] || undefined;
      },
      async all(sql, params = []) {
        const result = await trxKnex.raw(sql, params);
        return result.rows;
      },
      async run(sql, params = []) {
        const result = await trxKnex.raw(sql, params);
        return {
          changes: result.rowCount,
          lastInsertRowid: result.rows?.[0]?.id,
        };
      },
    };
    return fn(trx);
  });
}

// Schema is managed via Knex migrations (see ./migrations/)
// Run: npx knex migrate:latest

async function seed() {
  console.log('🌱 Seeding...');

  function relDate(offsetDays) {
    const d = new Date();
    d.setDate(d.getDate() + offsetDays);
    return d.toISOString().slice(0, 10);
  }

  // Clear all tables in dependency order
  const tables = [
    'audit_logs', 'schedules', 'notifications', 'attendance', 'submissions',
    'assignments', 'enrollments', 'parent_student', 'classes',
    'refresh_tokens', 'invite_tokens', 'users', 'centers',
  ];
  for (const t of tables) {
    await knex.raw(`DELETE FROM ${t}`);
    // Reset serial sequences
    await knex.raw(`ALTER SEQUENCE IF EXISTS ${t}_id_seq RESTART WITH 1`);
  }

  const superHash = await bcrypt.hash(process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin2025!', 12);
  await db.run(`INSERT INTO users (name,username,email,password_hash,role) VALUES (?,?,?,?,?)`,
    ['Айдос Сериков', 'super', process.env.SUPER_ADMIN_EMAIL || 'super@educenter.kz', superHash, 'super_admin']);

  const ctr = await db.run(`INSERT INTO centers (name,code,plan) VALUES (?,?,?) RETURNING id`,
    ['Astana Excellence Academy','AEA-2847','professional']);
  const cid = ctr.lastInsertRowid;

  const adminHash = await bcrypt.hash('Admin2025!', 12);
  await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?)`,
    [cid,'Динара Ахметова','admin','admin@aea.kz',adminHash,'center_admin']);

  const tHash = await bcrypt.hash('Teacher2025!', 12);
  const t1 = await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?) RETURNING id`,
    [cid,'Нуров Асхат Бекович','nurov','nurov@aea.kz',tHash,'teacher']);
  const t2 = await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?) RETURNING id`,
    [cid,'Серикова Гаухар Кенесовна','serikova','serikova@aea.kz',tHash,'teacher']);

  const sHash = await bcrypt.hash('Student2025!', 12);
  const sids = [];
  for (const [n, u, e] of [
    ['Алина Нурова','alina','alina@aea.kz'],['Данияр Сейтов','daniyar','daniyar@aea.kz'],
    ['Айгерим Бекова','aigerim','aigerim@aea.kz'],['Максим Ли','maxim','maxim@aea.kz'],['Зарина Омарова','zarina','zarina@aea.kz'],
  ]) {
    const r = await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?) RETURNING id`,
      [cid, n, u, e, sHash, 'student']);
    sids.push(r.lastInsertRowid);
  }

  const pHash = await bcrypt.hash('Parent2025!', 12);
  const p1 = await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?) RETURNING id`,
    [cid,'Гульнара Нурова','parent1','parent1@aea.kz',pHash,'parent']);
  const p2 = await db.run(`INSERT INTO users (center_id,name,username,email,password_hash,role) VALUES (?,?,?,?,?,?) RETURNING id`,
    [cid,'Болат Сейтов','parent2','parent2@aea.kz',pHash,'parent']);
  await db.run(`INSERT INTO parent_student (parent_id,student_id) VALUES (?,?)`, [p1.lastInsertRowid, sids[0]]);
  await db.run(`INSERT INTO parent_student (parent_id,student_id) VALUES (?,?)`, [p2.lastInsertRowid, sids[1]]);

  const c1 = await db.run(`INSERT INTO classes (center_id,teacher_id,name,subject,color) VALUES (?,?,?,?,?) RETURNING id`,
    [cid, t1.lastInsertRowid,'Алгебра 9А','Математика','#6366f1']);
  const c2 = await db.run(`INSERT INTO classes (center_id,teacher_id,name,subject,color) VALUES (?,?,?,?,?) RETURNING id`,
    [cid, t2.lastInsertRowid,'Физика 10Б','Физика','#f59e0b']);
  for (const s of sids) {
    await db.run(`INSERT INTO enrollments (class_id,student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [c1.lastInsertRowid, s]);
    await db.run(`INSERT INTO enrollments (class_id,student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [c2.lastInsertRowid, s]);
  }

  const a1 = await db.run(`INSERT INTO assignments (class_id,center_id,created_by,title,description,type,max_score,due_date) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    [c1.lastInsertRowid, cid, t1.lastInsertRowid,'Тест №4 — Квадратные уравнения','Задачи стр.87-88','test',100,relDate(7)]);
  const a2 = await db.run(`INSERT INTO assignments (class_id,center_id,created_by,title,description,type,max_score,due_date) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    [c1.lastInsertRowid, cid, t1.lastInsertRowid,'§5 Домашнее задание','Упражнения 1-10','homework',20,relDate(-2)]);
  await db.run(`INSERT INTO assignments (class_id,center_id,created_by,title,description,type,max_score,due_date) VALUES (?,?,?,?,?,?,?,?) RETURNING id`,
    [c2.lastInsertRowid, cid, t2.lastInsertRowid,'Закон Ньютона — Д/З §12','Задачи 1-5','homework',20,relDate(-4)]);

  const scores = [18, 15, 19, 13, 17];
  for (let i = 0; i < sids.length; i++) {
    await db.run(`INSERT INTO submissions (assignment_id,student_id,text_answer,score,feedback,graded_by,graded_at,status) VALUES (?,?,?,?,?,?,?,?)`,
      [a2.lastInsertRowid, sids[i], 'Выполнено', scores[i], 'Хорошая работа', t1.lastInsertRowid, new Date().toISOString(), 'graded']);
  }
  for (const sid of sids.slice(0, 3)) {
    await db.run(`INSERT INTO submissions (assignment_id,student_id,text_answer,status) VALUES (?,?,?,?)`,
      [a1.lastInsertRowid, sid, 'Готово', 'submitted']);
  }

  const days = [relDate(-7), relDate(-6), relDate(-5), relDate(-4), relDate(-3)];
  const att = [['present','present','present','absent','present'],['present','late','present','present','present'],['present','present','present','present','present'],['absent','absent','present','present','late'],['present','present','present','present','present']];
  for (let si = 0; si < sids.length; si++) {
    for (let di = 0; di < days.length; di++) {
      await db.run(`INSERT INTO attendance (class_id,student_id,date,status,recorded_by) VALUES (?,?,?,?,?) ON CONFLICT(class_id,student_id,date) DO NOTHING`,
        [c1.lastInsertRowid, sids[si], days[di], att[si][di], t1.lastInsertRowid]);
      await db.run(`INSERT INTO attendance (class_id,student_id,date,status,recorded_by) VALUES (?,?,?,?,?) ON CONFLICT(class_id,student_id,date) DO NOTHING`,
        [c2.lastInsertRowid, sids[si], days[di], att[(si+2)%5][di], t2.lastInsertRowid]);
    }
  }

  for (const sid of sids) {
    await db.run(`INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)`,
      [sid, 'Новое задание', `Тест №4 — до ${relDate(7)}`, 'info']);
    await db.run(`INSERT INTO notifications (user_id,title,body,type) VALUES (?,?,?,?)`,
      [sid, 'Оценка выставлена', '§5 Д/З проверено', 'success']);
  }

  const scheduleRows = [
    [c1.lastInsertRowid, cid, 1, '08:30', '09:15', '101', t1.lastInsertRowid],
    [c1.lastInsertRowid, cid, 3, '08:30', '09:15', '101', t1.lastInsertRowid],
    [c1.lastInsertRowid, cid, 5, '08:30', '09:15', '101', t1.lastInsertRowid],
    [c2.lastInsertRowid, cid, 2, '09:30', '10:15', '202', t2.lastInsertRowid],
    [c2.lastInsertRowid, cid, 4, '09:30', '10:15', '202', t2.lastInsertRowid],
    [c2.lastInsertRowid, cid, 6, '09:30', '10:15', '202', t2.lastInsertRowid],
  ];
  for (const v of scheduleRows) {
    await db.run(`INSERT INTO schedules (class_id,center_id,day_of_week,start_time,end_time,room,created_by) VALUES (?,?,?,?,?,?,?)`, v);
  }

  console.log('\n📋 Демо-аккаунты:');
  ['super@educenter.kz / SuperAdmin2025!','admin@aea.kz / Admin2025!','nurov@aea.kz / Teacher2025!',
   'serikova@aea.kz / Teacher2025!','alina@aea.kz / Student2025!','daniyar@aea.kz / Student2025!','parent1@aea.kz / Parent2025!']
    .forEach(l => console.log(' ', l));
  console.log('\n✅ Seed готов!\n');
}

async function shutdown() {
  await knex.destroy();
}

module.exports = { db, transaction, knex, shutdown };

if (require.main === module && process.argv[2] === 'seed') {
  seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
}
