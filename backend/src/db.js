const { Pool } = require('pg');

// On Vercel, many function instances can run concurrently. Keep the pool small
// so we don't exhaust Supabase's connection limit across instances.
// On Docker, a single long-lived process can safely use a larger pool.
const POOL_MAX = process.env.VERCEL ? 5 : 20;

function buildPool() {
  const connectionString = process.env.DATABASE_URL;
  if (connectionString) {
    return new Pool({
      connectionString,
      ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
      max: POOL_MAX,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
      application_name: 'forgecrm-backend',
    });
  }

  // Fallback to individual env vars (Docker Compose pattern)
  return new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '',
    ssl: process.env.POSTGRES_SSL === 'true' ? { rejectUnauthorized: false } : false,
    max: POOL_MAX,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'forgecrm-backend',
  });
}

const pool = buildPool();

pool.on('error', (err) => {
  console.error('[DB] Unexpected pool error:', err.message);
});

module.exports = pool;
