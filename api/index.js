// Vercel serverless entry point.
// See comments below for required environment variables.

let app;
let initError;

try {
  // dotenv + bootstrapSecrets are called inside backend/src/app.js, which
  // resolves them from backend/node_modules — do NOT require('dotenv') here
  // because api/ has no node_modules of its own.
  app = require('../backend/src/app');
} catch (err) {
  initError = err;
  console.error('[ForgeChat] STARTUP CRASH:', err.message, err.stack);
}

let initPromise = null;

function init() {
  if (initPromise) return initPromise;

  const pool = require('../backend/src/db');
  const { runMigrations } = require('../backend/src/db/migrate');
  const { ensureTables } = require('../backend/src/auth');
  const mediaStorage = require('../backend/src/util/pgStorage');

  initPromise = runMigrations(pool)
    .then(() => ensureTables())
    .then(() => mediaStorage.ensureBucket())
    .then(() => console.log('[ForgeChat] instance ready'))
    .catch((err) => {
      console.error('[ForgeChat] init error:', err.message);
      initPromise = null;
    });

  return initPromise;
}

if (!initError) init();

module.exports = async (req, res) => {
  // If the app failed to load, surface the real error in the response
  if (initError) {
    return res.status(500).json({
      error: 'Startup failed',
      message: initError.message,
      stack: process.env.NODE_ENV !== 'production' ? initError.stack : undefined,
    });
  }
  await init();
  app(req, res);
};
