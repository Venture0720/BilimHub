'use strict';
const pino = require('pino');
const crypto = require('crypto');

const logger = pino({
  level: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),
  ...(process.env.NODE_ENV !== 'production' && {
    transport: { target: 'pino/file', options: { destination: 1 } },
    formatters: { level: (label) => ({ level: label }) },
  }),
});

function generateRequestId() {
  return crypto.randomBytes(8).toString('hex');
}

module.exports = { logger, generateRequestId };
