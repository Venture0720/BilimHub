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

module.exports = router;
