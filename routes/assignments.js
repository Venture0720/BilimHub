'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db, transaction } = require('../database');

// ── GET /api/assignments ──────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { role, id, center_id } = req.user;
    const { classId } = req.query;
    let assignments;

    if (role === 'teacher') {
      let q = `SELECT a.*, c.name AS class_name,
        (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id) AS submission_count,
        (SELECT COUNT(*) FROM enrollments WHERE class_id = a.class_id) AS total_students,
        (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id AND status = 'submitted') AS pending_grading
        FROM assignments a JOIN classes c ON a.class_id = c.id
        WHERE c.teacher_id = ? AND a.center_id = ?`;
      const params = [id, center_id];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      q += ' ORDER BY a.due_date ASC';
      assignments = await db.all(q, params);
    } else if (role === 'student') {
      let q = `SELECT a.*, c.name AS class_name, c.color AS class_color,
        s.id AS submission_id, s.status AS submission_status,
        s.score, s.submitted_at, s.feedback
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = ?
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
        WHERE a.center_id = ? AND a.is_published = 1`;
      const params = [id, id, center_id];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      q += ' ORDER BY a.due_date ASC';
      assignments = await db.all(q, params);
    } else if (role === 'parent') {
      const children = await db.all(`SELECT student_id FROM parent_student WHERE parent_id = ?`, [id]);
      if (!children.length) return res.json([]);
      const childIds = children.map(c => c.student_id);
      const studentId = parseInt(req.query.studentId) || children[0].student_id;
      if (!childIds.includes(studentId)) return res.status(403).json({ error: 'Forbidden' });
      assignments = await db.all(`
        SELECT a.*, c.name AS class_name, c.color AS class_color,
          s.id AS submission_id, s.status AS submission_status, s.score, s.submitted_at, s.feedback
        FROM assignments a
        JOIN classes c ON a.class_id = c.id
        JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = ?
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
        WHERE a.center_id = ? AND a.is_published = 1
        ORDER BY a.due_date ASC
      `, [studentId, studentId, center_id]);
    } else if (role === 'center_admin' || role === 'super_admin') {
      const cid = role === 'super_admin' ? parseInt(req.query.centerId || center_id) : center_id;
      let q = `SELECT a.*, c.name AS class_name,
        (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id) AS submission_count,
        (SELECT COUNT(*) FROM enrollments WHERE class_id = a.class_id) AS total_students,
        (SELECT COUNT(*) FROM submissions WHERE assignment_id = a.id AND status = 'submitted') AS pending_grading
        FROM assignments a JOIN classes c ON a.class_id = c.id WHERE a.center_id = ?`;
      const params = [cid];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      assignments = await db.all(q + ' ORDER BY a.created_at DESC', params);
    } else {
      assignments = [];
    }

    res.json(assignments);
  } catch (err) { next(err); }
});

// ── GET /api/assignments/:id ──────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const a = await db.get(`
      SELECT a.*, c.name AS class_name, c.teacher_id, c.center_id AS class_center_id, u.name AS teacher_name
      FROM assignments a JOIN classes c ON a.class_id = c.id JOIN users u ON c.teacher_id = u.id
      WHERE a.id = ?
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });

    if (req.user.role !== 'super_admin' && a.center_id !== req.user.center_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (req.user.role === 'teacher' && a.teacher_id === req.user.id) {
      a.submissions = await db.all(`
        SELECT s.*, u.name AS student_name FROM submissions s
        JOIN users u ON s.student_id = u.id
        WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC
      `, [a.id]);
    }
    res.json(a);
  } catch (err) { next(err); }
});

// ── POST /api/assignments ──────────────────────────────────────────────────────
router.post('/', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const { classId, title, description, type, gradingScale = '10-point', maxScore, dueDate, isPublished = 1 } = req.body;
    if (!classId || !title || !dueDate) return res.status(400).json({ error: 'classId, title, dueDate required' });
    if (typeof title !== 'string' || title.trim().length > 500) return res.status(400).json({ error: 'title must be 1-500 characters' });
    if (description && (typeof description !== 'string' || description.length > 10000)) return res.status(400).json({ error: 'description must be under 10000 characters' });

    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });

    if (req.user.role === 'teacher' && cls.teacher_id !== req.user.id) {
      return res.status(403).json({ error: 'Not your class' });
    }
    if (req.user.role !== 'super_admin' && cls.center_id !== req.user.center_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const validTypes = ['homework','test','essay','lab','project'];
    const aType = validTypes.includes(type) ? type : 'homework';
    const validScales = ['10-point', '100-point'];
    const scale = validScales.includes(gradingScale) ? gradingScale : '10-point';
    const score = maxScore ? Math.max(1, Math.min(1000, parseInt(maxScore))) : (scale === '10-point' ? 10 : 100);

    const result = await db.run(`
      INSERT INTO assignments (class_id, center_id, created_by, title, description, type, grading_scale, max_score, due_date, is_published)
      VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id
    `, [cls.id, cls.center_id, req.user.id, title.trim(), description || null, aType, scale, score, dueDate, isPublished ? 1 : 0]);

    const assignment = await db.get(`SELECT * FROM assignments WHERE id = ?`, [result.lastInsertRowid]);

    const students = await db.all(`SELECT student_id FROM enrollments WHERE class_id = ?`, [cls.id]);
    await transaction(async (trx) => {
      for (const { student_id } of students) {
        await trx.run(`INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
          [student_id, 'Новое задание', `${cls.name}: ${title} — до ${dueDate}`, 'info']);
      }
    });

    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// ── PATCH /api/assignments/:id ────────────────────────────────────────────────
router.patch('/:id', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const a = await db.get(`
      SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON a.class_id = c.id WHERE a.id = ?
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });
    if (req.user.role === 'teacher' && a.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role !== 'super_admin' && a.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

    const allowed = { title: 'title', description: 'description', maxScore: 'max_score', dueDate: 'due_date', isPublished: 'is_published', type: 'type' };
    const updates = {};
    Object.entries(allowed).forEach(([k, col]) => { if (req.body[k] !== undefined) updates[col] = req.body[k]; });
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'Nothing to update' });

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    await db.run(`UPDATE assignments SET ${sets} WHERE id = ?`, [...Object.values(updates), a.id]);
    res.json(await db.get(`SELECT * FROM assignments WHERE id = ?`, [a.id]));
  } catch (err) { next(err); }
});

// ── DELETE /api/assignments/:id ───────────────────────────────────────────────
router.delete('/:id', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const a = await db.get(`
      SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON a.class_id = c.id WHERE a.id = ?
    `, [req.params.id]);
    if (!a) return res.status(404).json({ error: 'Assignment not found' });
    if (req.user.role === 'teacher' && a.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role !== 'super_admin' && a.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

    // Clean up associated files (Vercel Blob URLs or local disk files)
    const files = await db.all(`SELECT file_path FROM submissions WHERE assignment_id = ? AND file_path IS NOT NULL`, [a.id]);
    for (const f of files) {
      if (!f.file_path) continue;
      try {
        if (f.file_path.startsWith('https://')) {
          const { del } = require('@vercel/blob');
          await del(f.file_path, { token: process.env.BLOB_READ_WRITE_TOKEN });
        } else {
          const fs2 = require('fs');
          const path2 = require('path');
          fs2.unlinkSync(path2.join(path2.resolve('./uploads'), f.file_path));
        }
      } catch { /* best-effort */ }
    }

    await db.run(`DELETE FROM assignments WHERE id = ?`, [a.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
