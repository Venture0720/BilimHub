'use strict';
const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');
const { getGradeLabel, getGradeColor, getGradeIcon, getScorePercentage } = require('../utils/grading');

// ── GET /api/grades — gradebook matrix for a class ───────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { classId, studentId } = req.query;
    const { role, id, center_id } = req.user;

    // ── Student: own grades across all classes ──
    if (role === 'student') {
      const grades = await db.all(`
        SELECT s.score, s.feedback, s.status, s.graded_at,
          a.id AS assignment_id, a.title, a.type, a.grading_scale, a.max_score, a.due_date,
          c.name AS class_name, c.color AS class_color
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN classes c ON a.class_id = c.id
        WHERE s.student_id = ? AND a.center_id = ?
        ORDER BY a.due_date DESC
      `, [id, center_id]);

      const enriched = grades.map(g => ({
        ...g,
        grade_label: g.score != null ? getGradeLabel(g.score, g.grading_scale) : null,
        grade_color: g.score != null ? getGradeColor(g.score, g.grading_scale) : null,
        grade_icon: g.score != null ? getGradeIcon(g.score, g.grading_scale) : null,
        percentage: g.score != null ? getScorePercentage(g.score, g.max_score) : null,
      }));
      return res.json(enriched);
    }

    // ── Parent: child's grades ──
    if (role === 'parent') {
      const sid = parseInt(studentId);
      if (!sid) return res.status(400).json({ error: 'studentId required' });
      const linked = await db.get(`SELECT 1 FROM parent_student WHERE parent_id = ? AND student_id = ?`, [id, sid]);
      if (!linked) return res.status(403).json({ error: 'Forbidden' });

      const grades = await db.all(`
        SELECT s.score, s.feedback, s.status, s.graded_at,
          a.id AS assignment_id, a.title, a.type, a.grading_scale, a.max_score, a.due_date,
          c.name AS class_name, c.color AS class_color
        FROM submissions s
        JOIN assignments a ON s.assignment_id = a.id
        JOIN classes c ON a.class_id = c.id
        WHERE s.student_id = ? AND a.center_id = ?
        ORDER BY a.due_date DESC
      `, [sid, center_id]);

      return res.json(grades.map(g => ({
        ...g,
        grade_label: g.score != null ? getGradeLabel(g.score, g.grading_scale) : null,
        grade_color: g.score != null ? getGradeColor(g.score, g.grading_scale) : null,
        percentage: g.score != null ? getScorePercentage(g.score, g.max_score) : null,
      })));
    }

    // ── Teacher / Admin: gradebook for a specific class ──
    if (!classId) return res.status(400).json({ error: 'classId required' });

    const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
    if (!cls) return res.status(404).json({ error: 'Class not found' });
    if (role !== 'super_admin' && cls.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'teacher' && cls.teacher_id !== id) return res.status(403).json({ error: 'Not your class' });

    const students = await db.all(`
      SELECT u.id, u.name FROM users u
      JOIN enrollments e ON e.student_id = u.id
      WHERE e.class_id = ? ORDER BY u.name
    `, [classId]);

    const assignments = await db.all(`
      SELECT id, title, type, grading_scale, max_score, due_date FROM assignments
      WHERE class_id = ? ORDER BY due_date ASC
    `, [classId]);

    const submissions = await db.all(`
      SELECT s.student_id, s.assignment_id, s.score, s.status, s.feedback
      FROM submissions s JOIN assignments a ON s.assignment_id = a.id
      WHERE a.class_id = ?
    `, [classId]);

    // Build matrix
    const subMap = {};
    submissions.forEach(s => { subMap[`${s.student_id}-${s.assignment_id}`] = s; });

    const matrix = students.map(student => {
      const row = {
        student_id: student.id,
        student_name: student.name,
        grades: assignments.map(a => {
          const sub = subMap[`${student.id}-${a.id}`];
          return {
            assignment_id: a.id,
            score: sub?.score ?? null,
            status: sub?.status ?? 'missing',
            feedback: sub?.feedback ?? null,
            grade_label: sub?.score != null ? getGradeLabel(sub.score, a.grading_scale) : null,
            grade_color: sub?.score != null ? getGradeColor(sub.score, a.grading_scale) : null,
          };
        }),
      };
      const scored = row.grades.filter(g => g.score != null);
      row.average = scored.length ? +(scored.reduce((s, g) => s + g.score, 0) / scored.length).toFixed(2) : null;
      return row;
    });

    res.json({ class: cls, assignments, students: matrix });
  } catch (err) { next(err); }
});

