'use strict';
/**
 * /api/hw — Homework & Grading Module (v2)
 */

const router = require('express').Router();
const path   = require('path');
const crypto = require('crypto');

const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');
const { validate } = require('../utils/validate');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Allowed MIME types for student file uploads */
const ALLOWED_MIME = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain',
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Allowed extensions (matched against filename for extra safety) */
const ALLOWED_EXT = new Set([
  '.pdf','.doc','.docx','.txt','.jpg','.jpeg','.png','.gif',
  '.webp','.zip','.ppt','.pptx','.xls','.xlsx',
]);

function assertTeacherOwnsClass(cls, user) {
  if (!cls) throw Object.assign(new Error('Class not found'), { status: 404 });
  if (user.role !== 'super_admin' && cls.center_id !== user.center_id)
    throw Object.assign(new Error('Forbidden'), { status: 403 });
  if (user.role === 'teacher' && cls.teacher_id !== user.id)
    throw Object.assign(new Error('Not your class'), { status: 403 });
}

// ─────────────────────────────────────────────────────────────────────────────
// FILE UPLOAD TOKEN  POST /api/hw/upload-token
// ─────────────────────────────────────────────────────────────────────────────
/**
 * Issues a Vercel Blob *client token* so the browser can upload a file directly
 * to the CDN without going through this serverless function.
 *
 * Client flow:
 *   1. POST /api/hw/upload-token  { filename, contentType }
 *   2. Receive  { clientToken, blobPathname }
 *   3. PUT to Vercel Blob CDN using clientToken  (up to 500 MB)
 *   4. Receive blob URL, include in submission/assignment POST
 */
