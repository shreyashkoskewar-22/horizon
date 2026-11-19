'use strict';
/**
 * Reference data that a real deployment also needs (unlike the demo seed):
 *   - the Ministry of Education list of Institutions of National Importance, with the email
 *     domains we have confirmed so far, and
 *   - country guides that link only to official government sources.
 * Both are editable by administrators afterwards. Safe to run in production.
 */
const { nowSql } = require('../lib/util');
const INST = require('./seed-institutions');
const CONTENT = require('./seed-content');

/** Date the bundled destination guides were written and checked against their sources. */
const DESTINATIONS_PREPARED_ON = '2026-11-18';

function seedInstitutions(db) {
  if (db.value('SELECT COUNT(*) FROM institutions')) return { inserted: 0, ids: Object.fromEntries(db.all('SELECT id, name FROM institutions').map((r) => [r.name, r.id])) };
  const ids = {};
  db.tx(() => {
    for (const [name, city, state, act] of INST.ROWS) {
      const { lastInsertRowid } = db.run(`INSERT INTO institutions (name, short_name, category, city, state, recognition_reference, recognition_source_url,
        verification_status, verification_note, is_active, verified_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'verified', ?, 1, ?)`,
      [name, INST.shortName(name), INST.category(name), city, state, act, INST.SOURCE_URL, `Listed by the Ministry of Education as an Institution of National Importance (retrieved ${INST.RETRIEVED}).`, nowSql()]);
      ids[name] = lastInsertRowid;
    }
    // An example of an institution that must NOT be auto-approved until checked against an official source.
    db.run(`INSERT INTO institutions (name, short_name, category, city, state, recognition_reference, verification_status, verification_note, is_active)
      VALUES ('Indian Institute of Management Mumbai', 'IIM Mumbai', 'IIM', 'Mumbai', 'Maharashtra', 'Indian Institutes of Management (Amendment) Act, 2023 — to be confirmed', 'unverified',
      'Not on the Ministry of Education list retrieved 18 Nov 2026. Confirm against the official Gazette notification before approving.', 1)`);
    for (const [name, domains] of Object.entries(INST.DOMAINS)) {
      for (const domain of domains) db.run('INSERT INTO institution_domains (institution_id, domain, is_verified) VALUES (?, ?, 1)', [ids[name], domain]);
    }
  });
  return { inserted: INST.ROWS.length + 1, ids };
}

function seedDestinations(db, updatedBy = null) {
  if (db.value('SELECT COUNT(*) FROM destination_resources')) return 0;
  db.tx(() => {
    for (const d of CONTENT.DESTINATIONS) {
      db.run(`INSERT INTO destination_resources (country, slug, region, overview, major_sectors, common_durations, work_arrangements, visa_resources, official_links, relocation_considerations,
        source_url, last_updated, is_published, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
      [d.country, d.country.toLowerCase().replace(/[^a-z0-9]+/g, '-'), d.region, d.overview, JSON.stringify(d.sectors), d.durations, d.work, JSON.stringify(d.visa),
        JSON.stringify(d.links), d.relocation, d.source, DESTINATIONS_PREPARED_ON, updatedBy]);
    }
  });
  return CONTENT.DESTINATIONS.length;
}

module.exports = { seedInstitutions, seedDestinations, DESTINATIONS_PREPARED_ON };
