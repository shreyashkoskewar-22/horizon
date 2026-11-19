'use strict';
const express = require('express');
const config = require('../config');
const { getDb } = require('../db');
const { likeEscape } = require('../lib/util');
const { INDUSTRIES, ORG_TYPES, INSTITUTION_CATEGORIES, GRIEVANCE_CATEGORIES, CURRENCIES, ACADEMIC_LEVELS } = require('../lib/constants');
const opps = require('../services/opportunities');
const { transparencyReport } = require('../services/grievances');

const router = express.Router();
const db = () => getDb();

router.get('/config', (req, res) => {
  res.json({
    env: config.env,
    captcha: { provider: config.captcha.provider, siteKey: config.captcha.siteKey, devToken: config.captcha.provider === 'dev-bypass' ? config.captcha.devToken : undefined, testKeys: config.captcha.usingTestKeys },
    devMailbox: config.mail.devMailbox && (!config.isProd || process.env.ALLOW_DEMO_SEED === 'true'),
    uploads: config.uploads,
    grievance: { officerName: config.grievance.officerName, officerEmail: config.grievance.officerEmail, ackHours: config.grievance.ackHours, resolveDays: config.grievance.resolveDays, urgentResolveHours: config.grievance.urgentResolveHours, appealDays: config.grievance.appealDays, reopenDays: config.grievance.reopenDays, respondentDays: config.grievance.respondentDays },
    recruiterResponseDays: config.recruiterResponseDays,
    // Development convenience only: lets the login page pre-fill the seeded demo accounts.
    demoAccounts: (config.env === 'development' || process.env.ALLOW_DEMO_SEED === 'true') ? [
      { role: 'Student (approved)', email: config.seed.studentEmail, password: config.seed.studentPassword },
      { role: 'Recruiter (verified)', email: config.seed.recruiterEmail, password: config.seed.recruiterPassword },
      { role: 'Administrator', email: config.seed.adminEmail, password: config.seed.adminPassword },
      { role: 'Student (pending review)', email: config.seed.pendingStudentEmail, password: config.seed.pendingStudentPassword },
    ] : undefined,
    lists: {
      industries: INDUSTRIES, orgTypes: ORG_TYPES, institutionCategories: INSTITUTION_CATEGORIES, currencies: CURRENCIES, academicLevels: ACADEMIC_LEVELS,
      grievanceCategories: Object.entries(GRIEVANCE_CATEGORIES).map(([value, c]) => ({ value, label: c.label, priority: c.priority })),
    },
  });
});

/** Approved, active INIs for the registration form. */
router.get('/public/institutions', (req, res) => {
  const rows = db().all(`
    SELECT i.id, i.name, i.short_name, i.category, i.city, i.state,
           (SELECT group_concat(d.domain, ',') FROM institution_domains d WHERE d.institution_id = i.id AND d.is_verified = 1) AS domains
    FROM institutions i WHERE i.is_active = 1 AND i.verification_status = 'verified' ORDER BY i.name`);
  res.json({
    items: rows.map((r) => ({ id: r.id, name: r.name, shortName: r.short_name, category: r.category, city: r.city, state: r.state, domains: r.domains ? r.domains.split(',') : [] })),
  });
});

/** Verified organisations for recruiter registration (name search). */
router.get('/public/organisations', (req, res) => {
  const q = String(req.query.q || '').slice(0, 60);
  const rows = db().all(`
    SELECT id, name, email_domain, country FROM organisations
    WHERE verification_status = 'verified' AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 20`, [`%${likeEscape(q)}%`]);
  res.json({ items: rows.map((r) => ({ id: r.id, name: r.name, emailDomain: r.email_domain, country: r.country })) });
});

/** Landing page data. Counts are live database figures; teasers expose no application details. */
router.get('/public/landing', (req, res) => {
  const d = db();
  const open = `FROM opportunities o WHERE ${opps.OPEN_WHERE}`;
  const featured = opps.listOpen({ orderBy: 'o.is_featured DESC, o.application_deadline ASC', limit: 6 }).map((r) => {
    const c = opps.serializeCard(r);
    return { id: c.id, title: c.title, organisation: c.organisation, country: c.country, city: c.city, industry: c.industry, durationWeeks: c.durationWeeks, workMode: c.workMode, isPaid: c.isPaid, stipend: c.stipend, deadline: c.deadline, visaSponsorship: c.visaSponsorship, isDemo: c.isDemo, isVerified: c.isVerified, lastVerifiedAt: c.isVerified ? c.lastVerifiedAt : null, applicationMode: c.applicationMode };
  });
  res.json({
    stats: {
      openListings: d.value(`SELECT COUNT(*) ${open}`),
      countries: d.value(`SELECT COUNT(DISTINCT o.country) ${open}`),
      verifiedInstitutions: d.value("SELECT COUNT(*) FROM institutions WHERE verification_status = 'verified' AND is_active = 1"),
      verifiedOrganisations: d.value("SELECT COUNT(*) FROM organisations WHERE verification_status = 'verified'"),
      containsDemoData: !!d.value(`SELECT COUNT(*) ${open} AND o.is_demo = 1`),
    },
    featured,
    destinations: d.all(`SELECT o.country, COUNT(*) AS count, MIN(o.city) AS city, dr.slug FROM opportunities o
      LEFT JOIN destination_resources dr ON dr.country = o.country AND dr.is_published = 1
      WHERE ${opps.OPEN_WHERE} GROUP BY o.country ORDER BY count DESC, o.country LIMIT 12`),
    industries: d.all(`SELECT o.industry, COUNT(*) AS count ${open} GROUP BY o.industry ORDER BY count DESC, o.industry`),
    institutionCategories: d.all("SELECT category, COUNT(*) AS count FROM institutions WHERE verification_status = 'verified' AND is_active = 1 GROUP BY category ORDER BY count DESC"),
  });
});

router.get('/public/grievance-report', (req, res) => res.json(transparencyReport()));

module.exports = router;
