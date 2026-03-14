'use strict';

exports.up = async function (knex) {
  // ── centers ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('centers', (t) => {
    t.increments('id').primary();
    t.text('name').notNullable();
    t.text('code').unique().notNullable();
    t.text('plan').defaultTo('basic');
    t.integer('is_active').defaultTo(1);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── users ──────────────────────────────────────────────────────────────────
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.integer('center_id').references('id').inTable('centers').onDelete('SET NULL');
    t.text('name').notNullable();
    t.text('username').unique().notNullable();
    t.text('email');
    t.text('password_hash').notNullable();
    t.text('role').notNullable();
    t.integer('is_active').defaultTo(1);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE users ADD CONSTRAINT chk_users_role CHECK (role IN ('super_admin','center_admin','teacher','student','parent'))`);

  // ── invite_tokens ──────────────────────────────────────────────────────────
  await knex.schema.createTable('invite_tokens', (t) => {
    t.increments('id').primary();
    t.integer('center_id').notNullable().references('id').inTable('centers').onDelete('CASCADE');
    t.text('token').unique().notNullable();
    t.text('role').notNullable();
    t.text('label');
    t.integer('linked_student_id').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('expires_at').notNullable();
    t.integer('used_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('used_at');
    t.integer('created_by').references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE invite_tokens ADD CONSTRAINT chk_invite_role CHECK (role IN ('center_admin','teacher','student','parent'))`);

  // ── refresh_tokens ─────────────────────────────────────────────────────────
  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('token_hash').notNullable();
    t.timestamp('expires_at').notNullable();
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── classes ────────────────────────────────────────────────────────────────
  await knex.schema.createTable('classes', (t) => {
    t.increments('id').primary();
    t.integer('center_id').notNullable().references('id').inTable('centers').onDelete('CASCADE');
    t.integer('teacher_id').references('id').inTable('users').onDelete('SET NULL');
    t.text('name').notNullable();
    t.text('subject');
    t.text('color').defaultTo('#6366f1');
    t.integer('is_active').defaultTo(1);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── enrollments ────────────────────────────────────────────────────────────
  await knex.schema.createTable('enrollments', (t) => {
    t.increments('id').primary();
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('CASCADE');
    t.integer('student_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('enrolled_at').defaultTo(knex.fn.now());
    t.unique(['class_id', 'student_id']);
  });

  // ── parent_student ─────────────────────────────────────────────────────────
  await knex.schema.createTable('parent_student', (t) => {
    t.increments('id').primary();
    t.integer('parent_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.integer('student_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.unique(['parent_id', 'student_id']);
  });

  // ── assignments ────────────────────────────────────────────────────────────
  await knex.schema.createTable('assignments', (t) => {
    t.increments('id').primary();
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('CASCADE');
    t.integer('center_id').notNullable().references('id').inTable('centers').onDelete('CASCADE');
    t.integer('created_by').notNullable().references('id').inTable('users');
    t.text('title').notNullable();
    t.text('description');
    t.text('type').defaultTo('homework');
    t.text('grading_scale').defaultTo('10-point');
    t.integer('max_score').notNullable().defaultTo(10);
    t.date('due_date').notNullable();
    t.integer('is_published').defaultTo(1);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE assignments ADD CONSTRAINT chk_assign_type CHECK (type IN ('homework','test','essay','lab','project'))`);
  await knex.raw(`ALTER TABLE assignments ADD CONSTRAINT chk_assign_scale CHECK (grading_scale IN ('10-point','100-point'))`);

  // ── submissions ────────────────────────────────────────────────────────────
  await knex.schema.createTable('submissions', (t) => {
    t.increments('id').primary();
    t.integer('assignment_id').notNullable().references('id').inTable('assignments').onDelete('CASCADE');
    t.integer('student_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('file_path');
    t.text('file_name');
    t.text('text_answer');
    t.text('comment');
    t.timestamp('submitted_at').defaultTo(knex.fn.now());
    t.float('score');
    t.text('feedback');
    t.integer('graded_by').references('id').inTable('users');
    t.timestamp('graded_at');
    t.text('status').defaultTo('submitted');
    t.unique(['assignment_id', 'student_id']);
  });
  await knex.raw(`ALTER TABLE submissions ADD CONSTRAINT chk_sub_status CHECK (status IN ('submitted','graded','returned'))`);

  // ── attendance ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('attendance', (t) => {
    t.increments('id').primary();
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('CASCADE');
    t.integer('student_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.date('date').notNullable();
    t.text('status').defaultTo('present');
    t.text('note');
    t.integer('recorded_by').references('id').inTable('users');
    t.unique(['class_id', 'student_id', 'date']);
  });
  await knex.raw(`ALTER TABLE attendance ADD CONSTRAINT chk_att_status CHECK (status IN ('present','absent','late','excused'))`);

  // ── notifications ──────────────────────────────────────────────────────────
  await knex.schema.createTable('notifications', (t) => {
    t.increments('id').primary();
    t.integer('user_id').notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.text('title').notNullable();
    t.text('body');
    t.text('type').defaultTo('info');
    t.integer('is_read').defaultTo(0);
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE notifications ADD CONSTRAINT chk_notif_type CHECK (type IN ('info','success','warning','error'))`);

  // ── schedules ──────────────────────────────────────────────────────────────
  await knex.schema.createTable('schedules', (t) => {
    t.increments('id').primary();
    t.integer('class_id').notNullable().references('id').inTable('classes').onDelete('CASCADE');
    t.integer('center_id').notNullable().references('id').inTable('centers').onDelete('CASCADE');
    t.integer('day_of_week').notNullable();
    t.text('start_time').notNullable();
    t.text('end_time').notNullable();
    t.text('room');
    t.integer('created_by').references('id').inTable('users');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });
  await knex.raw(`ALTER TABLE schedules ADD CONSTRAINT chk_day CHECK (day_of_week BETWEEN 1 AND 7)`);

  // ── audit_logs ─────────────────────────────────────────────────────────────
  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id').primary();
    t.integer('user_id').references('id').inTable('users').onDelete('SET NULL');
    t.text('user_name');
    t.text('action').notNullable();
    t.text('entity_type');
    t.integer('entity_id');
    t.text('details');
    t.text('ip');
    t.timestamp('created_at').defaultTo(knex.fn.now());
  });

  // ── cleanup_history ────────────────────────────────────────────────────────
  await knex.schema.createTable('cleanup_history', (t) => {
    t.increments('id').primary();
    t.text('cleanup_type').notNullable();
    t.integer('records_affected').defaultTo(0);
    t.integer('bytes_freed').defaultTo(0);
    t.text('status').defaultTo('success');
    t.text('error_message');
    t.text('details');
    t.text('executed_by').defaultTo('system_cron');
    t.timestamp('started_at').notNullable();
    t.timestamp('completed_at');
  });
  await knex.raw(`ALTER TABLE cleanup_history ADD CONSTRAINT chk_cleanup_status CHECK (status IN ('success','error','partial'))`);

  // ── Indexes ────────────────────────────────────────────────────────────────
  await knex.raw('CREATE INDEX idx_users_email ON users(email)');
  await knex.raw('CREATE INDEX idx_users_center ON users(center_id)');
  await knex.raw('CREATE INDEX idx_users_username ON users(username)');
  await knex.raw('CREATE INDEX idx_tokens_token ON invite_tokens(token)');
  await knex.raw('CREATE INDEX idx_invite_expires ON invite_tokens(expires_at)');
  await knex.raw('CREATE INDEX idx_refresh_user ON refresh_tokens(user_id)');
  await knex.raw('CREATE INDEX idx_refresh_hash ON refresh_tokens(token_hash)');
  await knex.raw('CREATE INDEX idx_submissions_asgn ON submissions(assignment_id)');
  await knex.raw('CREATE INDEX idx_submissions_std ON submissions(student_id)');
  await knex.raw('CREATE INDEX idx_attendance_class ON attendance(class_id, date)');
  await knex.raw('CREATE INDEX idx_notif_user ON notifications(user_id, is_read)');
  await knex.raw('CREATE INDEX idx_assignments_class_due ON assignments(class_id, due_date)');
  await knex.raw('CREATE INDEX idx_classes_teacher ON classes(teacher_id)');
  await knex.raw('CREATE INDEX idx_classes_center ON classes(center_id)');
  await knex.raw('CREATE INDEX idx_schedule_center ON schedules(center_id, day_of_week)');
  await knex.raw('CREATE INDEX idx_audit_user ON audit_logs(user_id, created_at)');
  await knex.raw('CREATE INDEX idx_audit_time ON audit_logs(created_at)');
  await knex.raw('CREATE INDEX idx_cleanup_type ON cleanup_history(cleanup_type, started_at)');
  await knex.raw('CREATE INDEX idx_cleanup_time ON cleanup_history(started_at)');
};

exports.down = async function (knex) {
  const tables = [
    'cleanup_history', 'audit_logs', 'schedules', 'notifications',
    'attendance', 'submissions', 'assignments', 'parent_student',
    'enrollments', 'classes', 'refresh_tokens', 'invite_tokens',
    'users', 'centers',
  ];
  for (const table of tables) {
    await knex.schema.dropTableIfExists(table);
  }
};
