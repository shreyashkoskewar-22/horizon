'use strict';
const path = require('node:path');
const config = require('../server/config');
const { createApp } = require('../server/app');
const { getDb } = require('../server/db');

let appInstance = null;

module.exports = async (req, res) => {
  if (!appInstance) {
    appInstance = createApp();
    const db = getDb();
    if (!db.value("SELECT COUNT(*) FROM users WHERE role = 'admin'")) {
      try {
        const seedModule = require('../server/db/seed');
        if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') {
          const { seedInstitutions, seedDestinations } = require('../server/db/reference-data');
          seedInstitutions(db);
          seedDestinations(db, null);
        } else {
          await seedModule.seed(db, { log: () => {} });
        }
      } catch (err) {
        console.error('[seed warning]', err.message);
      }
    }
  }
  return appInstance(req, res);
};
