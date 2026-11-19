'use strict';
const path = require('node:path');
const config = require('../server/config');
const { createApp } = require('../server/app');
const { getDb } = require('../server/db');

let app;
let initPromise = null;

try {
  app = createApp();

  try {
    const db = getDb();
    if (!db.value("SELECT COUNT(*) FROM users WHERE role = 'admin'")) {
      const seedModule = require('../server/db/seed');
      initPromise = seedModule.seed(db, { log: () => {} }).catch((err) => {
        console.error('[seed error]', err.message);
      });
    }
  } catch (seedErr) {
    console.error('[init db error]', seedErr.message);
  }
} catch (startupError) {
  console.error('[HORIZON Startup Error]', startupError);
}

module.exports = async (req, res) => {
  if (initPromise) {
    try { await initPromise; } catch {}
    initPromise = null;
  }
  if (!app) {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    return res.end(JSON.stringify({ error: { code: 'STARTUP_ERROR', message: 'Failed to initialize app.' } }));
  }
  return app(req, res);
};
