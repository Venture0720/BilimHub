'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { requireRole, withCenter } = require('../middleware/auth');
const { db } = require('../database');

// ── GET /api/users ─────────────────────────────────────────────────────────
router.get('/', ...requireRole('center_admin','super_admin','teacher'), withCenter, async (req, res, next) => {
  try {
    const { role, search, classId } = req.query;

    if (req.user.role === 'teacher') {
      if (classId) {
        const cls = await db.get(`SELECT id FROM classes WHERE id = ? AND teacher_id = ?`, [classId, req.user.id]);
        if (!cls) return res.status(403).json({ error: 'Not your class' });
        const query = `SELECT u.id, u.name, u.email, u.role, u.is_active FROM users u
                 JOIN enrollments e ON e.student_id = u.id
                 WHERE e.class_id = ? AND u.center_id = ?`;
        return res.json(await db.all(query, [classId, req.centerId]));
      }
    }

    let q = `SELECT id, center_id, name, email, role, is_active, created_at FROM users WHERE center_id = ?`;
    const params = [req.centerId];

    if (req.user.role === 'teacher') {
      q += ` AND role = 'student'`;
    } else {
      if (role) { q += ` AND role = ?`; params.push(role); }
    }
    if (search) { q += ` AND (name ILIKE ? OR email ILIKE ?)`; params.push(`%${search}%`, `%${search}%`); }
    q += ` ORDER BY name ASC`;

    res.json(await db.all(q, params));
  } catch (err) { next(err); }
});

// ── GET /api/users/me/children (for parents) ────────────────────────────────
router.get('/me/children', ...requireRole('parent'), async (req, res, next) => {
  try {
    const children = await db.all(`
      SELECT u.id, u.name, u.email, u.created_at
      FROM users u JOIN parent_student ps ON ps.student_id = u.id
      WHERE ps.parent_id = ?
    `, [req.user.id]);
    res.json(children);
  } catch (err) { next(err); }
});

// ── GET /api/users/:id ──────────────────────────────────────────────────────
router.get('/:id', ...requireRole('center_admin','super_admin','teacher','parent'), async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);

    if (req.user.role === 'parent') {
      const link = await db.get(`SELECT * FROM parent_student WHERE parent_id = ? AND student_id = ?`, [req.user.id, userId]);
      if (!link) return res.status(403).json({ error: 'Forbidden' });
    }

    const user = await db.get(`SELECT id, center_id, name, email, role, is_active, created_at FROM users WHERE id = ?`, [userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    if (req.user.role !== 'super_admin' && user.center_id !== req.user.center_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (user.role === 'student') {
      user.classes = await db.all(`
        SELECT c.id, c.name, c.subject, c.color FROM classes c
        JOIN enrollments e ON e.class_id = c.id
        WHERE e.student_id = ?
      `, [userId]);
    }
    res.json(user);
  } catch (err) { next(err); }
});

// ── PATCH /api/users/me ─────────────────────────────────────────────────────
router.patch('/me', require('../middleware/auth').authenticate, async (req, res, next) => {
  try {
    const { name } = req.body;
    if (!name || !String(name).trim()) return res.status(400).json({ error: 'Name required' });
    if (String(name).trim().length > 200) return res.status(400).json({ error: 'Name must be under 200 characters' });
    await db.run(`UPDATE users SET name = ? WHERE id = ?`, [String(name).trim(), req.user.id]);
    const updated = await db.get(`SELECT id, name, email, role, center_id AS "centerId" FROM users WHERE id = ?`, [req.user.id]);
    res.json(updated);
  } catch (err) { next(err); }
});

// ── PATCH /api/users/:id ─────────────────────────────────────────────────────
router.patch('/:id', ...requireRole('center_admin','super_admin'), withCenter, async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id);
    const user = await db.get(`SELECT * FROM users WHERE id = ? AND center_id = ?`, [userId, req.centerId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const allowed = ['name', 'email', 'is_active'];
    const updates = {};
    allowed.forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE users SET ${sets} WHERE id = ?`, [...Object.values(updates), userId]);
    res.json(await db.get(`SELECT id, name, email, role, is_active FROM users WHERE id = ?`, [userId]));
  } catch (err) { next(err); }
});

// ── POST /api/users/:id/reset-password ──────────────────────────────────────
router.post('/:id/reset-password', ...requireRole('center_admin','super_admin'), withCenter, async (req, res, next) => {
  try {
    const { newPassword } = req.body;
    if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });

    const user = await db.get(`SELECT * FROM users WHERE id = ? AND center_id = ?`, [req.params.id, req.centerId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, user.id]);
    await db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/users/:parentId/children ────────────────────────────────────────
router.post('/:parentId/children', ...requireRole('center_admin','super_admin'), withCenter, async (req, res, next) => {
  try {
    const { studentId } = req.body;
    if (!studentId) return res.status(400).json({ error: 'studentId required' });

    const parent = await db.get(`SELECT id FROM users WHERE id=? AND center_id=? AND role='parent'`, [req.params.parentId, req.centerId]);
    if (!parent) return res.status(404).json({ error: 'Parent not found' });

    const student = await db.get(`SELECT id FROM users WHERE id=? AND center_id=? AND role='student'`, [studentId, req.centerId]);
    if (!student) return res.status(404).json({ error: 'Student not found' });

    await db.run(`INSERT INTO parent_student (parent_id, student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [parent.id, studentId]);
    res.status(201).json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/users/:parentId/children/:studentId ─────────────────────────
router.delete('/:parentId/children/:studentId', ...requireRole('center_admin','super_admin'), withCenter, async (req, res, next) => {
  try {
    await db.run(`DELETE FROM parent_student WHERE parent_id=? AND student_id=?`, [req.params.parentId, req.params.studentId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
