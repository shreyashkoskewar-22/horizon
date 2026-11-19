'use strict';
const config = require('./config');
const { createApp } = require('./app');
const { getDb, closeDb } = require('./db');
const { archiveExpired } = require('./services/opportunities');

async function main() {
  const app = createApp();
  const db = getDb();

  if (config.seed.onStart && !db.value("SELECT COUNT(*) FROM users WHERE role = 'admin'")) {
    console.log('[seed] Empty database detected — loading demo data (SEED_ON_START=true).');
    await require('./db/seed').seed(db);
  }

  const archived = archiveExpired();
  if (archived) console.log(`[jobs] archived ${archived} expired listing(s)`);
  const timer = setInterval(() => { try { archiveExpired(); } catch (e) { console.error('[jobs]', e.message); } }, 6 * 3600 * 1000);
  timer.unref();

  const server = app.listen(config.port, config.host, () => {
    const url = `http://${['0.0.0.0', '127.0.0.1', '::'].includes(config.host) ? 'localhost' : config.host}:${config.port}`;
    console.log(`\n  HORIZON is running at ${url}`);
    console.log(`  Environment: ${config.env} · Database: ${config.databaseFile}`);
    console.log(`  CAPTCHA: ${config.captcha.provider}${config.captcha.provider === 'turnstile' && config.captcha.usingTestKeys ? ' (Cloudflare test keys — always pass)' : ''}`);
    if (!config.isProd) {
      console.log('\n  Demo accounts (development only):');
      console.log(`    Student   ${config.seed.studentEmail} / ${config.seed.studentPassword}`);
      console.log(`    Recruiter ${config.seed.recruiterEmail} / ${config.seed.recruiterPassword}`);
      console.log(`    Admin     ${config.seed.adminEmail} / ${config.seed.adminPassword}`);
      console.log(`    Pending   ${config.seed.pendingStudentEmail} / ${config.seed.pendingStudentPassword}\n`);
    }
  });

  const shutdown = () => {
    server.close(() => { app.locals.sessionStore.close(); closeDb(); process.exit(0); });
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('[startup] HORIZON failed to start:', err.message);
  process.exit(1);
});
