'use strict';
const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const { db } = require('../database');

// ── GET /api/cleanup/status — show cleanup history & DB stats ────────────────
router.get('/status', ...requireRole('super_admin'), async (req, res, next) => {
  try {
    const recent = await db.all(`
      SELECT * FROM cleanup_history ORDER BY started_at DESC LIMIT 20
    `);

    // PostgreSQL: database size
    const sizeRow = await db.get(`SELECT pg_database_size(current_database()) AS db_size`);
    const dbSize = sizeRow ? sizeRow.db_size : 0;

    // Table row counts
    const tables = ['users', 'centers', 'classes', 'assignments', 'submissions',
      'attendance', 'notifications', 'audit_logs', 'refresh_tokens', 'invite_tokens'];
    const counts = {};
    for (const t of tables) {
      const row = await db.get(`SELECT COUNT(*)::int AS count FROM ${t}`);
      counts[t] = row.count;
    }

    res.json({
      database: { size_bytes: dbSize, size_mb: +(dbSize / (1024 * 1024)).toFixed(2) },
      table_counts: counts,
      recent_cleanups: recent,
    });
  } catch (err) { next(err); }
});

// ── POST /api/cleanup/run — manually trigger a cleanup ───────────────────────
router.post('/run', ...requireRole('super_admin'), async (req, res, next) => {
  try {
    const { type = 'daily' } = req.body;
    const validTypes = ['daily', 'weekly', 'monthly'];
    if (!validTypes.includes(type)) return res.status(400).json({ error: 'Invalid cleanup type' });

    const CleanupOrchestrator = require('../services/cleanup');
    const orchestrator = new CleanupOrchestrator();

    let results;
    if (type === 'daily') results = await orchestrator.runDaily();
    else if (type === 'weekly') results = await orchestrator.runWeekly();
    else results = await orchestrator.runMonthly();

    res.json(results);
  } catch (err) { next(err); }
});

// ── GET /api/cleanup/stats — cleanup stats for period ────────────────────────
router.get('/stats', ...requireRole('super_admin'), async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));

    const stats = await db.get(`
      SELECT
        COUNT(*) AS total_runs,
        COALESCE(SUM(records_affected), 0) AS total_records_deleted,
        ROUND(AVG(records_affected)::numeric, 1) AS avg_records_per_run,
        MAX(records_affected) AS max_records,
        COUNT(CASE WHEN status = 'success' THEN 1 END) AS successful_runs,
        COUNT(CASE WHEN status = 'error' THEN 1 END) AS failed_runs
      FROM cleanup_history
      WHERE started_at > ?
    `, [cutoff.toISOString()]);

    res.json(stats);
  } catch (err) { next(err); }
});

module.exports = router;


