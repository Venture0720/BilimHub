'use strict';

/**
 * Lightweight schema-based input validator.
 *
 * Usage:
 *   const err = validate({ email: 'required|email', password: 'required|min:8' }, req.body);
 *   if (err) return res.status(400).json({ error: err });
 *
 * Supported rules (pipe-separated):
 *   required             – field must be present and non-empty
 *   string               – must be a string
 *   email                – basic email format
 *   min:N                – string length >= N  /  number >= N
 *   max:N                – string length <= N  /  number <= N
 *   number               – must be a number (parseFloat)
 *   integer              – must be an integer
 *   boolean              – must be a boolean or 0/1
 *   in:a,b,c             – value must be one of the listed options
 *   url                  – must start with http:// or https://
 */
function validate(schema, body = {}) {
  for (const [field, ruleStr] of Object.entries(schema)) {
    const rules = ruleStr.split('|');
    const value = body[field];
    const present = value !== undefined && value !== null && value !== '';

    for (const rule of rules) {
      if (rule === 'required') {
        if (!present) return `«${field}» обязательно`;
        continue;
      }

      // Skip non-required rules if field is absent
      if (!present) continue;

      if (rule === 'string') {
        if (typeof value !== 'string') return `«${field}» должно быть строкой`;
      } else if (rule === 'email') {
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value))) {
          return `«${field}» — неверный формат email`;
        }
      } else if (rule === 'url') {
        if (!/^https?:\/\//.test(String(value))) {
          return `«${field}» должно быть URL (http:// или https://)`;
        }
      } else if (rule === 'number') {
        if (isNaN(parseFloat(value))) return `«${field}» должно быть числом`;
      } else if (rule === 'integer') {
        if (!Number.isInteger(Number(value))) return `«${field}» должно быть целым числом`;
      } else if (rule === 'boolean') {
        if (![true, false, 0, 1, '0', '1', 'true', 'false'].includes(value)) {
          return `«${field}» должно быть булевым значением`;
        }
      } else if (rule.startsWith('min:')) {
        const n = parseInt(rule.slice(4));
        if (typeof value === 'string' && value.length < n) return `«${field}» минимум ${n} символов`;
        if (typeof value === 'number' && value < n) return `«${field}» минимум ${n}`;
      } else if (rule.startsWith('max:')) {
        const n = parseInt(rule.slice(4));
        if (typeof value === 'string' && value.length > n) return `«${field}» максимум ${n} символов`;
        if (typeof value === 'number' && value > n) return `«${field}» максимум ${n}`;
      } else if (rule.startsWith('in:')) {
        const options = rule.slice(3).split(',');
        if (!options.includes(String(value))) {
          return `«${field}» должно быть одним из: ${options.join(', ')}`;
        }
      }
    }
  }
  return null; // no error
}

module.exports = { validate };
