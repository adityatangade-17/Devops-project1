// Express app — shared between the Docker server (src/index.js) and the
// Vercel serverless entry (api/index.js). Neither workers nor setIntervals
// are started here; those live in index.js (Docker) and Vercel Cron (cloud).

require('dotenv').config();
// Resolve/auto-generate JWT_SECRET + FORGECRM_ENCRYPTION_KEY into process.env
// BEFORE any module that reads them at require-time (./auth, crypto consumers).
require('./util/instanceSecrets').bootstrapSecrets();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const cookieParser = require('cookie-parser');
const { router: authRouter, authMiddleware } = require('./auth');
const { router: messagesRouter } = require('./routes/messages');
const { router: suggestReplyRouter } = require('./routes/suggestReply');
const { router: webhookRouter } = require('./routes/webhook');
const { router: categoriesRouter } = require('./routes/categories');
const { router: contactFieldsRouter } = require('./routes/contactFields');
const { router: usersRouter } = require('./routes/users');
const { router: tasksRouter } = require('./routes/tasks');
const { router: ventureRouter } = require('./routes/venture');
const { router: uploadsRouter, UPLOAD_DIR } = require('./routes/uploads');
const { router: templatesRouter } = require('./routes/templates');
const { router: broadcastsRouter } = require('./routes/broadcasts');
const { router: chatbotsRouter } = require('./routes/chatbots');
const { router: mediaRouter } = require('./routes/media');
const { router: mediaLibraryRouter } = require('./routes/mediaLibrary');
const {
  router: googleIntegrationsRouter,
  publicRouter: googleIntegrationsPublicRouter,
} = require('./routes/googleIntegrations');
const { router: agentsRouter } = require('./routes/agents');
const { router: knowledgeBasesRouter } = require('./routes/knowledgeBases');
const { router: aiModelsRouter } = require('./routes/aiModels');
const { router: eventsRouter } = require('./routes/events');
const { router: dashboardRouter } = require('./routes/dashboard');
const { router: pipelinesRouter } = require('./routes/pipelines');
const { router: bookingRouter, publicRouter: bookingPublicRouter } = require('./routes/booking');
const { router: whatsappAccountsRouter } = require('./routes/whatsappAccounts');
const { router: cronRouter } = require('./routes/cron');

const app = express();

// A comma-separated list permits a controlled domain transition while retaining
// the existing single-origin behavior when only one origin is configured.
const CONFIGURED_ORIGINS = (process.env.CORS_ORIGIN || '')
  .split(',')
  .map(origin => origin.trim())
  .filter(Boolean);
const ALLOWED_ORIGINS = [...CONFIGURED_ORIGINS, 'http://localhost:5173'];

const isLocalOrigin = (o) => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o);
const CORS_DOMAINS = CONFIGURED_ORIGINS.map(origin => origin.replace(/^https?:\/\//, ''));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc:  ["'self'"],
      styleSrc:   ["'self'", "'unsafe-inline'"],
      imgSrc:     ["'self'", "data:", "blob:"],
      connectSrc: ["'self'", ...CORS_DOMAINS.map(domain => `wss://${domain}`)],
      mediaSrc:   ["'self'", "blob:"],
      fontSrc:    ["'self'"],
      objectSrc:  ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  crossOriginEmbedderPolicy: false,
}));

app.use(cors({
  credentials: true,
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin) || isLocalOrigin(origin)) return callback(null, true);
    callback(new Error('Not allowed by CORS'));
  },
}));

app.use(cookieParser());
app.use(express.json({
  limit: '1mb',
  verify: (req, _res, buf) => { req.rawBody = buf; },
}));

// Serve uploaded files statically — disk-based Docker installs only.
// On Vercel, profile pictures are stored in Vercel Blob (absolute CDN URLs).
if (!process.env.VERCEL) {
  app.use('/uploads', express.static(UPLOAD_DIR));
}

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/health',
  keyGenerator: (req) => {
    try {
      const token = req.cookies?.forgecrm_token;
      if (token) {
        const decoded = require('jsonwebtoken').decode(token);
        if (decoded?.username) return `user:${decoded.username}`;
      }
    } catch {}
    return req.ip;
  },
  handler: (req, res) => {
    res.status(429).json({ error: 'Too many requests, please try again later' });
  },
});
app.use(apiLimiter);

app.get('/health', (req, res) => res.json({ ok: true }));

// Public routes (no auth)
app.use('/api', webhookRouter);
app.use('/api', googleIntegrationsPublicRouter);
app.use('/api', bookingPublicRouter); // public booking flow (unauthenticated)
app.use('/api', authRouter);

// Protected routes
app.use('/api', authMiddleware, messagesRouter);
app.use('/api', authMiddleware, suggestReplyRouter);
app.use('/api', authMiddleware, categoriesRouter);
app.use('/api', authMiddleware, contactFieldsRouter);
app.use('/api', authMiddleware, usersRouter);
app.use('/api', authMiddleware, tasksRouter);
app.use('/api', authMiddleware, ventureRouter);
app.use('/api', authMiddleware, uploadsRouter);
app.use('/api', authMiddleware, templatesRouter);
app.use('/api', authMiddleware, broadcastsRouter);
app.use('/api', authMiddleware, chatbotsRouter);
app.use('/api', authMiddleware, mediaRouter);
app.use('/api', authMiddleware, mediaLibraryRouter);
app.use('/api', authMiddleware, whatsappAccountsRouter);
app.use('/api', authMiddleware, googleIntegrationsRouter);
app.use('/api', authMiddleware, agentsRouter);
app.use('/api', authMiddleware, knowledgeBasesRouter);
app.use('/api', authMiddleware, aiModelsRouter);
app.use('/api', authMiddleware, eventsRouter);
app.use('/api', authMiddleware, dashboardRouter);
app.use('/api', authMiddleware, pipelinesRouter);
app.use('/api', authMiddleware, bookingRouter);

// Cron routes — protected by CRON_SECRET, called by Vercel Cron scheduler
app.use('/api', cronRouter);

app.use((err, req, res, next) => {
  if (process.env.NODE_ENV !== 'production') console.error('[Error]', err);
  else console.error('[Error]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

module.exports = app;
