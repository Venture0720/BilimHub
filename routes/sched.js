'use strict';
/**
 * /api/sched — Schedule Module v2
 *
 * Architecture:
 *   lessons          – repeating weekly lesson slot
 *   lesson_teachers  – which teachers teach it  (M:M)
 *   lesson_students  – which students attend it when individual (M:M)
 *
 * Access matrix:
 *   super_admin  → 403 (has no center, no schedule)
 *   center_admin → read-only; all lessons in center, grouped by teacher
 *   teacher      → CRUD own lessons (those they're in lesson_teachers)
 *   student      → read-only; group lessons via enrollments + individual
 *   parent       → read-only; same as their linked student
 */

const router = require('express').Router();
const { authenticate, requireRole } = require('../middleware/auth');
const { db } = require('../database');

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Convert 'HH:MM' → total minutes since midnight */
function toMins(hhmm) {
  const [h, m] = (hhmm || '00:00').split(':').map(Number);
  return h * 60 + m;
}

/** Add minutes to 'HH:MM' → 'HH:MM' */
function addMins(hhmm, mins) {
  const total = toMins(hhmm) + mins;
  const h = Math.floor(total / 60) % 24;
  const m = total % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Check teacher scheduling conflicts.
 * Returns { conflict: true, message } or { conflict: false }.
 */
async function checkTeacherConflict(centerId, teacherIds, day, startTime, durationMin, excludeId = null) {
  const newStart = toMins(startTime);
  const newEnd   = newStart + durationMin;
  for (const tid of teacherIds) {
    const rows = await db.all(
      `SELECT l.id, l.title, l.start_time, l.duration_min
       FROM lessons l
       JOIN lesson_teachers lt ON lt.lesson_id = l.id
       WHERE lt.teacher_id = ? AND l.day_of_week = ? AND l.center_id = ?
       ${excludeId ? `AND l.id <> ${parseInt(excludeId, 10)}` : ''}`,
      [tid, day, centerId]
    );
    for (const r of rows) {
      const cs = toMins(r.start_time), ce = cs + r.duration_min;
      if (newStart < ce && newEnd > cs) {
        return {
          conflict: true,
          message: `Учитель занят: "${r.title}" ${r.start_time}–${addMins(r.start_time, r.duration_min)}`,
        };
      }
    }
  }
  return { conflict: false };
}

/**
 * Check individual-lesson student conflicts.
 */
async function checkStudentConflict(centerId, studentIds, day, startTime, durationMin, excludeId = null) {
  const newStart = toMins(startTime);
  const newEnd   = newStart + durationMin;
  for (const sid of studentIds) {
    const rows = await db.all(
      `SELECT l.id, l.title, l.start_time, l.duration_min
       FROM lessons l
       JOIN lesson_students ls ON ls.lesson_id = l.id
       WHERE ls.student_id = ? AND l.day_of_week = ? AND l.center_id = ?
       ${excludeId ? `AND l.id <> ${parseInt(excludeId, 10)}` : ''}`,
      [sid, day, centerId]
    );
    for (const r of rows) {
      const cs = toMins(r.start_time), ce = cs + r.duration_min;
      if (newStart < ce && newEnd > cs) {
        return {
          conflict: true,
          message: `Ученик занят: "${r.title}" ${r.start_time}–${addMins(r.start_time, r.duration_min)}`,
        };
      }
    }
  }
  return { conflict: false };
}

/**
 * Base SELECT that always returns teachers[] and students[] JSON arrays.
 * Caller must append WHERE … GROUP BY l.id, c.name, c.subject, c.color ORDER BY …
 */
const BASE_SELECT = `
  SELECT
    l.*,
    c.name  AS class_name,
    c.subject AS class_subject,
    c.color AS class_color,
    COALESCE(
      JSON_AGG(DISTINCT JSONB_BUILD_OBJECT('id', t.id, 'name', t.name))
      FILTER (WHERE t.id IS NOT NULL), '[]'::json
    ) AS teachers,
    COALESCE(
      JSON_AGG(DISTINCT JSONB_BUILD_OBJECT('id', s.id, 'name', s.name))
      FILTER (WHERE s.id IS NOT NULL), '[]'::json
    ) AS students
  FROM lessons l
  LEFT JOIN classes       c   ON l.class_id = c.id
  LEFT JOIN lesson_teachers lt ON lt.lesson_id = l.id
  LEFT JOIN users           t  ON lt.teacher_id = t.id
  LEFT JOIN lesson_students ls ON ls.lesson_id = l.id
  LEFT JOIN users           s  ON ls.student_id = s.id
`;

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sched
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { role, id: userId, center_id } = req.user;

    if (role === 'super_admin') {
      return res.status(403).json({ error: 'super_admin does not have a schedule' });
    }

    let rows;

    if (role === 'center_admin') {
      // Admin sees all centre lessons; optional ?teacherId filter
      const teacherFilter = req.query.teacherId
        ? `AND EXISTS (
             SELECT 1 FROM lesson_teachers lt2
             WHERE lt2.lesson_id = l.id AND lt2.teacher_id = ${parseInt(req.query.teacherId, 10)}
           )`
        : '';
      rows = await db.all(
        `${BASE_SELECT}
         WHERE l.center_id = ? ${teacherFilter}
         GROUP BY l.id, c.name, c.subject, c.color
         ORDER BY l.day_of_week, l.start_time`,
        [center_id]
      );

    } else if (role === 'teacher') {
      rows = await db.all(
        `${BASE_SELECT}
         WHERE l.center_id = ?
           AND EXISTS (
             SELECT 1 FROM lesson_teachers lt2
             WHERE lt2.lesson_id = l.id AND lt2.teacher_id = ?
           )
         GROUP BY l.id, c.name, c.subject, c.color
         ORDER BY l.day_of_week, l.start_time`,
        [center_id, userId]
      );

    } else if (role === 'student') {
      rows = await db.all(
        `${BASE_SELECT}
         WHERE l.center_id = ?
           AND (
             (l.lesson_type = 'group' AND l.class_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM enrollments e WHERE e.class_id = l.class_id AND e.student_id = ?
             ))
             OR
             (l.lesson_type = 'individual' AND EXISTS (
               SELECT 1 FROM lesson_students ls2 WHERE ls2.lesson_id = l.id AND ls2.student_id = ?
             ))
           )
         GROUP BY l.id, c.name, c.subject, c.color
         ORDER BY l.day_of_week, l.start_time`,
        [center_id, userId, userId]
      );

    } else if (role === 'parent') {
      const children = await db.all(
        `SELECT student_id FROM parent_student WHERE parent_id = ?`, [userId]
      );
      if (!children.length) return res.json([]);

      const sid = parseInt(req.query.studentId, 10) || children[0].student_id;
      if (!children.some(c => c.student_id === sid)) {
        return res.status(403).json({ error: 'Forbidden' });
      }

      rows = await db.all(
        `${BASE_SELECT}
         WHERE l.center_id = ?
           AND (
             (l.lesson_type = 'group' AND l.class_id IS NOT NULL AND EXISTS (
               SELECT 1 FROM enrollments e WHERE e.class_id = l.class_id AND e.student_id = ?
             ))
             OR
             (l.lesson_type = 'individual' AND EXISTS (
               SELECT 1 FROM lesson_students ls2 WHERE ls2.lesson_id = l.id AND ls2.student_id = ?
             ))
           )
         GROUP BY l.id, c.name, c.subject, c.color
         ORDER BY l.day_of_week, l.start_time`,
        [center_id, sid, sid]
      );

    } else {
      return res.status(403).json({ error: 'Forbidden' });
    }

    res.json(rows);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/sched/teachers  — center_admin: list teachers with lesson counts
// ─────────────────────────────────────────────────────────────────────────────
router.get('/teachers', ...requireRole('center_admin'), async (req, res, next) => {
  try {
    const rows = await db.all(
      `SELECT u.id, u.name,
              COUNT(DISTINCT lt.lesson_id) AS lesson_count
       FROM users u
       LEFT JOIN lesson_teachers lt ON lt.teacher_id = u.id
       LEFT JOIN lessons l          ON lt.lesson_id  = l.id AND l.center_id = ?
       WHERE u.center_id = ? AND u.role = 'teacher' AND u.is_active = 1
       GROUP BY u.id, u.name
       ORDER BY u.name`,
      [req.user.center_id, req.user.center_id]
    );
    res.json(rows);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sched  — create lesson
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', ...requireRole('teacher', 'center_admin'), async (req, res, next) => {
  try {
    const { role, id: userId, center_id } = req.user;
    let {
      title, dayOfWeek, startTime,
      durationMin = 60,
      color       = '#6366f1',
      lessonType  = 'group',
      classId, teacherIds = [], studentIds = [],
      notes,
    } = req.body;

    // ── Validate inputs ─────────────────────────────────────────────────────
    if (!title?.trim())   return res.status(400).json({ error: 'Название обязательно' });
    dayOfWeek = parseInt(dayOfWeek, 10);
    if (!dayOfWeek || dayOfWeek < 1 || dayOfWeek > 7)
      return res.status(400).json({ error: 'День недели: 1 (пн) – 7 (вс)' });
    if (!startTime || !/^\d{2}:\d{2}$/.test(startTime))
      return res.status(400).json({ error: 'Время: формат HH:MM' });
    const dur = parseInt(durationMin, 10);
    if (!dur || dur < 15 || dur > 480)
      return res.status(400).json({ error: 'Длительность: 15–480 минут' });
    if (!['group', 'individual'].includes(lessonType))
      return res.status(400).json({ error: 'Тип занятия: group или individual' });

    // ── Teacher handling ─────────────────────────────────────────────────────
    // A teacher always creates lessons they participate in.
    if (role === 'teacher') {
      if (!teacherIds.length) teacherIds = [userId];
      if (!teacherIds.map(Number).includes(userId)) {
        return res.status(403).json({ error: 'Учитель может создавать только занятия, в которых участвует сам' });
      }
    }
    if (!teacherIds.length) return res.status(400).json({ error: 'Укажите хотя бы одного учителя' });

    // Verify all teachers belong to this centre
    for (const tid of teacherIds.map(Number)) {
      const t = await db.get(`SELECT id FROM users WHERE id = ? AND center_id = ? AND role = 'teacher'`, [tid, center_id]);
      if (!t) return res.status(400).json({ error: `Учитель #${tid} не найден в центре` });
    }

    // ── Group lesson ─────────────────────────────────────────────────────────
    if (lessonType === 'group') {
      if (!classId || isNaN(parseInt(classId, 10))) return res.status(400).json({ error: 'Для группового занятия укажите группу (classId)' });
      const cls = await db.get(`SELECT id, center_id FROM classes WHERE id = ?`, [classId]);
      if (!cls)                     return res.status(404).json({ error: 'Группа не найдена' });
      if (cls.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });
    }

    // ── Individual lesson ────────────────────────────────────────────────────
    if (lessonType === 'individual') {
      if (!studentIds.length) return res.status(400).json({ error: 'Для индивидуального занятия укажите ученика' });
      // Verify students belong to this centre
      for (const sid of studentIds.map(Number)) {
        const s = await db.get(`SELECT id FROM users WHERE id = ? AND center_id = ? AND role = 'student'`, [sid, center_id]);
        if (!s) return res.status(400).json({ error: `Ученик #${sid} не найден в центре` });
      }
    }

    // ── Conflict checks ──────────────────────────────────────────────────────
    const tc = await checkTeacherConflict(center_id, teacherIds.map(Number), dayOfWeek, startTime, dur);
    if (tc.conflict) return res.status(409).json({ error: tc.message });

    if (lessonType === 'individual') {
      const sc = await checkStudentConflict(center_id, studentIds.map(Number), dayOfWeek, startTime, dur);
      if (sc.conflict) return res.status(409).json({ error: sc.message });
    }

    // ── Insert ───────────────────────────────────────────────────────────────
    const result = await db.run(
      `INSERT INTO lessons
         (center_id, title, day_of_week, start_time, duration_min, color, lesson_type, class_id, notes, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?) RETURNING id`,
      [center_id, title.trim(), dayOfWeek, startTime, dur, color,
       lessonType, classId || null, notes?.trim() || null, userId]
    );
    const lessonId = result.lastInsertRowid;

    for (const tid of teacherIds.map(Number)) {
      await db.run(
        `INSERT INTO lesson_teachers (lesson_id, teacher_id) VALUES (?,?) ON CONFLICT DO NOTHING`,
        [lessonId, tid]
      );
    }

    if (lessonType === 'individual') {
      for (const sid of studentIds.map(Number)) {
        await db.run(
          `INSERT INTO lesson_students (lesson_id, student_id) VALUES (?,?) ON CONFLICT DO NOTHING`,
          [lessonId, sid]
        );
      }
    }

    // Return full hydrated lesson
    const lesson = await db.get(
      `${BASE_SELECT}
       WHERE l.id = ?
       GROUP BY l.id, c.name, c.subject, c.color`,
      [lessonId]
    );
    res.status(201).json(lesson);
  } catch (err) { next(err); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/sched/:id
// center_admin can delete any lesson in their centre.
// teacher can only delete lessons they teach.
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', ...requireRole('teacher', 'center_admin'), async (req, res, next) => {
  try {
    const { role, id: userId, center_id } = req.user;
    const lessonId = parseInt(req.params.id, 10);

    const lesson = await db.get(`SELECT * FROM lessons WHERE id = ?`, [lessonId]);
    if (!lesson)                       return res.status(404).json({ error: 'Занятие не найдено' });
    if (lesson.center_id !== center_id) return res.status(403).json({ error: 'Forbidden' });

    if (role === 'teacher') {
      const owns = await db.get(
        `SELECT 1 FROM lesson_teachers WHERE lesson_id = ? AND teacher_id = ?`,
        [lessonId, userId]
      );
      if (!owns) return res.status(403).json({ error: 'Вы не являетесь учителем этого занятия' });
    }

    await db.run(`DELETE FROM lessons WHERE id = ?`, [lessonId]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;
