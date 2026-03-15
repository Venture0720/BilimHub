'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');

// ── GET /api/tokens — list invite tokens for center ──────────────────────────
router.get('/', ...requireRole('center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const cid = req.user.role === 'super_admin' && req.query.centerId
      ? parseInt(req.query.centerId) : req.user.center_id;

    const tokens = await db.all(`
      SELECT t.*, u.name AS created_by_name, used.name AS used_by_name
      FROM invite_tokens t
      LEFT JOIN users u ON t.created_by = u.id
      LEFT JOIN users used ON t.used_by = used.id
      WHERE t.center_id = ?
      ORDER BY t.created_at DESC
    `, [cid]);
    res.json(tokens);
  } catch (err) { next(err); }
});

// ── POST /api/tokens — create new invite token ──────────────────────────────
router.post('/', ...requireRole('center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { role, label, expiresInDays = 7, linkedStudentId } = req.body;
    const validRoles = ['center_admin', 'teacher', 'student', 'parent'];
    if (!validRoles.includes(role)) return res.status(400).json({ error: 'Invalid role' });

    const cid = req.user.role === 'super_admin' && req.body.centerId
      ? parseInt(req.body.centerId) : req.user.center_id;

    if (role === 'parent') {
      if (!linkedStudentId) return res.status(400).json({ error: 'linkedStudentId required for parent invite' });
      const student = await db.get(`SELECT id FROM users WHERE id = ? AND role = 'student' AND center_id = ?`, [linkedStudentId, cid]);
      if (!student) return res.status(404).json({ error: 'Student not found in this center' });
    }

    const token = crypto.randomBytes(16).toString('hex');
    const expiresAt = new Date(Date.now() + (Math.min(parseInt(expiresInDays) || 7, 90)) * 86400000).toISOString();

    const result = await db.run(`
      INSERT INTO invite_tokens (center_id, token, role, label, linked_student_id, expires_at, created_by)
      VALUES (?,?,?,?,?,?,?) RETURNING id
    `, [cid, token, role, label || null, role === 'parent' ? linkedStudentId : null, expiresAt, req.user.id]);

    const created = await db.get(`SELECT * FROM invite_tokens WHERE id = ?`, [result.lastInsertRowid]);
    res.status(201).json(created);
  } catch (err) { next(err); }
});

// ── GET /api/tokens/validate/:token — public validation ─────────────────────
const validateLimiter = rateLimit({ windowMs: 60_000, max: 10, message: { error: 'Too many attempts, try again later' } });

router.get('/validate/:token', validateLimiter, async (req, res, next) => {
  try {
    const t = await db.get(`
      SELECT t.*, c.name AS center_name FROM invite_tokens t
      JOIN centers c ON t.center_id = c.id
      WHERE t.token = ? AND t.used_by IS NULL AND t.expires_at > NOW()
    `, [req.params.token.trim().toLowerCase()]);

    if (!t) return res.status(404).json({ error: 'Token not found or expired' });
    res.json({ valid: true, role: t.role, centerName: t.center_name, label: t.label });
  } catch (err) { next(err); }
});

// ── DELETE /api/tokens/:id — revoke an unused token ──────────────────────────
router.delete('/:id', ...requireRole('center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const t = await db.get(`SELECT * FROM invite_tokens WHERE id = ? AND used_by IS NULL`, [req.params.id]);
    if (!t) return res.status(404).json({ error: 'Token not found or already used' });
    if (req.user.role !== 'super_admin' && t.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

    await db.run(`DELETE FROM invite_tokens WHERE id = ?`, [t.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
