'use strict';
const jwt = require('jsonwebtoken');
const { db } = require('../database');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET  || 'dev-access-secret-change-me';
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || 'dev-refresh-secret-change-me';

// ── Token generation helpers ──────────────────────────────────────────────────

function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m' });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d' });
}

function verifyAccess(token) {
  return jwt.verify(token, ACCESS_SECRET);
}

function verifyRefresh(token) {
  return jwt.verify(token, REFRESH_SECRET);
}

// ── Main authentication middleware ────────────────────────────────────────────

async function authenticate(req, res, next) {
  const authHeader = req.headers['authorization'];
  let token = null;

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.slice(7);
  } else if (req.query.token) {
    token = req.query.token;
  }

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }
  try {
    const payload = verifyAccess(token);
    const user = await db.get(`
      SELECT id, center_id, name, email, role, is_active
      FROM users WHERE id = ?
    `, [payload.id]);
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Account inactive or not found' });
    }
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ── Role guard factory ─────────────────────────────────────────────────────────

function requireRole(...roles) {
  return [authenticate, (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }
    next();
  }];
}

// ── Center isolation helper ───────────────────────────────────────────────────

function withCenter(req, res, next) {
  if (req.user.role === 'super_admin') {
    const cid = parseInt(req.query.centerId || req.body.centerId);
    if (!cid) return res.status(400).json({ error: 'centerId required for super_admin' });
    req.centerId = cid;
  } else {
    if (!req.user.center_id) return res.status(403).json({ error: 'No center assigned' });
    req.centerId = req.user.center_id;
  }
  next();
}

// ── Serve uploaded files (require valid access token + authorization check) ───

async function serveUpload(req, res, next) {
  const token = req.query.token;
  if (!token) return res.status(401).json({ error: 'Token required' });
  try {
    const payload = verifyAccess(token);
    const pathMod = require('path');

    const requestedFile = pathMod.basename(req.path);
    if (!requestedFile || requestedFile === '.' || requestedFile === '..') {
      return res.status(400).json({ error: 'Invalid file path' });
    }
    req.url = '/' + requestedFile;

    const sub = await db.get(`
      SELECT s.student_id, a.center_id, c.teacher_id
      FROM submissions s
      JOIN assignments a ON s.assignment_id = a.id
      JOIN classes c ON a.class_id = c.id
      WHERE s.file_path = ?
    `, [requestedFile]);

    if (!sub) {
      return res.status(404).json({ error: 'File not found' });
    }

    if (payload.centerId && payload.centerId !== sub.center_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (payload.role === 'student' && payload.id !== sub.student_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    if (payload.role === 'parent') {
      const link = await db.get(
        `SELECT id FROM parent_student WHERE parent_id = ? AND student_id = ?`,
        [payload.id, sub.student_id]
      );
      if (!link) return res.status(403).json({ error: 'Forbidden' });
    }

    if (payload.role === 'teacher' && payload.id !== sub.teacher_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

module.exports = {
  authenticate,
  requireRole,
  withCenter,
  serveUpload,
  signAccess,
  signRefresh,
  verifyAccess,
  verifyRefresh,
};
