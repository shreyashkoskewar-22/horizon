'use strict';
/**
 * Private file storage. Uploads land in storage/tmp (multer), are verified by magic bytes
 * (never by the browser-supplied MIME type), then moved into storage/<kind>/ with a random
 * server-generated name. Nothing under storage/ is reachable through a public URL.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const multer = require('multer');
const config = require('../config');
const { getDb } = require('../db');
const { HttpError } = require('../lib/util');

const DIRS = { cv: 'cvs', video: 'videos', id_proof: 'proofs', org_proof: 'proofs', grievance_evidence: 'evidence' };
const TMP_DIR = () => path.join(config.storageDir, 'tmp');

function ensureStorage() {
  for (const d of [...new Set(Object.values(DIRS)), 'tmp']) fs.mkdirSync(path.join(config.storageDir, d), { recursive: true });
}

const TYPES = {
  pdf: { mime: 'application/pdf', ext: 'pdf' },
  png: { mime: 'image/png', ext: 'png' },
  jpeg: { mime: 'image/jpeg', ext: 'jpg' },
  mp4: { mime: 'video/mp4', ext: 'mp4' },
  mov: { mime: 'video/quicktime', ext: 'mov' },
  webm: { mime: 'video/webm', ext: 'webm' },
};

/** Identifies a file from its leading bytes. */
function sniff(head) {
  if (!head || head.length < 12) return null;
  if (head.subarray(0, 1024).toString('latin1').includes('%PDF-')) return 'pdf';
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpeg';
  if (head.subarray(4, 8).toString('latin1') === 'ftyp') return head.subarray(8, 12).toString('latin1') === 'qt  ' ? 'mov' : 'mp4';
  if (head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3 && head.subarray(0, 64).toString('latin1').includes('webm')) return 'webm';
  return null;
}

function readHead(filePath, bytes = 4096) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(bytes);
    const n = fs.readSync(fd, buf, 0, bytes, 0);
    return buf.subarray(0, n);
  } finally { fs.closeSync(fd); }
}

function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(filePath).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}

function safeOriginalName(name, fallback = 'document') {
  const base = path.basename(String(name || fallback)).replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').trim();
  return (base || fallback).slice(-120);
}

function absolutePath(doc) { return path.join(config.storageDir, DIRS[doc.kind], doc.stored_name); }

function removeTemp(file) { if (file && file.path) fs.rm(file.path, { force: true }, () => {}); }

/** Moves a verified temp upload into private storage and records it in `documents`. */
function storeDocument({ file, userId, kind, type, sha256, reviewStatus = 'submitted', report = null, meta = null, isCurrent = 1 }) {
  const { ext, mime } = TYPES[type];
  const storedName = `${kind}-${crypto.randomUUID()}.${ext}`;
  const dest = path.join(config.storageDir, DIRS[kind], storedName);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.renameSync(file.path, dest);
  const db = getDb();
  const { lastInsertRowid } = db.run(
    `INSERT INTO documents (user_id, kind, original_name, stored_name, mime_type, size_bytes, sha256, review_status, validation_report, meta, is_current)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [userId ?? null, kind, safeOriginalName(file.originalname, `${kind}.${ext}`), storedName, mime, file.size, sha256, reviewStatus,
      report ? JSON.stringify(report) : null, meta ? JSON.stringify(meta) : null, isCurrent],
  );
  return db.get('SELECT * FROM documents WHERE id = ?', [lastInsertRowid]);
}

/** Writes an in-memory buffer as a document (used by the seed script). */
function storeBuffer({ buffer, originalName, userId, kind, type, reviewStatus, report, meta, createdAt }) {
  const tmp = path.join(TMP_DIR(), `seed-${crypto.randomUUID()}`);
  fs.mkdirSync(TMP_DIR(), { recursive: true });
  fs.writeFileSync(tmp, buffer);
  const doc = storeDocument({ file: { path: tmp, originalname: originalName, size: buffer.length }, userId, kind, type, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), reviewStatus, report, meta });
  if (createdAt) getDb().run('UPDATE documents SET created_at = ? WHERE id = ?', [createdAt, doc.id]);
  return doc;
}

/** Deletes the file of a non-current document unless an application still references it. */
function deleteDocumentIfUnused(doc) {
  const db = getDb();
  const used = db.value('SELECT COUNT(*) FROM applications WHERE cv_document_id = ? OR video_document_id = ?', [doc.id, doc.id])
    + db.value('SELECT COUNT(*) FROM verification_requests WHERE document_id = ?', [doc.id])
    + db.value('SELECT COUNT(*) FROM grievances WHERE evidence_document_id = ?', [doc.id]);
  if (used) return false;
  db.run('DELETE FROM documents WHERE id = ?', [doc.id]);
  fs.rm(absolutePath(doc), { force: true }, () => {});
  return true;
}

/** Multer factory: random temp names, size limit, single field. Final type check is by magic bytes. */
function uploader(field, maxMb, allowedExt) {
  const storage = multer.diskStorage({
    destination: (req, file, cb) => { fs.mkdirSync(TMP_DIR(), { recursive: true }); cb(null, TMP_DIR()); },
    filename: (req, file, cb) => cb(null, `up-${crypto.randomUUID()}`),
  });
  const mw = multer({
    storage,
    limits: { fileSize: maxMb * 1024 * 1024, files: 1, fields: 20, fieldSize: 64 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname || '').toLowerCase().replace('.', '');
      if (allowedExt.includes(ext)) return cb(null, true);
      return cb(new HttpError(422, `Unsupported file type. Allowed: ${allowedExt.join(', ').toUpperCase()}.`, { fields: { [field]: `Allowed formats: ${allowedExt.join(', ').toUpperCase()}.` } }));
    },
  }).single(field);
  return (req, res, next) => {
    res.on('close', () => removeTemp(req.file)); // temp file is gone if it was moved; otherwise cleaned up
    mw(req, res, (err) => {
      if (err instanceof multer.MulterError) {
        const msg = err.code === 'LIMIT_FILE_SIZE' ? `File is too large. The maximum size is ${maxMb} MB.` : 'The upload could not be processed.';
        return next(new HttpError(err.code === 'LIMIT_FILE_SIZE' ? 413 : 422, msg, { code: err.code, fields: { [field]: msg } }));
      }
      return next(err);
    });
  };
}

module.exports = { ensureStorage, sniff, readHead, hashFile, safeOriginalName, absolutePath, storeDocument, storeBuffer, deleteDocumentIfUnused, uploader, removeTemp, TYPES, DIRS };
