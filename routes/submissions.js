'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');
const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const fs = require('fs');

const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');
const MAX_UPLOAD_SIZE = parseInt(process.env.MAX_UPLOAD_SIZE || 10 * 1024 * 1024, 10);
const ALLOWED_EXTENSIONS = new Set(['.pdf', '.doc', '.docx', '.txt', '.jpg', '.jpeg', '.png', '.zip', '.pptx', '.xlsx']);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, crypto.randomUUID() + ext);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_SIZE },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) return cb(new Error('File type not allowed'), false);
    cb(null, true);
  },
}).single('file');

// ── POST /api/submissions — submit an assignment ─────────────────────────────
router.post('/', ...requireRole('student'), (req, res, next) => {
  upload(req, res, async (err) => {
    try {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: `File exceeds ${MAX_UPLOAD_SIZE / (1024*1024)}MB limit` });
        return res.status(400).json({ error: err.message });
      }

      const { assignmentId, textAnswer, comment } = req.body;
      if (!assignmentId) return res.status(400).json({ error: 'assignmentId required' });

      const assignment = await db.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId]);
      if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
      if (assignment.center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

      const enrolled = await db.get(`SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?`, [assignment.class_id, req.user.id]);
      if (!enrolled) return res.status(403).json({ error: 'Not enrolled in this class' });

      const existing = await db.get(`SELECT id, status FROM submissions WHERE assignment_id = ? AND student_id = ?`, [assignmentId, req.user.id]);
      if (existing && existing.status === 'graded') {
        return res.status(400).json({ error: 'Already graded, cannot re-submit' });
      }

      if (!req.file && !textAnswer) {
        return res.status(400).json({ error: 'File or text answer required' });
      }

      if (existing) {
        // Update existing submission
        if (existing.status === 'submitted' || existing.status === 'returned') {
          const sets = [`submitted_at = NOW()`, `status = 'submitted'`];
          const params = [];
          if (req.file) {
            sets.push('file_path = ?', 'file_name = ?');
            params.push(req.file.filename, req.file.originalname);
          }
          if (textAnswer !== undefined) { sets.push('text_answer = ?'); params.push(textAnswer); }
          if (comment !== undefined) { sets.push('comment = ?'); params.push(comment); }
          params.push(existing.id);
          await db.run(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`, params);
          const updated = await db.get(`SELECT * FROM submissions WHERE id = ?`, [existing.id]);
          return res.json(updated);
        }
      }

      // New submission
      const result = await db.run(`
        INSERT INTO submissions (assignment_id, student_id, file_path, file_name, text_answer, comment)
        VALUES (?,?,?,?,?,?) RETURNING id
      `, [assignmentId, req.user.id, req.file?.filename || null, req.file?.originalname || null, textAnswer || null, comment || null]);

      const submission = await db.get(`SELECT * FROM submissions WHERE id = ?`, [result.lastInsertRowid]);
      res.status(201).json(submission);
    } catch (e) { next(e); }
  });
});

// ── GET /api/submissions?assignmentId=&studentId= ────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { assignmentId, studentId } = req.query;
    const { role, id, center_id } = req.user;

    if (assignmentId) {
      const a = await db.get(`SELECT * FROM assignments WHERE id = ?`, [assignmentId]);
      if (!a) return res.status(404).json({ error: 'Assignment not found' });
      if (role !== 'super_admin' && a.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });

      if (role === 'student') {
        const sub = await db.get(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`, [assignmentId, id]);
        return res.json(sub ? [sub] : []);
      }

      const subs = await db.all(`
        SELECT s.*, u.name AS student_name FROM submissions s
        JOIN users u ON s.student_id = u.id WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC
      `, [assignmentId]);
      return res.json(subs);
    }

    if (role === 'student') {
      const subs = await db.all(`
        SELECT s.*, a.title AS assignment_title, a.max_score, a.grading_scale, c.name AS class_name
        FROM submissions s JOIN assignments a ON s.assignment_id = a.id JOIN classes c ON a.class_id = c.id
        WHERE s.student_id = ? AND a.center_id = ? ORDER BY s.submitted_at DESC
      `, [id, center_id]);
      return res.json(subs);
    }

    if (role === 'parent') {
      const sid = parseInt(studentId);
      if (!sid) return res.status(400).json({ error: 'studentId required for parent' });
      const linked = await db.get(`SELECT 1 FROM parent_student WHERE parent_id = ? AND student_id = ?`, [id, sid]);
      if (!linked) return res.status(403).json({ error: 'Forbidden' });
      const subs = await db.all(`
        SELECT s.*, a.title AS assignment_title, a.max_score, a.grading_scale, c.name AS class_name
        FROM submissions s JOIN assignments a ON s.assignment_id = a.id JOIN classes c ON a.class_id = c.id
        WHERE s.student_id = ? AND a.center_id = ? ORDER BY s.submitted_at DESC
      `, [sid, center_id]);
      return res.json(subs);
    }

    // teacher/admin — submitted items pending grading
    let q = `
      SELECT s.*, u.name AS student_name, a.title AS assignment_title, a.max_score, a.grading_scale, c.name AS class_name
      FROM submissions s JOIN users u ON s.student_id = u.id
      JOIN assignments a ON s.assignment_id = a.id JOIN classes c ON a.class_id = c.id
      WHERE a.center_id = ?`;
    const params = [center_id];
    if (role === 'teacher') { q += ' AND c.teacher_id = ?'; params.push(id); }
    q += ` ORDER BY s.submitted_at DESC LIMIT 200`;
    const subs = await db.all(q, params);
    res.json(subs);
  } catch (err) { next(err); }
});

