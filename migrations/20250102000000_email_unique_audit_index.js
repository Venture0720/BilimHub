'use strict';

exports.up = async function (knex) {
  // ── Email uniqueness constraint ────────────────────────────────────────────
  // Add unique index on email (partial — only non-null emails)
  await knex.raw(`CREATE UNIQUE INDEX idx_users_email_unique ON users(email) WHERE email IS NOT NULL`);

  // ── Audit logs monthly partitioning prep ───────────────────────────────────
  // Add index for efficient date-range pruning
  await knex.raw(`CREATE INDEX idx_audit_logs_created ON audit_logs(created_at)`);
};

exports.down = async function (knex) {
  await knex.raw(`DROP INDEX IF EXISTS idx_users_email_unique`);
  await knex.raw(`DROP INDEX IF EXISTS idx_audit_logs_created`);
};
