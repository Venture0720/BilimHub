'use strict';
const router = require('express').Router();
const { requireRole, withCenter, authenticate } = require('../middleware/auth');
const { db, transaction } = require('../database');

// ── GET /api/classes ──────────────────────────────────────────────────────────
router.get('/', authenticate, withCenter, async (req, res, next) => {
  try {
    const { role, id } = req.user;
    let classes;

    if (role === 'super_admin' || role === 'center_admin') {
      classes = await db.all(`
        SELECT c.*, u.name AS teacher_name,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) AS student_count
        FROM classes c LEFT JOIN users u ON c.teacher_id = u.id
        WHERE c.center_id = ? AND c.is_active = 1 ORDER BY c.name
      `, [req.centerId]);
    } else if (role === 'teacher') {
      classes = await db.all(`
        SELECT c.*,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) AS student_count
        FROM classes c WHERE c.center_id = ? AND c.teacher_id = ? AND c.is_active = 1 ORDER BY c.name
      `, [req.centerId, id]);
    } else if (role === 'student') {
      classes = await db.all(`
        SELECT c.*, u.name AS teacher_name,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) AS student_count
        FROM classes c JOIN enrollments e ON e.class_id = c.id LEFT JOIN users u ON c.teacher_id = u.id
        WHERE e.student_id = ? AND c.center_id = ? AND c.is_active = 1 ORDER BY c.name
      `, [id, req.centerId]);
    } else if (role === 'parent') {
      const children = await db.all(`SELECT student_id FROM parent_student WHERE parent_id = ?`, [id]);
      if (!children.length) return res.json([]);
      const studentIds = children.map(c => c.student_id);
      const placeholders = studentIds.map(() => '?').join(',');
      classes = await db.all(`
        SELECT DISTINCT c.*, u.name AS teacher_name,
          (SELECT COUNT(*) FROM enrollments WHERE class_id = c.id) AS student_count
        FROM classes c JOIN enrollments e ON e.class_id = c.id LEFT JOIN users u ON c.teacher_id = u.id
        WHERE e.student_id IN (${placeholders}) AND c.center_id = ? AND c.is_active = 1
      `, [...studentIds, req.centerId]);
    } else {
      classes = [];
    }
    res.json(classes);
  } catch (err) { next(err); }
});

// ── GET /api/classes/:id ──────────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const cls = await db.get(`
      SELECT c.*, u.name AS teacher_name FROM classes c
      LEFT JOIN users u ON c.teacher_id = u.id WHERE c.id = ?
    `, [req.params.id]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (req.user.role !== 'super_admin' && cls.center_id !== req.user.center_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    cls.students = await db.all(`
      SELECT u.id, u.name, u.email FROM users u
      JOIN enrollments e ON e.student_id = u.id WHERE e.class_id = ? ORDER BY u.name
    `, [cls.id]);

    res.json(cls);
  } catch (err) { next(err); }
});

// ── POST /api/classes ──────────────────────────────────────────────────────────
router.post('/', authenticate, withCenter, async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    if (!['super_admin','center_admin','teacher'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { name, subject, teacherId, color } = req.body;
    if (!name) return res.status(400).json({ error: 'Class name required' });

    let resolvedTeacherId = userId;
    if (role === 'center_admin' || role === 'super_admin') {
      if (teacherId) {
        const teacher = await db.get(`SELECT id FROM users WHERE id=? AND center_id=? AND role='teacher'`, [teacherId, req.centerId]);
        if (!teacher) return res.status(400).json({ error: 'Teacher not found in this center' });
      }
      resolvedTeacherId = teacherId || null;
    }

    const result = await db.run(`
      INSERT INTO classes (center_id, teacher_id, name, subject, color) VALUES (?,?,?,?,?) RETURNING id
    `, [req.centerId, resolvedTeacherId, name.trim(), subject || null, color || '#6366f1']);

    res.status(201).json(await db.get(`SELECT * FROM classes WHERE id = ?`, [result.lastInsertRowid]));
  } catch (err) { next(err); }
});

// ── PATCH /api/classes/:id ─────────────────────────────────────────────────────
router.patch('/:id', ...requireRole('center_admin','super_admin'), withCenter, async (req, res, next) => {
  try {
    const cls = await db.get(`SELECT * FROM classes WHERE id = ? AND center_id = ?`, [req.params.id, req.centerId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    const updates = {};
    if (req.body.teacherId !== undefined) updates.teacher_id = req.body.teacherId;
    ['name','subject','color','is_active'].forEach(f => { if (req.body[f] !== undefined) updates[f] = req.body[f]; });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE classes SET ${sets} WHERE id = ?`, [...Object.values(updates), cls.id]);
    res.json(await db.get(`SELECT * FROM classes WHERE id = ?`, [cls.id]));
  } catch (err) { next(err); }
});