// ── GET /api/submissions/:id ─────────────────────────────────────────────────
router.get('/:id', authenticate, async (req, res, next) => {
  try {
    const sub = await db.get(`
      SELECT s.*, a.title AS assignment_title, a.max_score, a.grading_scale, a.center_id AS a_center_id,
        u.name AS student_name, c.name AS class_name, c.teacher_id
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id
      JOIN users u ON s.student_id = u.id JOIN classes c ON a.class_id = c.id WHERE s.id = ?
    `, [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const { role, id, center_id } = req.user;
    if (role !== 'super_admin' && sub.a_center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'student' && sub.student_id !== id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'parent') {
      const linked = await db.get(`SELECT 1 FROM parent_student WHERE parent_id = ? AND student_id = ?`, [id, sub.student_id]);
      if (!linked) return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(sub);
  } catch (err) { next(err); }
});

// ── PATCH /api/submissions/:id/grade — teacher grades a submission ───────────
router.patch('/:id/grade', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const sub = await db.get(`
      SELECT s.*, a.max_score, a.grading_scale, a.center_id AS a_center_id, c.teacher_id
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id JOIN classes c ON a.class_id = c.id
      WHERE s.id = ?
    `, [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    if (req.user.role === 'teacher' && sub.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role !== 'super_admin' && sub.a_center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

    const { score, feedback } = req.body;
    if (score === undefined && feedback === undefined) return res.status(400).json({ error: 'score or feedback required' });

    const sets = [`status = 'graded'`, `graded_by = ?`, `graded_at = NOW()`];
    const params = [req.user.id];
    if (score !== undefined) {
      const s = parseFloat(score);
      if (isNaN(s) || s < 0 || s > sub.max_score) return res.status(400).json({ error: `Score must be 0-${sub.max_score}` });
      sets.push('score = ?'); params.push(s);
    }
    if (feedback !== undefined) { sets.push('feedback = ?'); params.push(feedback); }
    params.push(sub.id);

    await db.run(`UPDATE submissions SET ${sets.join(', ')} WHERE id = ?`, params);

    // Notify student
    await db.run(`INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
      [sub.student_id, 'Оценка выставлена', `Ваша работа оценена: ${score !== undefined ? score : '—'}`, 'success']);

    res.json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [sub.id]));
  } catch (err) { next(err); }
});

// ── PATCH /api/submissions/:id/return — return for revision ──────────────────
router.patch('/:id/return', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const sub = await db.get(`
      SELECT s.*, a.center_id AS a_center_id, c.teacher_id
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id JOIN classes c ON a.class_id = c.id
      WHERE s.id = ?
    `, [req.params.id]);
    if (!sub) return res.status(404).json({ error: 'Submission not found' });
    if (req.user.role === 'teacher' && sub.teacher_id !== req.user.id) return res.status(403).json({ error: 'Forbidden' });
    if (req.user.role !== 'super_admin' && sub.a_center_id !== req.user.center_id) return res.status(403).json({ error: 'Forbidden' });

    const { feedback } = req.body;
    await db.run(`UPDATE submissions SET status = 'returned', feedback = ? WHERE id = ?`, [feedback || null, sub.id]);
    await db.run(`INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
      [sub.student_id, 'Работа возвращена', feedback || 'Доработайте и отправьте заново', 'warning']);

    res.json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [sub.id]));
  } catch (err) { next(err); }
});

module.exports = router;