// ── GET /api/grades/summary — aggregate stats per class ──────────────────────
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const { role, id, center_id } = req.user;
    let q = `
      SELECT c.id AS class_id, c.name AS class_name, c.color,
        COUNT(DISTINCT a.id) AS assignment_count,
        COUNT(DISTINCT s.id) AS submission_count,
        ROUND(AVG(s.score)::numeric, 2) AS avg_score,
        COUNT(CASE WHEN s.status = 'submitted' THEN 1 END) AS pending_grading
      FROM classes c
      LEFT JOIN assignments a ON a.class_id = c.id
      LEFT JOIN submissions s ON s.assignment_id = a.id
      WHERE c.center_id = ?`;
    const params = [center_id];
    if (role === 'teacher') { q += ' AND c.teacher_id = ?'; params.push(id); }
    q += ' GROUP BY c.id, c.name, c.color ORDER BY c.name';

    res.json(await db.all(q, params));
  } catch (err) { next(err); }
});

// ── GET /api/grades/student/:studentId — per-class grade summary ─────────────
// Used by StudentDash, GradesView (student/parent view)
router.get('/student/:studentId', authenticate, async (req, res, next) => {
  try {
    const studentId = parseInt(req.params.studentId, 10);
    if (!studentId) return res.status(400).json({ error: 'Invalid studentId' });

    const { role, id, center_id } = req.user;

    // Authorization
    if (role === 'student') {
      if (studentId !== id) return res.status(403).json({ error: 'Forbidden' });
    } else if (role === 'parent') {
      const linked = await db.get(`SELECT 1 FROM parent_student WHERE parent_id = ? AND student_id = ?`, [id, studentId]);
      if (!linked) return res.status(403).json({ error: 'Forbidden' });
    } else if (role === 'teacher') {
      const enrolled = await db.get(`
        SELECT 1 FROM enrollments e
        JOIN classes c ON c.id = e.class_id
        WHERE e.student_id = ? AND c.teacher_id = ? AND c.center_id = ?
      `, [studentId, id, center_id]);
      if (!enrolled) return res.status(403).json({ error: 'Forbidden' });
    } else if (role !== 'center_admin' && role !== 'super_admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // For super_admin look up student's center; otherwise use caller's center
    let effectiveCenterId = center_id;
    if (role === 'super_admin') {
      const student = await db.get(`SELECT center_id FROM users WHERE id = ?`, [studentId]);
      if (!student) return res.status(404).json({ error: 'Student not found' });
      effectiveCenterId = student.center_id;
    }

    // Class-level aggregates (only over graded work)
    const classes = await db.all(`
      SELECT
        c.id AS class_id, c.name AS class_name, c.subject,
        u.name AS teacher_name,
        COALESCE(SUM(s.score) FILTER (WHERE s.score IS NOT NULL), 0) AS total_score,
        COALESCE(SUM(a.max_score) FILTER (WHERE s.score IS NOT NULL), 0) AS total_max
      FROM classes c
      JOIN enrollments e ON e.class_id = c.id AND e.student_id = ?
      LEFT JOIN users u ON u.id = c.teacher_id
      LEFT JOIN assignments a ON a.class_id = c.id AND a.is_published = 1
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      WHERE c.center_id = ?
      GROUP BY c.id, c.name, c.subject, u.name
      ORDER BY c.name
    `, [studentId, studentId, effectiveCenterId]);

    // Per-assignment submission details for this student
    const subs = await db.all(`
      SELECT
        a.class_id, a.title, a.type, a.due_date, a.max_score,
        s.score, s.status, s.feedback
      FROM assignments a
      JOIN enrollments e ON e.class_id = a.class_id AND e.student_id = ?
      LEFT JOIN submissions s ON s.assignment_id = a.id AND s.student_id = ?
      WHERE a.center_id = ? AND a.is_published = 1
      ORDER BY a.due_date ASC
    `, [studentId, studentId, effectiveCenterId]);

    // Group assignments by class
    const subsByClass = {};
    subs.forEach(s => {
      if (!subsByClass[s.class_id]) subsByClass[s.class_id] = [];
      subsByClass[s.class_id].push(s);
    });

    const result = classes.map(cls => {
      const totalScore = parseFloat(cls.total_score) || 0;
      const totalMax = parseFloat(cls.total_max) || 0;
      const pct = totalMax > 0 ? Math.round((totalScore / totalMax) * 100) : null;
      const letter = pct != null
        ? (pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 65 ? 'C' : pct >= 50 ? 'D' : 'F')
        : null;

      return {
        id: cls.class_id,
        name: cls.class_name,
        subject: cls.subject,
        teacher_name: cls.teacher_name,
        pct,
        letter,
        totalScore,
        totalMax,
        submissions: (subsByClass[cls.class_id] || []).map(s => ({
          title: s.title,
          type: s.type,
          due_date: s.due_date,
          score: s.score != null ? parseFloat(s.score) : null,
          max_score: s.max_score,
          status: s.status || null,
        })),
      };
    });

    res.json(result);
  } catch (err) { next(err); }
});

// ── Shared helper: load class gradebook data ─────────────────────────────────
async function loadClassGradebook(classId, user) {
  const { role, id, center_id } = user;

  const cls = await db.get(`SELECT * FROM classes WHERE id = ?`, [classId]);
  if (!cls) return { error: 'Class not found', status: 404 };
  if (role !== 'super_admin' && cls.center_id !== center_id) return { error: 'Forbidden', status: 403 };
  if (role === 'teacher' && cls.teacher_id !== id) return { error: 'Not your class', status: 403 };

  const students = await db.all(`
    SELECT u.id, u.name FROM users u
    JOIN enrollments e ON e.student_id = u.id
    WHERE e.class_id = ? ORDER BY u.name
  `, [classId]);

  const assignments = await db.all(`
    SELECT id, title, type, grading_scale, max_score, due_date
    FROM assignments WHERE class_id = ? ORDER BY due_date ASC
  `, [classId]);

  const submissions = await db.all(`
    SELECT s.student_id, s.assignment_id, s.score, s.status, s.feedback
    FROM submissions s JOIN assignments a ON s.assignment_id = a.id
    WHERE a.class_id = ?
  `, [classId]);

  const subMap = {};
  submissions.forEach(s => { subMap[`${s.student_id}-${s.assignment_id}`] = s; });

  const matrix = students.map(student => {
    // scores array: null if not submitted, or {score, status, feedback}
    const scores = assignments.map(a => {
      const sub = subMap[`${student.id}-${a.id}`];
      return sub ? { score: sub.score, status: sub.status, feedback: sub.feedback } : null;
    });

    // Weighted percentage across all graded submissions
    const gradedPairs = assignments
      .map((a, i) => ({ a, s: scores[i] }))
      .filter(p => p.s && p.s.score != null);

    const pct = gradedPairs.length > 0
      ? Math.round(gradedPairs.reduce((sum, p) => sum + (p.s.score / p.a.max_score) * 100, 0) / gradedPairs.length)
      : null;

    const letter = pct != null
      ? (pct >= 90 ? 'A' : pct >= 80 ? 'B' : pct >= 65 ? 'C' : pct >= 50 ? 'D' : 'F')
      : null;

    return { student: { id: student.id, name: student.name }, scores, pct, letter };
  });

  return { class: cls, assignments, matrix };
}

// ── POST /api/grades/direct — upsert grade directly without requiring submission ─
// Teacher can grade any enrolled student regardless of whether they submitted
router.post('/direct', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const { studentId, assignmentId, score } = req.body;
    const sid = parseInt(studentId, 10);
    const aid = parseInt(assignmentId, 10);
    if (!sid || !aid) return res.status(400).json({ error: 'studentId and assignmentId required' });

    const { role, id, center_id } = req.user;

    const assignment = await db.get(`
      SELECT a.*, c.teacher_id FROM assignments a JOIN classes c ON a.class_id = c.id WHERE a.id = ?
    `, [aid]);
    if (!assignment) return res.status(404).json({ error: 'Assignment not found' });
    if (role !== 'super_admin' && assignment.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    if (role === 'teacher' && assignment.teacher_id !== id) return res.status(403).json({ error: 'Not your class' });

    if (score !== null && score !== undefined) {
      const s = parseFloat(score);
      if (isNaN(s) || s < 0 || s > assignment.max_score) {
        return res.status(400).json({ error: `Оценка должна быть от 0 до ${assignment.max_score}` });
      }
    }

    const enrolled = await db.get(`
      SELECT 1 FROM enrollments WHERE class_id = ? AND student_id = ?
    `, [assignment.class_id, sid]);
    if (!enrolled) return res.status(400).json({ error: 'Student not enrolled in this class' });

    const scoreVal = (score !== null && score !== undefined) ? parseFloat(score) : null;

    // Upsert: create submission if not exists, or update existing
    await db.run(`
      INSERT INTO submissions (assignment_id, student_id, score, status, graded_by, graded_at)
      VALUES (?, ?, ?, 'graded', ?, NOW())
      ON CONFLICT (assignment_id, student_id)
      DO UPDATE SET score = EXCLUDED.score, status = 'graded',
        graded_by = EXCLUDED.graded_by, graded_at = NOW()
    `, [aid, sid, scoreVal, id]);

    const sub = await db.get(`SELECT * FROM submissions WHERE assignment_id = ? AND student_id = ?`, [aid, sid]);
    res.json(sub);
  } catch (err) { next(err); }
});

