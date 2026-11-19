'use strict';
/** express-session store backed by the application's SQLite database. */
const session = require('express-session');

class SqliteSessionStore extends session.Store {
  constructor(db, { ttlMs = 8 * 3600 * 1000, cleanupMs = 15 * 60 * 1000 } = {}) {
    super();
    this.db = db;
    this.ttlMs = ttlMs;
    this.timer = setInterval(() => this.cleanup(), cleanupMs);
    this.timer.unref();
  }

  expiry(sess) {
    const exp = sess && sess.cookie && sess.cookie.expires ? new Date(sess.cookie.expires).getTime() : NaN;
    return Number.isFinite(exp) ? exp : Date.now() + this.ttlMs;
  }

  get(sid, cb) {
    try {
      const row = this.db.get('SELECT sess, expires FROM sessions WHERE sid = ?', [sid]);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.db.run('DELETE FROM sessions WHERE sid = ?', [sid]); return cb(null, null); }
      return cb(null, JSON.parse(row.sess));
    } catch (err) { return cb(err); }
  }

  set(sid, sess, cb) {
    try {
      this.db.run(
        `INSERT INTO sessions (sid, sess, user_id, expires) VALUES (?, ?, ?, ?)
         ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, user_id = excluded.user_id, expires = excluded.expires`,
        [sid, JSON.stringify(sess), sess.userId || null, this.expiry(sess)],
      );
      return cb && cb(null);
    } catch (err) { return cb && cb(err); }
  }

  touch(sid, sess, cb) {
    try {
      this.db.run('UPDATE sessions SET expires = ? WHERE sid = ?', [this.expiry(sess), sid]);
      return cb && cb(null);
    } catch (err) { return cb && cb(err); }
  }

  destroy(sid, cb) {
    try { this.db.run('DELETE FROM sessions WHERE sid = ?', [sid]); return cb && cb(null); } catch (err) { return cb && cb(err); }
  }

  /** Invalidates every session belonging to a user (used on suspension / password change). */
  destroyForUser(userId) { this.db.run('DELETE FROM sessions WHERE user_id = ?', [userId]); }

  cleanup() {
    try { this.db.run('DELETE FROM sessions WHERE expires < ?', [Date.now()]); } catch { /* db may be closed during shutdown */ }
  }

  close() { clearInterval(this.timer); }
}

module.exports = { SqliteSessionStore };