// ── POST /api/classes/:id/enroll ──────────────────────────────────────────────
router.post('/:id/enroll', authenticate, withCenter, async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    if (!['super_admin','center_admin','teacher'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cls = await db.get(`SELECT * FROM classes WHERE id = ? AND center_id = ?`, [req.params.id, req.centerId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (role === 'teacher' && cls.teacher_id !== userId) {
      return res.status(403).json({ error: 'You can only enroll students into your own classes' });
    }

    const { studentIds = [] } = req.body;
    if (!Array.isArray(studentIds) || !studentIds.length) return res.status(400).json({ error: 'studentIds array required' });

    await transaction(async (trx) => {
      for (const sid of studentIds) {
        const student = await trx.get(`SELECT id FROM users WHERE id=? AND center_id=? AND role='student'`, [sid, req.centerId]);
        if (student) await trx.run(`INSERT INTO enrollments (class_id, student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [cls.id, sid]);
      }
    });

    res.json({ enrolled: studentIds.length });
  } catch (err) { next(err); }
});

// ── POST /api/classes/:id/invite-student ─────────────────────────────────────
router.post('/:id/invite-student', authenticate, withCenter, async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    if (!['super_admin','center_admin','teacher'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cls = await db.get(`SELECT * FROM classes WHERE id = ? AND center_id = ?`, [req.params.id, req.centerId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (role === 'teacher' && cls.teacher_id !== userId) {
      return res.status(403).json({ error: 'You can only invite students into your own classes' });
    }

    const { email } = req.body;
    if (!email || !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Valid email required' });
    }

    const existing = await db.get(`SELECT id, name FROM users WHERE email=? AND center_id=? AND role='student'`, [email.toLowerCase().trim(), req.centerId]);

    if (existing) {
      await db.run(`INSERT INTO enrollments (class_id, student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [cls.id, existing.id]);
      return res.json({ action: 'enrolled', student: existing });
    }

    const center = await db.get(`SELECT code FROM centers WHERE id = ?`, [req.centerId]);
    const crypto = require('crypto');
    const prefix = 'STD';
    const code = center.code.replace(/[^A-Z0-9]/g, '').slice(0, 7);
    const rand = crypto.randomBytes(16).toString('hex').toUpperCase();
    const token = `${prefix}-${code}-${rand}`;
    const expiresAt = new Date(Date.now() + 30 * 86400000).toISOString();
    const label = `Invite for ${email} → ${cls.name}`;

    const result = await db.run(`
      INSERT INTO invite_tokens (center_id, token, role, label, expires_at, created_by)
      VALUES (?, ?, 'student', ?, ?, ?) RETURNING id
    `, [req.centerId, token, label, expiresAt, userId]);

    const created = await db.get(`SELECT * FROM invite_tokens WHERE id = ?`, [result.lastInsertRowid]);
    res.status(201).json({ action: 'invited', token: created });
  } catch (err) { next(err); }
});

// ── DELETE /api/classes/:id/students/:studentId ─────────────────────────────
router.delete('/:id/students/:studentId', authenticate, withCenter, async (req, res, next) => {
  try {
    const { role, id: userId } = req.user;
    if (!['super_admin','center_admin','teacher'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const cls = await db.get(`SELECT * FROM classes WHERE id = ? AND center_id = ?`, [req.params.id, req.centerId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (role === 'teacher' && cls.teacher_id !== userId) return res.status(403).json({ error: 'Forbidden' });

    await db.run(`DELETE FROM enrollments WHERE class_id = ? AND student_id = ?`, [cls.id, req.params.studentId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
