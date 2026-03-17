'use strict';
const { db } = require('../database');

/**
 * Log an audit action.
 */
async function logAction(userId, userName, action, entityType, entityId, details, ip) {
  try {
    await db.run(`
      INSERT INTO audit_logs (user_id, user_name, action, entity_type, entity_id, details, ip)
      VALUES (?,?,?,?,?,?,?)
    `, [userId || null, userName || null, action, entityType || null, entityId || null,
      details ? JSON.stringify(details) : null, ip || null]);
  } catch (e) {
    console.error('[AUDIT ERROR]', e.message);
  }
}

/**
 * Express middleware: auto-log mutating requests (POST, PATCH, DELETE).
 */
function auditMiddleware(req, res, next) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();

  const originalJson = res.json.bind(res);
  res.json = function (body) {
    // Log after response is sent
    if (req.user && res.statusCode < 400) {
      const ip = req.ip || req.connection?.remoteAddress || '';
      const path = req.originalUrl.split('?')[0];
      const action = `${req.method} ${path}`;

      // Extract entity info from URL — strip /api and /api/v{N} prefix first
      const parts = path.split('/').filter(Boolean);
      // Skip 'api' and version segment (e.g. 'v1') if present
      let resourceIdx = 0;
      if (parts[0] === 'api') resourceIdx = 1;
      if (parts[resourceIdx] && /^v\d+$/.test(parts[resourceIdx])) resourceIdx++;
      let entityType = parts[resourceIdx] || null; // e.g., 'classes', 'assignments', 'users'
      let entityId = null;
      if (parts.length > resourceIdx + 1 && /^\d+$/.test(parts[resourceIdx + 1])) {
        entityId = parseInt(parts[resourceIdx + 1]);
      }

      // Sanitize: only log safe, known fields (allowlist approach)
      let details = null;
      if (req.body && Object.keys(req.body).length) {
        const SAFE_FIELDS = ['name', 'email', 'username', 'role', 'title', 'description', 'type',
          'classId', 'centerId', 'studentId', 'studentIds', 'label', 'dueDate', 'date',
          'score', 'feedback', 'status', 'note', 'isPublished', 'is_active', 'plan',
          'dayOfWeek', 'startTime', 'endTime', 'room', 'subject', 'color', 'textAnswer',
          'comment', 'gradingScale', 'maxScore', 'expiresInDays', 'linkedStudentId',
          'inviteToken', 'records'];
        const sanitized = {};
        for (const key of Object.keys(req.body)) {
          if (SAFE_FIELDS.includes(key)) {
            sanitized[key] = req.body[key];
          }
        }
        if (Object.keys(sanitized).length) details = sanitized;
      }

      logAction(req.user.id, req.user.name, action, entityType, entityId, details, ip);
    }
    return originalJson(body);
  };
  next();
}

module.exports = { logAction, auditMiddleware };

