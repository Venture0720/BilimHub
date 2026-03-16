'use strict';
/**
 * Schedule Module v2 — new tables
 *
 *  lessons          – the core repeating lesson entity
 *  lesson_teachers  – many teachers per lesson (M:M)
 *  lesson_students  – individual-lesson students (M:M)
 *
 * Design notes:
 *  • Lessons repeat weekly (no per-date rows) — simpler, faster.
 *  • An assignment to a "class" covers all enrolled students automatically.
 *  • For 1-on-1 / small-group individual lessons use lesson_type = 'individual'
 *    and list students explicitly in lesson_students.
 *  • Conflict detection is done at the API layer, not DB level.
 */

exports.up = async function (knex) {
  // ── lessons ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('lessons', (t) => {
    t.increments('id').primary();
    t.integer('center_id')
      .notNullable()
      .references('id')
      .inTable('centers')
      .onDelete('CASCADE');
    t.text('title').notNullable();
    t.integer('day_of_week').notNullable();        // 1 = Mon … 7 = Sun
    t.text('start_time').notNullable();            // 'HH:MM'
    t.integer('duration_min').notNullable().defaultTo(60); // default 1 hour
    t.text('color').notNullable().defaultTo('#6366f1');    // hex for UI
    t.text('lesson_type').notNullable().defaultTo('group');// 'group'|'individual'
    t.integer('class_id')                          // for lesson_type = 'group'
      .references('id')
      .inTable('classes')
      .onDelete('SET NULL');
    t.text('notes');
    t.integer('created_by')
      .references('id')
      .inTable('users')
      .onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE lessons ADD CONSTRAINT chk_lesson_day  CHECK (day_of_week BETWEEN 1 AND 7)`);
  await knex.raw(`ALTER TABLE lessons ADD CONSTRAINT chk_lesson_dur  CHECK (duration_min BETWEEN 15 AND 480)`);
  await knex.raw(`ALTER TABLE lessons ADD CONSTRAINT chk_lesson_type CHECK (lesson_type IN ('group','individual'))`);

  // ── lesson_teachers ────────────────────────────────────────────────────────
  await knex.schema.createTable('lesson_teachers', (t) => {
    t.increments('id').primary();
    t.integer('lesson_id')
      .notNullable()
      .references('id')
      .inTable('lessons')
      .onDelete('CASCADE');
    t.integer('teacher_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.unique(['lesson_id', 'teacher_id']);
  });

  // ── lesson_students ────────────────────────────────────────────────────────
  await knex.schema.createTable('lesson_students', (t) => {
    t.increments('id').primary();
    t.integer('lesson_id')
      .notNullable()
      .references('id')
      .inTable('lessons')
      .onDelete('CASCADE');
    t.integer('student_id')
      .notNullable()
      .references('id')
      .inTable('users')
      .onDelete('CASCADE');
    t.unique(['lesson_id', 'student_id']);
  });

  // ── Indexes ────────────────────────────────────────────────────────────────
  await knex.raw('CREATE INDEX idx_lessons_center ON lessons(center_id)');
  await knex.raw('CREATE INDEX idx_lessons_class  ON lessons(class_id)');
  await knex.raw('CREATE INDEX idx_lessons_day    ON lessons(day_of_week)');
  await knex.raw('CREATE INDEX idx_lt_lesson      ON lesson_teachers(lesson_id)');
  await knex.raw('CREATE INDEX idx_lt_teacher     ON lesson_teachers(teacher_id)');
  await knex.raw('CREATE INDEX idx_ls_lesson      ON lesson_students(lesson_id)');
  await knex.raw('CREATE INDEX idx_ls_student     ON lesson_students(student_id)');
};

exports.down = async function (knex) {
  await knex.schema.dropTableIfExists('lesson_students');
  await knex.schema.dropTableIfExists('lesson_teachers');
  await knex.schema.dropTableIfExists('lessons');
};
