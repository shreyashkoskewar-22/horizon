'use strict';
const path = require('node:path');
const express = require('express');
const session = require('express-session');
const config = require('./config');
const { getDb } = require('./db');
const { migrate } = require('./db/migrate');
const { SqliteSessionStore } = require('./lib/session-store');
const { HttpError } = require('./lib/util');
const { securityHeaders, csrfProtection, limiters } = require('./middleware/security');
const { loadUser } = require('./middleware/auth');
const { ensureStorage } = require('./services/files');
const { homeFor, isFullyApproved } = require('./services/users');

function createApp() {
  const db = getDb();
  migrate(db, { log: config.isTest ? () => {} : console.log });
  ensureStorage();

  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', config.trustProxy);

  const store = new SqliteSessionStore(db, { ttlMs: config.sessionMaxAgeHours * 3600 * 1000 });
  app.locals.sessionStore = store;

  app.use(securityHeaders());
  app.use(express.json({ limit: '256kb' }));
  app.use(session({
    name: 'horizon.sid',
    secret: config.sessionSecret,
    store,
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: config.isProd, maxAge: config.sessionMaxAgeHours * 3600 * 1000 },
  }));
  app.use(loadUser);

  /* ------------------------------------------------------------------ API */
  const api = express.Router();
  api.use(limiters.api);
  api.use(csrfProtection);
  api.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  api.use('/auth', require('./routes/auth'));
  api.use('/', require('./routes/public'));
  api.use('/opportunities', require('./routes/opportunities'));
  api.use('/', require('./routes/student'));
  api.use('/', require('./routes/profile'));
  api.use('/', require('./routes/directory'));
  api.use('/grievances', require('./routes/grievances'));
  api.use('/recruiter', require('./routes/recruiter'));
  api.use('/admin', require('./routes/admin'));
  api.use((req, res, next) => next(new HttpError(404, 'API endpoint not found.')));
  app.use('/api', api);

  /* ---------------------------------------------------------------- Pages */
  const pub = config.publicDir;
  const page = (file) => (req, res) => res.sendFile(path.join(pub, file));
  const redirectIfSignedIn = (req, res, next) => (req.user ? res.redirect(isFullyApproved(req.user) ? homeFor(req.user) : '/verify') : next());
  const requireSignedIn = (req, res, next) => (req.user ? next() : res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`));

  app.get('/', page('index.html'));
  app.get('/login', redirectIfSignedIn, page('login.html'));
  app.get('/register', redirectIfSignedIn, page('register.html'));
  app.get('/verify', requireSignedIn, (req, res, next) => (isFullyApproved(req.user) ? res.redirect(homeFor(req.user)) : next()), page('verify.html'));
  app.get('/terms', page('terms.html'));
  app.get('/privacy', page('privacy.html'));
  app.get('/grievance-redressal', page('grievance.html'));
  app.get('/transparency', page('transparency.html'));

  // Role-scoped application shells. The real protection is on every API route; this guard keeps
  // unauthenticated, unverified and wrong-role users away from the pages themselves.
  app.get(/^\/(app|recruiter|admin)(\/.*)?$/, (req, res) => {
    const area = req.path.split('/')[1];
    if (!req.user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (!isFullyApproved(req.user)) return res.redirect('/verify');
    const allowed = { app: 'student', recruiter: 'recruiter', admin: 'admin' }[area];
    if (req.user.role !== allowed) return res.redirect(homeFor(req.user));
    return res.sendFile(path.join(pub, 'app.html'));
  });

  // Static assets. HTML files are only reachable through the routes above.
  app.use((req, res, next) => (req.path.endsWith('.html') ? next(new HttpError(404, 'Page not found.')) : next()));
  app.use(express.static(pub, { index: false, maxAge: config.isProd ? '7d' : 0, setHeaders: (res, file) => { if (file.endsWith('.js') || file.endsWith('.css')) res.set('Cache-Control', config.isProd ? 'public, max-age=3600' : 'no-cache'); } }));

  app.use((req, res, next) => next(new HttpError(404, 'Page not found.')));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    let error = err;
    if (err && err.type === 'entity.too.large') error = new HttpError(413, 'The request is too large.');
    if (err && err.type === 'entity.parse.failed') error = new HttpError(400, 'Malformed JSON in request.', { code: 'BAD_JSON' });
    const status = error.status || error.statusCode || 500;
    if (status >= 500) console.error('[error]', err);
    const isApi = req.originalUrl.startsWith('/api/');
    if (isApi) {
      const expose = error instanceof HttpError || status < 500;
      return res.status(status).json({ error: { code: error.code || 'ERROR', message: expose ? error.message : 'Something went wrong on our side. Please try again.', fields: error.fields } });
    }
    return res.status(status).sendFile(path.join(pub, status === 404 ? '404.html' : 'error.html'));
  });

  return app;
}

module.exports = { createApp };