router.post('/upload-token', authenticate, async (req, res, next) => {
  try {
    const { filename, contentType } = req.body || {};
    if (!filename || !contentType) {
      return res.status(400).json({ error: 'filename and contentType required' });
    }

    const ext = path.extname(filename).toLowerCase();
    if (!ALLOWED_EXT.has(ext) || !ALLOWED_MIME.has(contentType)) {
      return res.status(400).json({ error: 'Тип файла не поддерживается' });
    }

    // Local dev (no token) — skip blob, use disk later
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      return res.json({ clientToken: null, blobPathname: null, localMode: true });
    }

    const { generateClientTokenFromReadWriteToken } = require('@vercel/blob/client');

    const uniqueId  = crypto.randomUUID();
    const blobPathname = `hw/${req.user.id}/${uniqueId}${ext}`;

    const clientToken = await generateClientTokenFromReadWriteToken({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      pathname: blobPathname,
      maximumSizeInBytes: 50 * 1024 * 1024,   // 50 MB cap
      allowedContentTypes: [contentType],
    });

    res.json({ clientToken, blobPathname });
  } catch (err) {
    next(err);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ASSIGNMENTS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/hw/assignments
 * Teacher/admin: all assignments in their classes, with submission stats.
 * Student:       assignments in their enrolled classes (with own submission status).
 */
router.get('/assignments', authenticate, async (req, res, next) => {
  try {
    const { role, id, center_id } = req.user;
    const { classId } = req.query;
    const page  = Math.max(1, parseInt(req.query.page)  || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    if (role === 'teacher') {
      let q = `
        SELECT
          a.*,
          c.name  AS class_name,
          c.color AS class_color,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id)                              AS total_subs,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'submitted')  AS pending_count,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'graded')     AS graded_count,
          (SELECT COUNT(*) FROM enrollments  e WHERE e.class_id = a.class_id)                           AS student_count
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE c.teacher_id = ? AND a.center_id = ?
      `;
      const params = [id, center_id];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      q += ' ORDER BY a.due_date ASC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      return res.json(await db.all(q, params));
    }

    if (role === 'center_admin' || role === 'super_admin') {
      const cid = role === 'super_admin'
        ? parseInt(req.query.centerId || center_id)
        : center_id;
      let q = `
        SELECT
          a.*,
          c.name  AS class_name,
          c.color AS class_color,
          (SELECT COUNT(*) FROM submissions s WHERE s.assignment_id = a.id AND s.status = 'submitted') AS pending_count,
          (SELECT COUNT(*) FROM enrollments  e WHERE e.class_id = a.class_id)                          AS student_count
        FROM assignments a
        JOIN classes c ON c.id = a.class_id
        WHERE a.center_id = ?
      `;
      const params = [cid];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      q += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      return res.json(await db.all(q, params));
    }

    if (role === 'student') {
      let q = `
        SELECT
          a.*,
          c.name  AS class_name,
          c.color AS class_color,
          s.id             AS submission_id,
          s.status         AS submission_status,
          s.score          AS submission_score,
          s.feedback       AS submission_feedback,
          s.submitted_at   AS submission_date
        FROM assignments a
        JOIN classes     c ON c.id = a.class_id
        JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = ?
        LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
        WHERE a.center_id = ? AND a.is_published = 1
      `;
      const params = [id, id, center_id];
      if (classId) { q += ' AND a.class_id = ?'; params.push(classId); }
      q += ' ORDER BY a.due_date ASC LIMIT ? OFFSET ?';
      params.push(limit, offset);
      return res.json(await db.all(q, params));
    }

    res.json([]);
  } catch (err) { next(err); }
});

/**
 * GET /api/hw/assignments/:id
 * Returns full assignment details. Teacher also gets the submission list.
 */
router.get('/assignments/:id', authenticate, async (req, res, next) => {
  try {
    const aId = parseInt(req.params.id, 10);
    const assignment = await db.get(`
      SELECT a.*, c.name AS class_name, c.teacher_id, u.name AS teacher_name
      FROM assignments a
      JOIN classes c ON c.id = a.class_id
      LEFT JOIN users u ON u.id = c.teacher_id
      WHERE a.id = ?
    `, [aId]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const { role, id, center_id } = req.user;
    if (role !== 'super_admin' && assignment.center_id !== center_id)
      return res.status(403).json({ error: 'Forbidden' });

    if (['teacher','center_admin','super_admin'].includes(role)) {
      assignment.submissions = await db.all(`
        SELECT s.*, u.name AS student_name
        FROM submissions s
        JOIN users u ON u.id = s.student_id
        WHERE s.assignment_id = ?
        ORDER BY s.submitted_at DESC
      `, [aId]);
    }

    res.json(assignment);
  } catch (err) { next(err); }
});

/**
 * POST /api/hw/assignments
 * Teacher creates a new assignment.
 * Accepts optional file_path/file_name for teacher-attached resource files.
 */
router.post('/assignments', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const {
      classId, title, description,
      type = 'homework',
      gradingScale = '10-point',
      maxScore,
      dueDate,
      isPublished = 1,
      filePath,    // Vercel Blob URL (optional teacher resource)
      fileName,
    } = req.body;

    if (!classId || !title || !dueDate)
      return res.status(400).json({ error: 'classId, title, dueDate обязательны' });

    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    assertTeacherOwnsClass(cls, req.user);

    const ms = parseInt(maxScore, 10) || (gradingScale === '100-point' ? 100 : 10);

    const { lastInsertRowid } = await db.run(`
      INSERT INTO assignments
        (class_id, center_id, created_by, title, description, type,
         grading_scale, max_score, due_date, is_published, file_path, file_name)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?) RETURNING id
    `, [classId, cls.center_id, req.user.id, title, description || null,
        type, gradingScale, ms, dueDate, isPublished ? 1 : 0,
        filePath || null, fileName || null]);

    const created = await db.get(`SELECT * FROM assignments WHERE id = ?`, [lastInsertRowid]);

    // Notify enrolled students if published
    if (isPublished) {
      const students = await db.all(
        `SELECT u.id FROM users u JOIN enrollments e ON e.student_id = u.id WHERE e.class_id = ?`,
        [classId]);
      for (const s of students) {
        await db.run(
          `INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
          [s.id, 'Новое задание', `«${title}» — до ${dueDate}`, 'info']);
      }
    }

    res.status(201).json(created);
  } catch (err) { next(err); }
});

/**
 * PATCH /api/hw/assignments/:id
 * Teacher edits an existing assignment.
 */
router.patch('/assignments/:id', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const aId = parseInt(req.params.id, 10);
    const assignment = await db.get(`
      SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?
    `, [aId]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });

    const cls = { id: assignment.class_id, center_id: assignment.center_id, teacher_id: assignment.teacher_id };
    assertTeacherOwnsClass(cls, req.user);

    const allowed = ['title','description','type','grading_scale','max_score',
                     'due_date','is_published','file_path','file_name'];
    const updates = {};
    for (const k of allowed) {
      const bodyKey = k.replace(/_([a-z])/g, (_, c) => c.toUpperCase()); // snake_case → camelCase
      if (req.body[bodyKey] !== undefined) updates[k] = req.body[bodyKey];
      else if (req.body[k] !== undefined) updates[k] = req.body[k];
    }
    if (!Object.keys(updates).length)
      return res.status(400).json({ error: 'No fields to update' });

    const sets   = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const values = Object.values(updates);
    await db.run(`UPDATE assignments SET ${sets} WHERE id = ?`, [...values, aId]);

    res.json(await db.get(`SELECT * FROM assignments WHERE id = ?`, [aId]));
  } catch (err) { next(err); }
});

/**
 * DELETE /api/hw/assignments/:id
 * Deletes assignment and all its submissions (with blob cleanup).
 */
router.delete('/assignments/:id', ...requireRole('teacher','center_admin','super_admin'), async (req, res, next) => {
  try {
    const aId = parseInt(req.params.id, 10);
    const assignment = await db.get(`
      SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?
    `, [aId]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    assertTeacherOwnsClass(
      { id: assignment.class_id, center_id: assignment.center_id, teacher_id: assignment.teacher_id },
      req.user);

    // Best-effort blob cleanup
    const files = await db.all(
      `SELECT file_path FROM submissions WHERE assignment_id = ? AND file_path IS NOT NULL`,
      [aId]);
    if (process.env.BLOB_READ_WRITE_TOKEN && files.length) {
      try {
        const { del } = require('@vercel/blob');
        await del(files.filter(f => f.file_path?.startsWith('https://')).map(f => f.file_path),
                  { token: process.env.BLOB_READ_WRITE_TOKEN });
      } catch { /* best-effort */ }
    }
    // Clean teacher resource file too
    if (assignment.file_path?.startsWith('https://') && process.env.BLOB_READ_WRITE_TOKEN) {
      try { const { del } = require('@vercel/blob'); await del(assignment.file_path, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch {}
    }

    await db.run(`DELETE FROM assignments WHERE id = ?`, [aId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SUBMISSIONS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/hw/assignments/:id/submissions
 * Teacher views all submissions for one assignment.
 */
router.get('/assignments/:id/submissions',
  ...requireRole('teacher','center_admin','super_admin'),
  async (req, res, next) => {
    try {
      const aId = parseInt(req.params.id, 10);
      const assignment = await db.get(`
        SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON c.id = a.class_id WHERE a.id = ?
      `, [aId]);
      if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
      assertTeacherOwnsClass(
        { id: assignment.class_id, center_id: assignment.center_id, teacher_id: assignment.teacher_id },
        req.user);

      const submissions = await db.all(`
        SELECT s.*, u.name AS student_name, u.email AS student_email
        FROM submissions s
        JOIN users u ON u.id = s.student_id
        WHERE s.assignment_id = ?
        ORDER BY s.submitted_at DESC
      `, [aId]);

      // Students who haven't submitted yet
      const submittedIds = new Set(submissions.map(s => s.student_id));
      const allStudents = await db.all(`
        SELECT u.id, u.name FROM users u
        JOIN enrollments e ON e.student_id = u.id
        WHERE e.class_id = ?
        ORDER BY u.name
      `, [assignment.class_id]);
      const missing = allStudents.filter(s => !submittedIds.has(s.id));

      res.json({ assignment, submissions, missing });
    } catch (err) { next(err); }
  }
);

/**
 * POST /api/hw/assignments/:id/submit
 * Student submits (or re-submits if status is 'returned') their work.
 * Body: { textAnswer?, comment?, filePath?, fileName?, fileSize? }
 * filePath is a Vercel Blob CDN URL (browser uploaded directly).
 */
router.post('/assignments/:id/submit', ...requireRole('student'), async (req, res, next) => {
  try {
    const aId = parseInt(req.params.id, 10);
    const { id: studentId, center_id } = req.user;

    const assignment = await db.get(`SELECT * FROM assignments WHERE id = ?`, [aId]);
    if (!assignment)      return res.status(404).json({ error: 'Задание не найдено' });
    if (!assignment.is_published) return res.status(403).json({ error: 'Задание не опубликовано' });
    if (assignment.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });

    // Enrollment check
    const enrolled = await db.get(
      `SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?`,
      [assignment.class_id, studentId]);
    if (!enrolled) return res.status(403).json({ error: 'Вы не записаны в этот класс' });

    // Deadline check
    if (new Date(assignment.due_date) < new Date()) {
      return res.status(400).json({ error: 'Дедлайн истёк' });
    }

    const { textAnswer, comment, filePath, fileName } = req.body;
    if (!textAnswer && !filePath) {
      return res.status(400).json({ error: 'Нужен текстовый ответ или файл' });
    }

    // Validate blob URL safety
    if (filePath && !filePath.startsWith('https://')) {
      return res.status(400).json({ error: 'Недопустимый URL файла' });
    }

    // Check existing submission
    const existing = await db.get(
      `SELECT id, status FROM submissions WHERE assignment_id = ? AND student_id = ?`,
      [aId, studentId]);

    if (existing) {
      if (existing.status === 'graded') {
        return res.status(400).json({ error: 'Работа уже оценена, изменения невозможны' });
      }
      // Re-submission (returned or still submitted)
      await db.run(`
        UPDATE submissions
        SET text_answer = ?, comment = ?, file_path = ?, file_name = ?,
            submitted_at = NOW(), status = 'submitted', score = NULL,
            feedback = NULL, graded_by = NULL, graded_at = NULL
        WHERE id = ?
      `, [textAnswer || null, comment || null,
          filePath || existing.file_path || null,
          fileName || null, existing.id]);
      return res.json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [existing.id]));
    }

    // First submission
    const { lastInsertRowid } = await db.run(`
      INSERT INTO submissions
        (assignment_id, student_id, text_answer, comment, file_path, file_name, status, submitted_at)
      VALUES (?,?,?,?,?,?,'submitted', NOW()) RETURNING id
    `, [aId, studentId, textAnswer || null, comment || null,
        filePath || null, fileName || null]);

    // Notify teacher
    const cls = await db.get(`SELECT teacher_id FROM classes WHERE id = ?`, [assignment.class_id]);
    if (cls?.teacher_id) {
      const student = await db.get(`SELECT name FROM users WHERE id = ?`, [studentId]);
      await db.run(
        `INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
        [cls.teacher_id, 'Новая работа', `${student.name} сдал(а) «${assignment.title}»`, 'info']);
    }

    res.status(201).json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [lastInsertRowid]));
  } catch (err) { next(err); }
});

/**
 * GET /api/hw/submissions/:id
 * Fetch one submission. Students can only view their own.
 */
router.get('/submissions/:id', authenticate, async (req, res, next) => {
  try {
    const sub = await db.get(`
      SELECT s.*,
             a.title AS assignment_title, a.max_score, a.grading_scale,
             a.center_id AS a_center_id,
             u.name  AS student_name,
             c.name  AS class_name, c.teacher_id
      FROM submissions s
      JOIN assignments a ON a.id = s.assignment_id
      JOIN users u ON u.id = s.student_id
      JOIN classes c ON c.id = a.class_id
      WHERE s.id = ?
    `, [parseInt(req.params.id, 10)]);

    if (!sub) return res.status(404).json({ error: 'Submission not found' });

    const { role, id, center_id } = req.user;
    if (role !== 'super_admin' && sub.a_center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'student' && sub.student_id !== id) return res.status(403).json({ error: 'Forbidden' });

    res.json(sub);
  } catch (err) { next(err); }
});

/**
 * POST /api/hw/submissions/:id/grade
 * Teacher grades (or re-grades) a submission.
 * Body: { score, feedback? }
 */
router.post('/submissions/:id/grade',
  ...requireRole('teacher','center_admin','super_admin'),
  async (req, res, next) => {
    try {
      const subId = parseInt(req.params.id, 10);
      const sub = await db.get(`
        SELECT s.*, a.max_score, a.center_id AS a_center_id, c.teacher_id, a.title
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
      `, [subId]);

      if (!sub) return res.status(404).json({ error: 'Submission not found' });
      const { role, id, center_id } = req.user;
      if (role !== 'super_admin' && sub.a_center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
      if (role === 'teacher' && sub.teacher_id !== id) return res.status(403).json({ error: 'Forbidden' });

      const { score, feedback } = req.body;
      if (score === undefined) return res.status(400).json({ error: 'score обязателен' });

      const s = parseFloat(score);
      if (isNaN(s) || s < 0 || s > sub.max_score) {
        return res.status(400).json({ error: `Оценка должна быть от 0 до ${sub.max_score}` });
      }

      // Cap feedback to 2000 chars to prevent excessive storage
      const feedbackText = feedback ? String(feedback).slice(0, 2000) : null;

      await db.run(`
        UPDATE submissions
        SET score = ?, feedback = ?, status = 'graded', graded_by = ?, graded_at = NOW()
        WHERE id = ?
      `, [s, feedbackText, id, subId]);

      // Notify student
      await db.run(
        `INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
        [sub.student_id, 'Работа проверена',
         `«${sub.title}»: ${s}/${sub.max_score}${feedback ? ' — ' + feedback.slice(0, 80) : ''}`,
         'success']);

      res.json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [subId]));
    } catch (err) { next(err); }
  }
);

/**
 * POST /api/hw/submissions/:id/return
 * Teacher returns work for revision (before it can be re-submitted).
 * Body: { feedback? }
 */
router.post('/submissions/:id/return',
  ...requireRole('teacher','center_admin','super_admin'),
  async (req, res, next) => {
    try {
      const subId = parseInt(req.params.id, 10);
      const sub = await db.get(`
        SELECT s.*, a.center_id AS a_center_id, a.title, c.teacher_id
        FROM submissions s
        JOIN assignments a ON a.id = s.assignment_id
        JOIN classes c ON c.id = a.class_id
        WHERE s.id = ?
      `, [subId]);

      if (!sub) return res.status(404).json({ error: 'Submission not found' });
      const { role, id, center_id } = req.user;
      if (role !== 'super_admin' && sub.a_center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
      if (role === 'teacher' && sub.teacher_id !== id) return res.status(403).json({ error: 'Forbidden' });

      const { feedback } = req.body;
      const feedbackText = feedback ? String(feedback).slice(0, 2000) : null;
      await db.run(
        `UPDATE submissions SET status = 'returned', feedback = ? WHERE id = ?`,
        [feedbackText, subId]);

      await db.run(
        `INSERT INTO notifications (user_id, title, body, type) VALUES (?,?,?,?)`,
        [sub.student_id, 'Работа возвращена на доработку',
         `«${sub.title}»${feedback ? ': ' + feedback.slice(0, 120) : ''}`,
         'warning']);

      res.json(await db.get(`SELECT * FROM submissions WHERE id = ?`, [subId]));
    } catch (err) { next(err); }
  }
);

module.exports = router;
