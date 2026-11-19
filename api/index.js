'use strict';
const path = require('node:path');
const config = require('../server/config');
const { createApp } = require('../server/app');
const { getDb } = require('../server/db');

let app;

try {
  app = createApp();

  // Run initialization / seed on cold start if empty
  try {
    const db = getDb();
    if (!db.value("SELECT COUNT(*) FROM users WHERE role = 'admin'")) {
      const seedModule = require('../server/db/seed');
      seedModule.seed(db, { log: () => {} }).catch((err) => {
        console.error('[seed error]', err.message);
      });
    }
  } catch (seedErr) {
    console.error('[init db error]', seedErr.message);
  }
} catch (startupError) {
  console.error('[HORIZON Startup Error]', startupError);
  const express = require('express');
  app = express();
  app.use((req, res) => {
    res.status(500).type('text/html').send(`
      <!doctype html>
      <html>
      <head><title>HORIZON Startup Error</title></head>
      <body style="font-family: monospace; padding: 32px; background: #0f172a; color: #f87171;">
        <h2>HORIZON Serverless Startup Error</h2>
        <pre style="background: #1e293b; padding: 16px; border-radius: 8px; overflow: auto; color: #e2e8f0;">${startupError.stack || startupError.message}</pre>
      </body>
      </html>
    `);
  });
}

module.exports = app;
