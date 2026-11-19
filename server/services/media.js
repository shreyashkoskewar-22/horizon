'use strict';
/** Video resume inspection: container type from magic bytes and duration from the file itself. */
const fs = require('node:fs');
const { sniff } = require('./files');

/** Reads the movie header ('mvhd') box of an MP4/MOV to obtain the duration in seconds. */
function mvhdDuration(buf) {
  let idx = buf.indexOf('mvhd');
  while (idx !== -1 && idx + 32 <= buf.length) {
    try {
      const version = buf[idx + 4];
      let timescale = 0;
      let duration = 0;
      if (version === 0) { timescale = buf.readUInt32BE(idx + 16); duration = buf.readUInt32BE(idx + 20); }
      else if (version === 1) { timescale = buf.readUInt32BE(idx + 24); duration = Number(buf.readBigUInt64BE(idx + 28)); }
      if (timescale > 0 && timescale < 10_000_000 && duration > 0) return duration / timescale;
    } catch { /* keep scanning */ }
    idx = buf.indexOf('mvhd', idx + 4);
  }
  return null;
}

/** Best-effort WebM duration from the Segment Info element (often absent in browser recordings). */
function webmDuration(buf) {
  const dIdx = buf.indexOf(Buffer.from([0x44, 0x89]));
  if (dIdx === -1) return null;
  const sizeByte = buf[dIdx + 2];
  let value = null;
  if (sizeByte === 0x84) value = buf.readFloatBE(dIdx + 3);
  else if (sizeByte === 0x88) value = buf.readDoubleBE(dIdx + 3);
  if (value == null || !Number.isFinite(value) || value <= 0) return null;
  let scale = 1_000_000;
  const sIdx = buf.indexOf(Buffer.from([0x2a, 0xd7, 0xb1]));
  if (sIdx !== -1) {
    const len = buf[sIdx + 3] & 0x0f;
    if (len > 0 && len <= 6) scale = buf.readUIntBE(sIdx + 4, len);
  }
  const seconds = (value * scale) / 1e9;
  return seconds > 0 && seconds < 36000 ? seconds : null;
}

async function inspectVideo(filePath, size) {
  const fh = await fs.promises.open(filePath, 'r');
  try {
    const headLen = Math.min(size, 1024 * 1024);
    const head = Buffer.alloc(headLen);
    await fh.read(head, 0, headLen, 0);
    const type = sniff(head);
    let duration = null;
    if (type === 'mp4' || type === 'mov') {
      duration = mvhdDuration(head);
      if (duration == null && size > headLen) {
        const tailLen = Math.min(size, 8 * 1024 * 1024);
        const tail = Buffer.alloc(tailLen);
        await fh.read(tail, 0, tailLen, size - tailLen);
        duration = mvhdDuration(tail);
      }
    } else if (type === 'webm') {
      duration = webmDuration(head);
    }
    return { type: ['mp4', 'mov', 'webm'].includes(type) ? type : null, duration };
  } finally {
    await fh.close();
  }
}

module.exports = { inspectVideo, mvhdDuration, webmDuration };
