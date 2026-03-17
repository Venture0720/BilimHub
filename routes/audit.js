'use strict';
const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const { db } = require('../database');

// ── GET /api/audit — query audit logs ────────────────────────────────────────
router.get('/', ...requireRole('center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { userId, action, entityType, startDate, endDate, limit = 100, offset = 0 } = req.query;
    const { role, center_id } = req.user;

    let q = `
      SELECT al.*, u.name AS user_display_name, u.role AS user_role
      FROM audit_logs al LEFT JOIN users u ON al.user_id = u.id
      WHERE 1=1`;
    const params = [];

    // Center admin can only see logs for their center's users
    if (role === 'center_admin') {
      q += ` AND (al.user_id IN (SELECT id FROM users WHERE center_id = ?) OR al.user_id IS NULL)`;
      params.push(center_id);
    }

    if (userId) { q += ' AND al.user_id = ?'; params.push(parseInt(userId)); }
    if (action) { q += ' AND al.action ILIKE ?'; params.push(`%${action}%`); }
    if (entityType) { q += ' AND al.entity_type = ?'; params.push(entityType); }
    if (startDate) { q += ' AND al.created_at >= ?'; params.push(startDate); }
    if (endDate) { q += ' AND al.created_at <= ?'; params.push(endDate); }

    q += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit) || 100, 500), parseInt(offset) || 0);

    const logs = await db.all(q, params);
    res.json(logs);
  } catch (err) { next(err); }
});

// ── GET /api/audit/stats — summary statistics ────────────────────────────────
router.get('/stats', ...requireRole('center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { days = 30 } = req.query;
    const { role, center_id } = req.user;

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));
    const cutoffISO = cutoff.toISOString();

    let centerFilter = '';
    const baseParams = [cutoffISO];
    if (role === 'center_admin') {
      centerFilter = `AND (al.user_id IN (SELECT id FROM users WHERE center_id = ?) OR al.user_id IS NULL)`;
      baseParams.push(center_id);
    }

    const stats = await db.all(`
      SELECT al.action, COUNT(*) AS count
      FROM audit_logs al
      WHERE al.created_at > ? ${centerFilter}
      GROUP BY al.action ORDER BY count DESC LIMIT 20
    `, baseParams);

    const totalRow = await db.get(`
      SELECT COUNT(*) AS total FROM audit_logs al
      WHERE al.created_at > ? ${centerFilter}
    `, baseParams);

    res.json({ total: totalRow.total, actions: stats, period_days: parseInt(days) });
  } catch (err) { next(err); }
});

module.exports = router;
