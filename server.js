'use strict';
require('./load-env');

// Sentry is initialized in instrument.js (loaded via node --require ./instrument.js).
// We require the already-initialized singleton here only to call setupExpressErrorHandler.
const Sentry = require('@sentry/node');

const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const { logger, generateRequestId } = require('./lib/logger');

// ── Guard: insecure default JWT secrets ───────────────────────────────────────
const DEFAULT_SECRETS = ['dev-access-secret-change-me', 'dev-refresh-secret-change-me'];
if (DEFAULT_SECRETS.includes(process.env.JWT_ACCESS_SECRET) || DEFAULT_SECRETS.includes(process.env.JWT_REFRESH_SECRET)) {
  if (process.env.NODE_ENV === 'production') {
    logger.fatal('JWT secrets are set to insecure defaults. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env before running in production.');
    process.exit(1);
  } else {
    logger.warn('Using default JWT secrets. Set JWT_ACCESS_SECRET and JWT_REFRESH_SECRET in .env before deploying.');
  }
}

const app = express();
const PORT = process.env.PORT || 3000;

// ── Ensure uploads dir exists (persistent filesystem — Render/Railway mount or local disk)
const UPLOADS_DIR = path.resolve(process.env.UPLOADS_DIR || './uploads');
try { if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true }); } catch (e) { logger.warn({ err: e }, 'Could not create uploads directory'); }

// ── Security & parsing middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'", "https:"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", "https:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: false,
  crossOriginResourcePolicy: false,
}));
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());

// ── Structured logging + request tracing ──────────────────────────────────────
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.headers['x-request-id'] || generateRequestId(),
  autoLogging: { ignore: (req) => req.url === '/health' },
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  serializers: {
    req: (req) => ({ method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
    res: (res) => ({ statusCode: res.statusCode }),
  },
}));

// ── CORS — split deployment: React frontend on Vercel, API on Render/Railway ─
// Set FRONTEND_URL env var to your Vercel deployment URL in production.
// Multiple origins can be added by extending the FRONTEND_ORIGINS array.
const FRONTEND_ORIGINS = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:3000',  // integration tests / legacy
  ...(process.env.FRONTEND_URL ? [process.env.FRONTEND_URL.trim()] : []),
];
app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no Origin header (curl, server-to-server) only in dev
    if (!origin && process.env.NODE_ENV !== 'production') return cb(null, true);
    if (origin && FRONTEND_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error(`CORS: origin '${origin}' not allowed`));
  },
  credentials: true,  // required — we use HttpOnly cookies for refresh tokens
}));

// Global rate limit: 200 req/min per IP
app.use(rateLimit({
  windowMs: 60_000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
}));

// ── Sentry integration test — REMOVE AFTER VERIFYING IN SENTRY DASHBOARD ─────
// Positioned first so no other route/middleware can intercept it.
app.get('/debug-sentry', (_req, _res) => {
  throw new Error('Sentry test error — if you see this in Sentry Issues, the integration is working ✓');
});

// ── Audit middleware (log all mutating API requests)
app.use('/api', require('./middleware/audit').auditMiddleware);

// ── API v1 routes ─────────────────────────────────────────────────────────────
const v1 = express.Router();
v1.use('/auth',          require('./routes/auth'));
v1.use('/centers',       require('./routes/centers'));
v1.use('/tokens',        require('./routes/tokens'));
v1.use('/users',         require('./routes/users'));
v1.use('/classes',       require('./routes/classes'));
v1.use('/assignments',   require('./routes/assignments'));
v1.use('/submissions',   require('./routes/submissions'));
v1.use('/grades',        require('./routes/grades'));
v1.use('/hw',            require('./routes/hw'));
v1.use('/attendance',    require('./routes/attendance'));
v1.use('/notifications', require('./routes/notifications'));
v1.use('/schedule',      require('./routes/schedule'));
v1.use('/sched',         require('./routes/sched'));
v1.use('/audit',         require('./routes/audit'));
v1.use('/cleanup',       require('./routes/data-cleanup'));

app.use('/api/v1', v1);

// Serve uploaded files (authenticated users only — checked via query token)
// Force download (attachment) to prevent inline rendering of potentially malicious content
app.use('/uploads', require('./middleware/auth').serveUpload, express.static(UPLOADS_DIR, {
  setHeaders: (res) => {
    res.setHeader('Content-Disposition', 'attachment');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  },
}));

// ── Health check (for Docker, Railway, Render, PM2)
app.get('/health', async (req, res) => {
  try {
    const { db } = require('./database');
    await db.get('SELECT 1 AS ok');
    res.json({ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() });
  } catch {
    res.status(503).json({ status: 'error', reason: 'database unavailable' });
  }
});


// ── Sentry error handler — MUST be after all routes, before custom error handler
Sentry.setupExpressErrorHandler(app);

// ── Custom error handler
app.use((err, req, res, next) => {
  // Belt-and-suspenders: capture in Sentry even if setupExpressErrorHandler
  // already fired — duplicate events are deduplicated by Sentry automatically.
  Sentry.captureException(err);

  const status = err.status || 500;
  if (status === 500) logger.error({ err }, 'Unhandled server error');
  res.status(status).json({
    error: err.message || 'Something went wrong',
    detail: err.detail || undefined,
    code: err.code || undefined,
    hint: err.hint || undefined,
  });
});

if (require.main === module) {
  // ── Production startup warnings ─────────────────────────────────────────────
  if (process.env.NODE_ENV === 'production') {
    if (!process.env.FRONTEND_URL) {
      logger.warn('FRONTEND_URL is not set. CORS will block all cross-origin requests in production. Set FRONTEND_URL to your Vercel frontend URL (e.g. https://bilimhub.vercel.app).');
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    logger.info({ port: PORT, env: process.env.NODE_ENV || 'development', db: `${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || '5432'}/${process.env.DB_NAME || 'bilimhub'}` }, 'BilimHub server started');
    // Log local network IP for mobile access
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) {
          logger.info({ mobile: `http://${net.address}:${PORT}` }, 'Network interface available');
        }
      }
    }
    logger.info(`   Run 'npm run seed' to create demo data.`);

    // Инициализировать cleanup scheduler
    const cleanupScheduler = require('./middleware/cleanup-scheduler')();

    // Graceful shutdown
    process.on('SIGTERM', async () => {
      logger.info('SIGTERM received, shutting down gracefully...');
      cleanupScheduler.stop();
      server.close(async () => {
        await require('./database').shutdown();
        logger.info('Server closed');
        process.exit(0);
      });
    });

    process.on('SIGINT', async () => {
      logger.info('SIGINT received, shutting down gracefully...');
      cleanupScheduler.stop();
      server.close(async () => {
        await require('./database').shutdown();
        logger.info('Server closed');
        process.exit(0);
      });
    });
  });
}

module.exports = app;
