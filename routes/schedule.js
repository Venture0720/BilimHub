'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');

// ── GET /api/schedule ────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { classId, dayOfWeek } = req.query;
    const { role, id, center_id } = req.user;
    let q, params;

    if (role === 'student') {
      q = `
        SELECT s.*, c.name AS class_name, c.subject, c.color, u.name AS teacher_name
        FROM schedules s
        JOIN classes c ON s.class_id = c.id
        JOIN enrollments e ON e.class_id = c.id AND e.student_id = ?
        LEFT JOIN users u ON c.teacher_id = u.id
        WHERE s.center_id = ?`;
      params = [id, center_id];
      if (dayOfWeek) { q += ' AND s.day_of_week = ?'; params.push(parseInt(dayOfWeek)); }
      q += ' ORDER BY s.day_of_week, s.start_time';
    } else if (role === 'teacher') {
      q = `
        SELECT s.*, c.name AS class_name, c.subject, c.color
        FROM schedules s JOIN classes c ON s.class_id = c.id
        WHERE c.teacher_id = ? AND s.center_id = ?`;
      params = [id, center_id];
      if (dayOfWeek) { q += ' AND s.day_of_week = ?'; params.push(parseInt(dayOfWeek)); }
      q += ' ORDER BY s.day_of_week, s.start_time';
    } else if (role === 'parent') {
      const children = await db.all(`SELECT student_id FROM parent_student WHERE parent_id = ?`, [id]);
      if (!children.length) return res.json([]);
      const sid = parseInt(req.query.studentId) || children[0].student_id;
      if (!children.some(c => c.student_id === sid)) return res.status(403).json({ error: 'Forbidden' });
      q = `
        SELECT s.*, c.name AS class_name, c.subject, c.color, u.name AS teacher_name
        FROM schedules s
        JOIN classes c ON s.class_id = c.id
        JOIN enrollments e ON e.class_id = c.id AND e.student_id = ?
        LEFT JOIN users u ON c.teacher_id = u.id
        WHERE s.center_id = ?`;
      params = [sid, center_id];
      if (dayOfWeek) { q += ' AND s.day_of_week = ?'; params.push(parseInt(dayOfWeek)); }
      q += ' ORDER BY s.day_of_week, s.start_time';
    } else {
      // center_admin / super_admin
      const cid = (role === 'super_admin' && req.query.centerId) ? parseInt(req.query.centerId) : center_id;
      q = `
        SELECT s.*, c.name AS class_name, c.subject, c.color, u.name AS teacher_name
        FROM schedules s
        JOIN classes c ON s.class_id = c.id
        LEFT JOIN users u ON c.teacher_id = u.id
        WHERE s.center_id = ?`;
      params = [cid];
      if (classId) { q += ' AND s.class_id = ?'; params.push(parseInt(classId)); }
      if (dayOfWeek) { q += ' AND s.day_of_week = ?'; params.push(parseInt(dayOfWeek)); }
      q += ' ORDER BY s.day_of_week, s.start_time';
    }

    res.json(await db.all(q, params));
  } catch (err) { next(err); }
});

// ── POST /api/schedule ───────────────────────────────────────────────────────
router.post('/', ...requireRole('center_admin', 'super_admin', 'teacher'), async (req, res, next) => {
  try {
    const { classId, dayOfWeek, startTime, endTime, room } = req.body;
    if (!classId || !dayOfWeek || !startTime || !endTime) {
      return res.status(400).json({ error: 'classId, dayOfWeek, startTime, endTime required' });
    }

    const day = parseInt(dayOfWeek);
    if (day < 1 || day > 7) return res.status(400).json({ error: 'dayOfWeek must be 1-7' });

    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (req.user.role !== 'super_admin' && cls.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && cls.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not your class' });

    // Conflict detection: same room, same day, overlapping time
    if (room) {
      const conflict = await db.get(`
        SELECT s.*, c.name AS class_name FROM schedules s JOIN classes c ON s.class_id = c.id
        WHERE s.center_id = ? AND s.day_of_week = ? AND s.room = ? AND s.start_time < ? AND s.end_time > ?
      `, [cls.center_id, day, room, endTime, startTime]);
      if (conflict) {
        return res.status(409).json({ error: `Room ${room} occupied by ${conflict.class_name} at that time` });
      }
    }

    // Conflict detection: same teacher, same day, overlapping time
    if (cls.teacher_id) {
      const teacherConflict = await db.get(`
        SELECT s.*, c.name AS class_name FROM schedules s JOIN classes c ON s.class_id = c.id
        WHERE c.teacher_id = ? AND s.day_of_week = ? AND s.start_time < ? AND s.end_time > ?
      `, [cls.teacher_id, day, endTime, startTime]);
      if (teacherConflict) {
        return res.status(409).json({ error: `Teacher already has ${teacherConflict.class_name} at that time` });
      }
    }

    const result = await db.run(`
      INSERT INTO schedules (class_id, center_id, day_of_week, start_time, end_time, room, created_by)
      VALUES (?,?,?,?,?,?,?) RETURNING id
    `, [classId, cls.center_id, day, startTime, endTime, room || null, req.user.id]);

    res.status(201).json(await db.get(`SELECT * FROM schedules WHERE id = ?`, [result.lastInsertRowid]));
  } catch (err) { next(err); }
});

// ── PATCH /api/schedule/:id ──────────────────────────────────────────────────
router.patch('/:id', ...requireRole('center_admin', 'super_admin', 'teacher'), async (req, res, next) => {
  try {
    const sched = await db.get(`
      SELECT s.*, c.teacher_id, c.center_id AS cls_center_id FROM schedules s
      JOIN classes c ON s.class_id = c.id WHERE s.id = ?
    `, [req.params.id]);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });
    if (req.user.role !== 'super_admin' && sched.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && sched.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    const allowed = { dayOfWeek: 'day_of_week', startTime: 'start_time', endTime: 'end_time', room: 'room' };
    const updates = {};
    Object.entries(allowed).forEach(([k, col]) => { if (req.body[k] !== undefined) updates[col] = req.body[k]; });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE schedules SET ${sets} WHERE id = ?`, [...Object.values(updates), sched.id]);
    res.json(await db.get(`SELECT * FROM schedules WHERE id = ?`, [sched.id]));
  } catch (err) { next(err); }
});

// ── DELETE /api/schedule/:id ─────────────────────────────────────────────────
router.delete('/:id', ...requireRole('center_admin', 'super_admin', 'teacher'), async (req, res, next) => {
  try {
    const sched = await db.get(`
      SELECT s.*, c.teacher_id FROM schedules s JOIN classes c ON s.class_id = c.id WHERE s.id = ?
    `, [req.params.id]);
    if (!sched) return res.status(404).json({ error: 'Schedule not found' });
    if (req.user.role !== 'super_admin' && sched.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && sched.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });

    await db.run(`DELETE FROM schedules WHERE id = ?`, [sched.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

