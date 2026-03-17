'use strict';
// ── Sentry instrumentation bootstrap ─────────────────────────────────────────
// Loaded via: node --require ./instrument.js server.js
//
// This file MUST execute before any other module so Sentry can patch Node.js
// core modules (http, dns) and third-party libraries (express, pg, knex) at
// require-time. Moving init here — instead of the top of server.js — is the
// official Sentry recommendation for Node.js v8+ SDKs.

require('./load-env'); // make SENTRY_DSN available from .env in local dev

const { nodeProfilingIntegration } = require('@sentry/profiling-node');
const Sentry = require('@sentry/node');

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  integrations: [
    nodeProfilingIntegration(),
  ],
  tracesSampleRate:   1.0, // capture 100 % of transactions — lower (e.g. 0.2) at scale
  profilesSampleRate: 1.0, // profile 100 % of sampled transactions
});

