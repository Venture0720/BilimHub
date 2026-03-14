'use strict';
const router = require('express').Router();
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const rateLimit = require('express-rate-limit');
const { db, transaction } = require('../database');
const { signAccess, signRefresh, verifyRefresh, authenticate } = require('../middleware/auth');

const authLimiter = rateLimit({ windowMs: 15 * 60_000, max: 20, message: { error: 'Too many attempts, try again later' } });

function setRefreshCookie(res, token) {
  res.cookie('refreshToken', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/api/auth/refresh',
  });
}

function buildTokenPayload(user) {
  return { id: user.id, role: user.role, centerId: user.center_id };
}

// ── POST /api/auth/login ──────────────────────────────────────────────────────
router.post('/login', authLimiter, async (req, res, next) => {
  try {
    const { email, username, password } = req.body;
    const loginIdentifier = username || email;

    if (!loginIdentifier || !password) {
      return res.status(400).json({ error: 'Логин/email и пароль обязательны' });
    }

    const user = await db.get(`
      SELECT id, center_id, name, email, username, password_hash, role, is_active
      FROM users WHERE (username = ? OR email = ?) AND is_active = 1
    `, [loginIdentifier.toLowerCase().trim(), loginIdentifier.toLowerCase().trim()]);

    if (!user) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const match = await bcrypt.compare(password, user.password_hash);
    if (!match) return res.status(401).json({ error: 'Неверный логин или пароль' });

    const payload = buildTokenPayload(user);
    const accessToken = signAccess(payload);
    const refreshToken = signRefresh(payload);

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)`, [user.id, tokenHash, expiresAt]);

    await db.run(`
      DELETE FROM refresh_tokens WHERE user_id = ? AND id NOT IN (
        SELECT id FROM refresh_tokens WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
      )
    `, [user.id, user.id]);

    setRefreshCookie(res, refreshToken);

    res.json({
      accessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, centerId: user.center_id },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/register (with invite token) ────────────────────────────────
router.post('/register', authLimiter, async (req, res, next) => {
  try {
    const { name, email, password, inviteToken } = req.body;
    if (!name || !password || !inviteToken) {
      return res.status(400).json({ error: 'Имя, пароль и токен приглашения обязательны' });
    }
    if (typeof name !== 'string' || name.trim().length > 200) return res.status(400).json({ error: 'Имя должно быть до 200 символов' });
    if (password.length < 8) return res.status(400).json({ error: 'Пароль минимум 8 символов' });
    if (password.length > 128) return res.status(400).json({ error: 'Пароль слишком длинный' });

    if (email && !/\S+@\S+\.\S+/.test(email)) {
      return res.status(400).json({ error: 'Неверный формат email' });
    }

    const invite = await db.get(`
      SELECT * FROM invite_tokens
      WHERE token = ? AND used_by IS NULL AND expires_at > NOW()
    `, [inviteToken.trim().toUpperCase()]);
    if (!invite) return res.status(400).json({ error: 'Неверный или истекший токен приглашения' });

    const baseUsername = name.toLowerCase()
      .replace(/[^a-z0-9а-яё]/gi, '')
      .substring(0, 15);

    let username = baseUsername;
    let suffix = 1;

    while (await db.get(`SELECT id FROM users WHERE username = ?`, [username])) {
      username = `${baseUsername}${suffix}`;
      suffix++;
    }

    if (email) {
      const existing = await db.get(`SELECT id FROM users WHERE email = ?`, [email.toLowerCase().trim()]);
      if (existing) return res.status(409).json({ error: 'Email уже зарегистрирован' });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    let newUser;
    let retries = 3;
    while (retries > 0) {
      try {
        newUser = await transaction(async (trx) => {
          const user = await trx.run(`
            INSERT INTO users (center_id, name, username, email, password_hash, role)
            VALUES (?, ?, ?, ?, ?, ?) RETURNING id
          `, [
            invite.center_id,
            name.trim(),
            username,
            email ? email.toLowerCase().trim() : null,
            passwordHash,
            invite.role,
          ]);

          await trx.run(`
            UPDATE invite_tokens SET used_by = ?, used_at = NOW() WHERE id = ?
          `, [user.lastInsertRowid, invite.id]);

          if (invite.role === 'parent' && invite.linked_student_id) {
            await trx.run(`INSERT INTO parent_student (parent_id, student_id) VALUES (?,?) ON CONFLICT DO NOTHING`, [user.lastInsertRowid, invite.linked_student_id]);
          }

          return await trx.get(`SELECT * FROM users WHERE id = ?`, [user.lastInsertRowid]);
        });
        break;
      } catch (txErr) {
        if (txErr.message && txErr.message.includes('unique') && txErr.message.includes('username') && retries > 1) {
          username = `${baseUsername}${crypto.randomInt(100, 9999)}`;
          retries--;
        } else {
          throw txErr;
        }
      }
    }
    const payload = buildTokenPayload(newUser);
    const accessToken = signAccess(payload);
    const refreshToken = signRefresh(payload);

    const tokenHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    await db.run(`INSERT INTO refresh_tokens (user_id,token_hash,expires_at) VALUES (?,?,?)`, [newUser.id, tokenHash, expiresAt]);

    setRefreshCookie(res, refreshToken);
    res.status(201).json({
      accessToken,
      user: { id: newUser.id, name: newUser.name, email: newUser.email, role: newUser.role, centerId: newUser.center_id },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/refresh ────────────────────────────────────────────────────
router.post('/refresh', async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (!token) return res.status(401).json({ error: 'No refresh token' });

    const payload = verifyRefresh(token);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const stored = await db.get(`
      SELECT * FROM refresh_tokens
      WHERE user_id = ? AND token_hash = ? AND expires_at > NOW()
    `, [payload.id, tokenHash]);
    if (!stored) return res.status(401).json({ error: 'Refresh token revoked or expired' });

    const user = await db.get(`SELECT id, center_id, name, email, role, is_active FROM users WHERE id = ? AND is_active = 1`, [payload.id]);
    if (!user) return res.status(401).json({ error: 'User not found' });

    const newPayload = buildTokenPayload(user);
    const newAccessToken = signAccess(newPayload);
    const newRefreshToken = signRefresh(newPayload);

    const newTokenHash = crypto.createHash('sha256').update(newRefreshToken).digest('hex');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    await transaction(async (trx) => {
      await trx.run(`DELETE FROM refresh_tokens WHERE id = ?`, [stored.id]);
      await trx.run(`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?,?,?)`, [user.id, newTokenHash, expiresAt]);
    });

    setRefreshCookie(res, newRefreshToken);

    res.json({
      accessToken: newAccessToken,
      user: { id: user.id, name: user.name, email: user.email, role: user.role, centerId: user.center_id },
    });
  } catch (err) { next(err); }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
router.post('/logout', async (req, res, next) => {
  try {
    const token = req.cookies.refreshToken;
    if (token) {
      const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
      await db.run(`DELETE FROM refresh_tokens WHERE token_hash = ?`, [tokenHash]);
    }
    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
router.get('/me', authenticate, async (req, res, next) => {
  try {
    const center = req.user.center_id
      ? await db.get(`SELECT id, name, code, plan FROM centers WHERE id = ?`, [req.user.center_id])
      : null;
    res.json({ ...req.user, center });
  } catch (err) { next(err); }
});

// ── POST /api/auth/change-password (also PATCH /api/auth/password for frontend)
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    if (newPassword.length > 128) return res.status(400).json({ error: 'Password too long' });

    const user = await db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });

    const hash = await bcrypt.hash(newPassword, 12);
    await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user.id]);
    await db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [req.user.id]);

    res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
    res.json({ ok: true });
  } catch (err) { next(err); }
});
router.patch('/password', authenticate, async (req, res, next) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
  const user = await db.get(`SELECT password_hash FROM users WHERE id = ?`, [req.user.id]);
  const valid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!valid) return res.status(400).json({ error: 'Current password is incorrect' });
  const hash = await bcrypt.hash(newPassword, 12);
  await db.run(`UPDATE users SET password_hash = ? WHERE id = ?`, [hash, req.user.id]);
  await db.run(`DELETE FROM refresh_tokens WHERE user_id = ?`, [req.user.id]);
  res.clearCookie('refreshToken', { path: '/api/auth/refresh' });
  res.json({ ok: true });
});

module.exports = router;
