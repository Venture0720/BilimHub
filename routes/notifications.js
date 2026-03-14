'use strict';
const router = require('express').Router();
const { authenticate } = require('../middleware/auth');
const { db } = require('../database');

// ── GET /api/notifications ───────────────────────────────────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0, unreadOnly } = req.query;
    let q = `SELECT * FROM notifications WHERE user_id = ?`;
    const params = [req.user.id];
    if (unreadOnly === '1' || unreadOnly === 'true') { q += ' AND is_read = 0'; }
    q += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(Math.min(parseInt(limit) || 50, 200), parseInt(offset) || 0);
    const notifs = await db.all(q, params);
    const unread = notifs.filter(n => !n.is_read).length;
    res.json({ notifs, unread });
  } catch (err) { next(err); }
});

// ── GET /api/notifications/unread-count ──────────────────────────────────────
router.get('/unread-count', authenticate, async (req, res, next) => {
  try {
    const row = await db.get(`SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = ? AND is_read = 0`, [req.user.id]);
    res.json({ count: row.count });
  } catch (err) { next(err); }
});

// ── PATCH /api/notifications/:id/read ────────────────────────────────────────
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    const n = await db.get(`SELECT * FROM notifications WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    await db.run(`UPDATE notifications SET is_read = 1 WHERE id = ?`, [n.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── POST /api/notifications/read-all (also PATCH for frontend compatibility)
router.post('/read-all', authenticate, async (req, res, next) => {
  try {
    await db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.patch('/read-all', authenticate, async (req, res, next) => {
  try {
    await db.run(`UPDATE notifications SET is_read = 1 WHERE user_id = ? AND is_read = 0`, [req.user.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── DELETE /api/notifications/:id ────────────────────────────────────────────
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    const n = await db.get(`SELECT * FROM notifications WHERE id = ? AND user_id = ?`, [req.params.id, req.user.id]);
    if (!n) return res.status(404).json({ error: 'Notification not found' });
    await db.run(`DELETE FROM notifications WHERE id = ?`, [n.id]);
    res.json({ ok: true });
  } catch (err) { next(err); }
});

module.exports = router;

