'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db, transaction } = require('../database');

// ── GET /api/attendance — get attendance records ─────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { classId, date, studentId, startDate, endDate } = req.query;
    const { role, id, center_id } = req.user;

    // ── Student: own attendance ──
    if (role === 'student') {
      let q = `
        SELECT att.*, c.name AS class_name, c.color
        FROM attendance att JOIN classes c ON att.class_id = c.id
        JOIN enrollments e ON e.class_id = att.class_id AND e.student_id = att.student_id
        WHERE att.student_id = ? AND c.center_id = ?`;
      const params = [id, center_id];
      if (classId) { q += ' AND att.class_id = ?'; params.push(classId); }
      if (startDate) { q += ' AND att.date >= ?'; params.push(startDate); }
      if (endDate) { q += ' AND att.date <= ?'; params.push(endDate); }
      q += ' ORDER BY att.date DESC';
      return res.json(await db.all(q, params));
    }

    // ── Parent: child's attendance ──
    if (role === 'parent') {
      const sid = parseInt(studentId);
      if (!sid) return res.status(400).json({ error: 'studentId required' });
      const linked = await db.get(`SELECT 1 FROM parent_student WHERE parent_id = ? AND student_id = ?`, [id, sid]);
      if (!linked) return res.status(403).json({ error: 'Forbidden' });

      let q = `
        SELECT att.*, c.name AS class_name, c.color
        FROM attendance att JOIN classes c ON att.class_id = c.id
        WHERE att.student_id = ? AND c.center_id = ?`;
      const params = [sid, center_id];
      if (classId) { q += ' AND att.class_id = ?'; params.push(classId); }
      if (startDate) { q += ' AND att.date >= ?'; params.push(startDate); }
      if (endDate) { q += ' AND att.date <= ?'; params.push(endDate); }
      q += ' ORDER BY att.date DESC';
      return res.json(await db.all(q, params));
    }

    // ── Teacher / Admin: class attendance for a given date ──
    if (!classId) return res.status(400).json({ error: 'classId required' });
    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (role !== 'super_admin' && cls.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'teacher' && cls.teacher_id !== id) return res.status(403).json({ error: 'Not your class' });

    const students = await db.all(`
      SELECT u.id, u.name FROM users u JOIN enrollments e ON e.student_id = u.id
      WHERE e.class_id = ? ORDER BY u.name
    `, [classId]);

    if (date) {
      const records = await db.all(`SELECT * FROM attendance WHERE class_id = ? AND date = ?`, [classId, date]);
      const recMap = {};
      records.forEach(r => { recMap[r.student_id] = r; });
      const result = students.map(s => ({
        student_id: s.id, student_name: s.name,
        status: recMap[s.id]?.status || null,
        note: recMap[s.id]?.note || null,
        id: recMap[s.id]?.id || null,
      }));
      return res.json(result);
    }

    // Range query
    let q = `SELECT att.*, u.name AS student_name FROM attendance att
      JOIN users u ON att.student_id = u.id WHERE att.class_id = ?`;
    const params = [classId];
    if (startDate) { q += ' AND att.date >= ?'; params.push(startDate); }
    if (endDate) { q += ' AND att.date <= ?'; params.push(endDate); }
    q += ' ORDER BY att.date DESC, u.name';
    res.json(await db.all(q, params));
  } catch (err) { next(err); }
});

// ── POST /api/attendance — bulk upsert attendance for a class+date ───────────
router.post('/', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { classId, date, records } = req.body;
    if (!classId || !date || !Array.isArray(records)) {
      return res.status(400).json({ error: 'classId, date, records[] required' });
    }

    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (req.user.role !== 'super_admin' && cls.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role === 'teacher' && cls.teacher_id !== req.user.id) return res.status(403).json({ error: 'Not your class' });

    const validStatuses = new Set(['present', 'absent', 'late', 'excused']);
    const filtered = records.filter(r => r.studentId && validStatuses.has(r.status));

    await transaction(async (trx) => {
      for (const r of filtered) {
        await trx.run(`
          INSERT INTO attendance (class_id, student_id, date, status, note, recorded_by)
          VALUES (?,?,?,?,?,?)
          ON CONFLICT(class_id, student_id, date) DO UPDATE SET status = EXCLUDED.status, note = EXCLUDED.note, recorded_by = EXCLUDED.recorded_by
        `, [classId, r.studentId, date, r.status, r.note || null, req.user.id]);
      }
    });

    // Return updated records
    const updated = await db.all(`
      SELECT att.*, u.name AS student_name FROM attendance att
      JOIN users u ON att.student_id = u.id WHERE att.class_id = ? AND att.date = ? ORDER BY u.name
    `, [classId, date]);
    res.json(updated);
  } catch (err) { next(err); }
});

// ── GET /api/attendance/stats — attendance stats for a class ─────────────────
router.get('/stats', authenticate, async (req, res, next) => {
  try {
    const { classId, startDate, endDate, studentId } = req.query;
    const { role, id, center_id } = req.user;

    // Students: own stats
    if (role === 'student') {
      const stats = await db.all(`
        SELECT c.id AS class_id, c.name AS class_name, c.color,
          COUNT(*) AS total,
          COUNT(CASE WHEN att.status = 'present' THEN 1 END) AS present,
          COUNT(CASE WHEN att.status = 'absent' THEN 1 END) AS absent,
          COUNT(CASE WHEN att.status = 'late' THEN 1 END) AS late,
          COUNT(CASE WHEN att.status = 'excused' THEN 1 END) AS excused
        FROM attendance att JOIN classes c ON att.class_id = c.id
        WHERE att.student_id = ? AND c.center_id = ?
        GROUP BY c.id, c.name, c.color
      `, [id, center_id]);
      return res.json(stats);
    }

    if (!classId) return res.status(400).json({ error: 'classId required' });
    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (role !== 'super_admin' && cls.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });

    let q = `
      SELECT u.id AS student_id, u.name AS student_name,
        COUNT(*) AS total,
        COUNT(CASE WHEN att.status = 'present' THEN 1 END) AS present,
        COUNT(CASE WHEN att.status = 'absent' THEN 1 END) AS absent,
        COUNT(CASE WHEN att.status = 'late' THEN 1 END) AS late,
        COUNT(CASE WHEN att.status = 'excused' THEN 1 END) AS excused
      FROM attendance att JOIN users u ON att.student_id = u.id
      WHERE att.class_id = ?`;
    const params = [classId];
    if (startDate) { q += ' AND att.date >= ?'; params.push(startDate); }
    if (endDate) { q += ' AND att.date <= ?'; params.push(endDate); }
    q += ' GROUP BY u.id, u.name ORDER BY u.name';

    res.json(await db.all(q, params));
  } catch (err) { next(err); }
});

module.exports = router;