// ── GET /api/grades/class/:classId — gradebook for teacher (used by frontend) ─
router.get('/class/:classId', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const classId = parseInt(req.params.classId, 10);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });

    const result = await loadClassGradebook(classId, req.user);
    if (result.error) return res.status(result.status).json({ error: result.error });

    res.json(result);
  } catch (err) { next(err); }
});

// ── GET /api/grades/class/:classId/export — CSV download ─────────────────────
router.get('/class/:classId/export', ...requireRole('teacher', 'center_admin', 'super_admin'), async (req, res, next) => {
  try {
    const classId = parseInt(req.params.classId, 10);
    if (!classId) return res.status(400).json({ error: 'Invalid classId' });

    const result = await loadClassGradebook(classId, req.user);
    if (result.error) return res.status(result.status).json({ error: result.error });

    const { class: cls, assignments, matrix } = result;

    // Build CSV
    const escape = v => {
      const s = v == null ? '' : String(v);
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
    };

    const header = ['Ученик', ...assignments.map(a => a.title), 'Итог %', 'Оценка'].map(escape).join(',');
    const rows = matrix.map(row => [
      escape(row.student.name),
      ...row.scores.map(s => escape(s && s.score != null ? s.score : '')),
      escape(row.pct != null ? `${row.pct}%` : ''),
      escape(row.letter || ''),
    ].join(','));

    const csv = [header, ...rows].join('\r\n');
    const filename = `grades-${cls.name.replace(/[^a-zA-Z0-9А-Яа-яёЁ]/g, '_')}.csv`;

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send('\uFEFF' + csv); // BOM for Excel UTF-8
  } catch (err) { next(err); }
});

module.exports = router;
