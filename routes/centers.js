'use strict';
const router = require('express').Router();
const { requireRole } = require('../middleware/auth');
const { db } = require('../database');

function genCode() {
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const prefix = Array.from({ length: 3 }, () => letters[Math.floor(Math.random() * letters.length)]).join('');
  const num = String(Math.floor(1000 + Math.random() * 9000));
  return `${prefix}-${num}`;
}

// ── GET /api/centers ────────────────────────────────────────────────────────
router.get('/', ...requireRole('super_admin', 'center_admin'), async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      const centers = await db.all(`
        SELECT c.*,
          (SELECT COUNT(*) FROM users WHERE center_id = c.id AND role = 'student' AND is_active = 1) AS student_count,
          (SELECT COUNT(*) FROM users WHERE center_id = c.id AND role = 'teacher' AND is_active = 1) AS teacher_count
        FROM centers c ORDER BY c.created_at DESC
      `);
      res.json(centers);
    } else {
      const center = await db.get(`SELECT * FROM centers WHERE id = ?`, [req.user.center_id]);
      res.json(center ? [center] : []);
    }
  } catch (err) { next(err); }
});

// ── POST /api/centers ─────────────────────────────────────────────────────────
router.post('/', ...requireRole('super_admin'), async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Center name required' });

    let code;
    do { code = genCode(); } while (await db.get(`SELECT id FROM centers WHERE code = ?`, [code]));

    const result = await db.run(`INSERT INTO centers (name, code) VALUES (?,?) RETURNING id`, [name.trim(), code]);
    res.status(201).json(await db.get(`SELECT * FROM centers WHERE id = ?`, [result.lastInsertRowid]));
  } catch (err) { next(err); }
});

// ── PATCH /api/centers/:id ─────────────────────────────────────────────────────
router.patch('/:id', ...requireRole('super_admin', 'center_admin'), async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (req.user.role === 'center_admin' && req.user.center_id !== id) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const center = await db.get(`SELECT * FROM centers WHERE id = ?`, [id]);
    if (!center) return res.status(404).json({ error: 'Center not found' });

    const allowed = req.user.role === 'super_admin'
      ? ['name', 'is_active']
      : ['name'];

    const updates = {};
    allowed.forEach(field => { if (req.body[field] !== undefined) updates[field] = req.body[field]; });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE centers SET ${sets} WHERE id = ?`, [...Object.values(updates), id]);

    res.json(await db.get(`SELECT * FROM centers WHERE id = ?`, [id]));
  } catch (err) { next(err); }
});

// ── GET /api/centers/stats ────────────────────────────────────────────────────
router.get('/stats', ...requireRole('super_admin', 'center_admin'), async (req, res, next) => {
  try {
    const centerId = req.user.role === 'super_admin'
      ? parseInt(req.query.centerId)
      : req.user.center_id;
    if (!centerId) return res.status(400).json({ error: 'centerId required' });

    const stats = {
      students: (await db.get(`SELECT COUNT(*) AS n FROM users WHERE center_id=? AND role='student' AND is_active=1`, [centerId])).n,
      teachers: (await db.get(`SELECT COUNT(*) AS n FROM users WHERE center_id=? AND role='teacher' AND is_active=1`, [centerId])).n,
      classes:  (await db.get(`SELECT COUNT(*) AS n FROM classes WHERE center_id=? AND is_active=1`, [centerId])).n,
      assignments: (await db.get(`SELECT COUNT(*) AS n FROM assignments WHERE center_id=?`, [centerId])).n,
      pendingSubmissions: (await db.get(`
        SELECT COUNT(*) AS n FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        WHERE a.center_id = ? AND s.status = 'submitted'
      `, [centerId])).n,
      activeTokens: (await db.get(`
        SELECT COUNT(*) AS n FROM invite_tokens
        WHERE center_id = ? AND used_by IS NULL AND expires_at > NOW()
      `, [centerId])).n,
    };
    res.json(stats);
  } catch (err) { next(err); }
});

module.exports = router;
