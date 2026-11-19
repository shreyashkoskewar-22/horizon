'use strict';
/**
 * Development seed. Usage:
 *   npm run db:seed    — seeds an empty database
 *   npm run db:reset   — deletes the database and private uploads, then migrates and seeds
 * Refuses to run when NODE_ENV=production: demo accounts must never exist in production.
 */
const fs = require('node:fs');
const path = require('node:path');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { toSql, nowSql, addDays, addHours, dateOnly, sha256 } = require('../lib/util');
const { toUsdMonthly } = require('../lib/constants');
const { makePdf, makeCvPdf } = require('../lib/simple-pdf');
const INST = require('./seed-institutions');
const CONTENT = require('./seed-content');
const { seedInstitutions, seedDestinations } = require('./reference-data');

const ago = (days, hours = 0) => toSql(addHours(addDays(new Date(), -days), -hours));
const inDays = (days) => dateOnly(addDays(new Date(), days));

async function seed(db, { log = console.log } = {}) {
  if (config.isProd && process.env.ALLOW_DEMO_SEED !== 'true') throw new Error('Refusing to seed demo data in production.');
  const files = require('../services/files');
  const { validateResume } = require('../services/resume-validator');
  files.ensureStorage();
  const S = config.seed;
  const hash = (pw) => bcrypt.hashSync(pw, config.isTest ? 4 : 10);

  // ---------------------------------------------------------------- Institutions
  const { ids: instIds } = seedInstitutions(db);
  log(`[seed] ${INST.ROWS.length} Institutions of National Importance (+1 unverified example)`);

  // --------------------------------------------------------------- Organisations
  const orgIds = {};
  for (const o of CONTENT.ORGS) {
    orgIds[o.key] = db.run(`INSERT INTO organisations (name, org_type, website, email_domain, country, headquarters, description, registration_number, verification_status, verified_at, is_demo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [o.name, o.type, `https://www.${o.domain}`, o.domain, o.country, o.hq, o.description, o.reg || null, o.verified ? 'verified' : 'unverified', o.verified ? ago(60) : null]).lastInsertRowid;
  }

  // ----------------------------------------------------------------------- Users
  const addUser = (u) => db.run(`INSERT INTO users (role, full_name, email, password_hash, status, email_verified_at, verification_method, institution_id, organisation_id, created_at, last_login_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [u.role, u.name, u.email, hash(u.password), u.status, u.emailVerified === false ? null : (u.verifiedAt || ago(u.createdDays || 30)), u.method || null,
    u.institution ? instIds[u.institution] : null, u.org ? orgIds[u.org] : null, ago(u.createdDays || 30), u.lastLogin || null]).lastInsertRowid;

  const adminId = addUser({ role: 'admin', name: 'Platform Administrator', email: S.adminEmail, password: S.adminPassword, status: 'approved', method: 'seed', createdDays: 90 });
  const riyaId = addUser({ role: 'student', name: 'Riya Kapoor', email: S.studentEmail, password: S.studentPassword, status: 'approved', method: 'email_domain', institution: 'Indian Institute of Management Indore', createdDays: 45 });
  const arjunId = addUser({ role: 'student', name: 'Arjun Nair', email: 'arjun.demo@iitb.ac.in', password: S.studentPassword, status: 'approved', method: 'email_domain', institution: 'Indian Institute of Technology Bombay', createdDays: 40 });
  const saraId = addUser({ role: 'student', name: 'Sara Thomas', email: 'sara.demo@nitt.edu', password: S.studentPassword, status: 'approved', method: 'email_domain', institution: 'National Institute of Technology, Tiruchirappalli', createdDays: 38 });
  const kabirId = addUser({ role: 'student', name: 'Kabir Menon', email: S.pendingStudentEmail, password: S.pendingStudentPassword, status: 'pending', institution: 'All India Institute of Medical Sciences, New Delhi', createdDays: 1 });
  const meiId = addUser({ role: 'recruiter', name: 'Mei Lin Tan', email: S.recruiterEmail, password: S.recruiterPassword, status: 'approved', method: 'manual', org: 'meridian', createdDays: 60 });
  const eleanorId = addUser({ role: 'recruiter', name: 'Eleanor Hughes', email: 'eleanor.hughes@northbankridge.example', password: S.recruiterPassword, status: 'approved', method: 'manual', org: 'northbank', createdDays: 58 });
  const jonasId = addUser({ role: 'recruiter', name: 'Jonas Weber', email: 'jonas@kestrelwave.example', password: S.recruiterPassword, status: 'approved', method: 'manual', org: 'kestrel', createdDays: 55 });
  const danielId = addUser({ role: 'recruiter', name: 'Daniel Brooks', email: S.pendingRecruiterEmail, password: S.pendingRecruiterPassword, status: 'pending', org: 'harbourline', createdDays: 2 });

  const profile = (userId, p) => db.run(`INSERT INTO student_profiles (user_id, programme, academic_level, current_year, graduation_year, academic_interests, specialisation, skills, languages,
    preferred_countries, preferred_industries, experience, linkedin_url, portfolio_url, github_url, bio) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [userId, p.programme, p.level || 'undergraduate', p.year, p.grad, JSON.stringify(p.interests || []), p.specialisation || null, JSON.stringify(p.skills || []), JSON.stringify(p.languages || []),
    JSON.stringify(p.countries || []), JSON.stringify(p.industries || []), p.experience || null, p.linkedin || null, p.portfolio || null, p.github || null, p.bio || null]);

  profile(riyaId, {
    programme: 'Integrated Programme in Management (IPM)', year: 2, grad: 2029,
    interests: ['Strategy', 'Behavioural economics', 'Product management'], specialisation: 'Economics and business analytics',
    skills: ['Market Research', 'Excel', 'Python', 'SQL', 'PowerPoint', 'Financial Modelling', 'Product Thinking', 'Communication'],
    languages: ['English', 'Hindi', 'French (A2)'], countries: ['Singapore', 'United Kingdom', 'Germany', 'Netherlands'],
    industries: ['Management Consulting', 'Product Management', 'Data Analytics', 'Marketing & Growth'],
    experience: 'Market-entry course project sizing a consumer-tech opportunity across three ASEAN markets.\nBuilt a demand-forecasting model in Python on two years of retail data.\nOrganised an inter-college case competition with 40+ teams.',
    linkedin: 'https://www.linkedin.com/in/riya-kapoor-horizon-demo', bio: 'Second-year IPM student at IIM Indore interested in strategy and product roles where analytics meets customer insight. Looking for a summer internship in Southeast Asia or Europe. (Demo profile.)',
  });
  profile(arjunId, { programme: 'B.Tech, Electrical Engineering', year: 3, grad: 2028, skills: ['Python', 'Excel', 'Problem Solving', 'Market Research'], languages: ['English', 'Hindi', 'Malayalam'], countries: ['Singapore'], industries: ['Management Consulting'], bio: 'Demo student profile.' });
  profile(saraId, { programme: 'B.Tech, Computer Science and Engineering', year: 4, grad: 2027, skills: ['SQL', 'Python', 'Tableau', 'Statistics'], languages: ['English', 'Tamil'], countries: ['Singapore', 'Germany'], industries: ['Data Analytics'], bio: 'Demo student profile.' });
  profile(kabirId, { programme: 'MBBS', year: 3, grad: 2028 });

  const recProfile = (userId, designation, bio) => db.run('INSERT INTO recruiter_profiles (user_id, designation, bio) VALUES (?, ?, ?)', [userId, designation, bio]);
  recProfile(meiId, 'Campus Recruiting Manager', 'I lead early-careers hiring for Meridian Arc across Asia-Pacific. Every application gets a reply from our team. (Demo recruiter.)');
  recProfile(eleanorId, 'Graduate Recruitment Lead', 'Demo recruiter for Northbank Ridge Capital.');
  recProfile(jonasId, 'Head of Talent', 'Demo recruiter for Kestrelwave AI Lab.');
  recProfile(danielId, 'University Recruiting Lead', 'Demo recruiter awaiting verification.');

  // ------------------------------------------------------------------- Documents
  const inst = (name) => db.get('SELECT name, short_name FROM institutions WHERE id = ?', [instIds[name]]);
  async function cvFor(userId, name, email, instName, programme, grad, days) {
    const buffer = makeCvPdf({ name, email, institution: instName, programme, graduationYear: grad });
    const report = await validateResume(buffer, { fullName: name, institution: inst(instName), graduationYear: grad });
    return files.storeBuffer({ buffer, originalName: `${name.replace(/\s+/g, '_')}_CV.pdf`, userId, kind: 'cv', type: 'pdf', reviewStatus: report.status, report, meta: report.meta, createdAt: ago(days) });
  }
  const riyaCv = await cvFor(riyaId, 'Riya Kapoor', S.studentEmail, 'Indian Institute of Management Indore', 'Integrated Programme in Management', 2029, 20);
  db.run("UPDATE documents SET review_status = 'verified', reviewed_by = ?, reviewed_at = ?, review_note = 'Checked against institutional records (demo).' WHERE id = ?", [adminId, ago(18), riyaCv.id]);
  const arjunCv = await cvFor(arjunId, 'Arjun Nair', 'arjun.demo@iitb.ac.in', 'Indian Institute of Technology Bombay', 'B.Tech, Electrical Engineering', 2028, 25);
  const saraCv = await cvFor(saraId, 'Sara Thomas', 'sara.demo@nitt.edu', 'National Institute of Technology, Tiruchirappalli', 'B.Tech, Computer Science and Engineering', 2027, 22);

  const assets = path.join(__dirname, 'seed-assets');
  const readAsset = (filename) => {
    const p = path.join(assets, filename);
    return fs.existsSync(p) ? fs.readFileSync(p) : Buffer.from('ftypisom', 'utf8');
  };
  const videoReport = { status: 'approved', checks: [{ id: 'format', label: 'Video format', result: 'pass', detail: 'MP4 container confirmed from file contents.' }, { id: 'duration', label: 'Length', result: 'warn', detail: '8 seconds measured from the file — demo placeholder.' }], checkedAt: new Date().toISOString() };
  const riyaVideo = files.storeBuffer({ buffer: readAsset('demo-student-video.mp4'), originalName: 'Riya_Kapoor_video_resume.mp4', userId: riyaId, kind: 'video', type: 'mp4', reviewStatus: 'approved', report: videoReport, meta: { durationSeconds: 8, measured: true }, createdAt: ago(16) });
  files.storeBuffer({ buffer: readAsset('demo-recruiter-video.mp4'), originalName: 'Meridian_intro.mp4', userId: meiId, kind: 'video', type: 'mp4', reviewStatus: 'approved', report: videoReport, meta: { durationSeconds: 8, measured: true }, createdAt: ago(50) });

  const idCard = makePdf([[{ text: 'DEMO STUDENT IDENTITY CARD', bold: true, size: 16 }, 'NOT A REAL DOCUMENT - generated for the HORIZON demo', { text: 'All India Institute of Medical Sciences, New Delhi', gap: 12 }, 'Name: Kabir Menon', 'Programme: MBBS (Year 3)', 'Valid until: 2028']], { title: 'Demo ID card' });
  const kabirProof = files.storeBuffer({ buffer: idCard, originalName: 'Kabir_Menon_student_ID.pdf', userId: kabirId, kind: 'id_proof', type: 'pdf', reviewStatus: 'submitted', createdAt: ago(0, 20) });
  const letter = makePdf([[{ text: 'DEMO AUTHORISATION LETTER', bold: true, size: 16 }, 'NOT A REAL DOCUMENT - generated for the HORIZON demo', { text: 'Harbourline Signal Analytics (fictional)', gap: 12 }, 'This letter confirms that Daniel Brooks, University Recruiting Lead,', 'is authorised to recruit interns on behalf of the organisation.', 'Registration number: DEMO-US-EIN-00-0000000']], { title: 'Demo authorisation letter' });
  const danielProof = files.storeBuffer({ buffer: letter, originalName: 'Harbourline_authorisation_letter.pdf', userId: danielId, kind: 'org_proof', type: 'pdf', reviewStatus: 'submitted', createdAt: ago(1) });

  db.run(`INSERT INTO verification_requests (user_id, request_type, document_id, submitted_note, auto_checks, created_at) VALUES (?, 'student', ?, ?, ?, ?)`, [kabirId, kabirProof.id, 'AIIMS does not issue me an institutional email I can access yet — attaching my student ID.',
    JSON.stringify([{ label: 'Email address verified', ok: true, detail: S.pendingStudentEmail }, { label: 'Institution is a verified INI', ok: true, detail: 'All India Institute of Medical Sciences Act, 1956 and amendments' }, { label: 'Email domain matches institution', ok: false, detail: 'No verified email domain on file for this institution — check the ID card manually' }, { label: 'Institutional (non-personal) email', ok: true, detail: 'example.org' }, { label: 'File type confirmed by content signature', ok: true, detail: 'PDF' }]), ago(0, 20)]);
  db.run(`INSERT INTO verification_requests (user_id, request_type, document_id, submitted_note, registration_number, auto_checks, created_at) VALUES (?, 'recruiter', ?, ?, ?, ?, ?)`, [danielId, danielProof.id, 'Authorisation letter on company letterhead attached.', 'DEMO-US-EIN-00-0000000',
    JSON.stringify([{ label: 'Email address verified', ok: true, detail: S.pendingRecruiterEmail }, { label: 'Work email (not a personal provider)', ok: true, detail: 'harbourline.example' }, { label: 'Email domain matches organisation website', ok: true, detail: 'harbourline.example ↔ harbourline.example' }, { label: 'Organisation already verified on HORIZON', ok: false, detail: 'Harbourline Signal Analytics' }, { label: 'Company registration number provided', ok: true, detail: 'DEMO-US-EIN-00-0000000' }, { label: 'File type confirmed by content signature', ok: true, detail: 'PDF' }]), ago(1)]);

  // --------------------------------------------------------------- Opportunities
  const oppIds = {};
  const posters = { meridian: meiId, northbank: eleanorId, kestrel: jonasId };
  for (const o of CONTENT.OPPORTUNITIES) {
    const status = o.status || 'published';
    const start = inDays(o.start);
    const end = dateOnly(addDays(new Date(`${start}T00:00:00Z`), o.weeks * 7 - 3));
    const posted = posters[o.org] && o.mode === 'horizon' ? posters[o.org] : adminId;
    const { lastInsertRowid } = db.run(`INSERT INTO opportunities (organisation_id, posted_by, title, summary, description, responsibilities, eligibility, academic_requirements,
      academic_level, eligible_years, required_documents, industry, country, city, work_mode, duration_weeks, start_date, end_date, is_paid, stipend_amount, stipend_currency,
      stipend_usd_monthly, visa_sponsorship, visa_details, relocation_support, accommodation_support, application_deadline, application_mode, application_url, source_name, source_url,
      last_verified_at, no_fee_confirmed, status, is_featured, is_verified, is_demo, published_at, archived_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [orgIds[o.org], posted, o.title, o.summary, o.description, o.responsibilities, o.eligibility, o.academic, o.level, JSON.stringify(o.years), o.documents, o.industry, o.country, o.city,
      o.workMode, o.weeks, start, end, o.paid ? 1 : 0, o.paid ? o.amount : null, o.paid ? o.currency : null, toUsdMonthly(o.paid, o.amount, o.currency), o.visa, o.visaDetails,
      o.relocation || null, o.accommodation || null, inDays(o.deadline), o.mode, o.mode === 'external' ? CONTENT.demoUrl(o.key) : null,
      o.mode === 'external' ? 'Illustrative listing (HORIZON demo)' : 'Posted by verified recruiter', o.mode === 'external' ? CONTENT.demoUrl(o.key) : null,
      status === 'pending_review' ? null : inDays(-Math.floor(Math.random() * 6) - 1), status, o.featured ? 1 : 0, o.verified ? 1 : 0,
      status === 'published' || status === 'archived' ? ago(Math.max(2, 20 - o.deadline / 4)) : null, status === 'archived' ? ago(40) : null, ago(30), ago(status === 'pending_review' ? 1 : 10)]);
    oppIds[o.key] = lastInsertRowid;
    for (const name of o.skills) {
      db.run('INSERT INTO skills (name) VALUES (?) ON CONFLICT(name) DO NOTHING', [name]);
      db.run('INSERT OR IGNORE INTO opportunity_skills (opportunity_id, skill_id) VALUES (?, (SELECT id FROM skills WHERE name = ?))', [lastInsertRowid, name]);
    }
  }
  log(`[seed] ${CONTENT.OPPORTUNITIES.length} illustrative listings across ${new Set(CONTENT.OPPORTUNITIES.map((o) => o.country)).size} countries (all marked DEMO)`);

  // ---------------------------------------------------------------- Applications
  const oppRow = (key) => db.get('SELECT o.title, org.name AS org FROM opportunities o JOIN organisations org ON org.id = o.organisation_id WHERE o.id = ?', [oppIds[key]]);
  function application(a) {
    const o = oppRow(a.opp);
    const id = db.run(`INSERT INTO applications (user_id, opportunity_id, channel, stage, recruiter_status, applied_on, interview_at, personal_deadline, next_action, notes, cover_note,
      cv_document_id, video_document_id, recruiter_message, submitted_at, first_response_at, decided_at, snapshot_title, snapshot_organisation, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [a.user, oppIds[a.opp], a.channel || 'external', a.stage, a.recruiterStatus || null, a.appliedDays != null ? dateOnly(addDays(new Date(), -a.appliedDays)) : null, a.interviewAt || null,
      a.personalDeadline || null, a.nextAction || null, a.notes || null, a.coverNote || null, a.cv || null, a.video || null, a.message || null,
      a.submittedDays != null ? ago(a.submittedDays) : null, a.respondedDays != null ? ago(a.respondedDays) : null, a.decidedDays != null ? ago(a.decidedDays) : null,
      o.title, o.org, ago(a.createdDays || a.submittedDays || a.appliedDays || 5), ago(a.updatedDays || 0)]).lastInsertRowid;
    for (const e of a.events || []) {
      db.run(`INSERT INTO application_events (application_id, actor_id, actor_role, event_type, from_value, to_value, message, visible_to_recruiter, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, e.actor, e.role, e.type, e.from || null, e.to || null, e.message || null, e.visible ? 1 : 0, ago(e.days, e.hours || 0)]);
    }
    return id;
  }
  const interviewAt = toSql(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate() + 4, 5, 0)));
  application({ user: riyaId, opp: 'northbank-ib', channel: 'horizon', stage: 'applied', recruiterStatus: 'under_review', appliedDays: 5, submittedDays: 5, respondedDays: 3, cv: riyaCv.id, video: riyaVideo.id,
    coverNote: 'I would like to learn how mid-market deals are originated and executed. My market-sizing project for ASEAN consumer tech taught me to build models quickly and defend assumptions.',
    message: 'Thanks for applying — your application is with our analyst team. Expect an update within ten days.', updatedDays: 3,
    events: [{ actor: riyaId, role: 'student', type: 'submitted', to: 'applied', message: 'Application submitted on HORIZON with a validated CV and video resume.', visible: true, days: 5 },
      { actor: eleanorId, role: 'recruiter', type: 'recruiter_status', from: 'submitted', to: 'under_review', message: 'Thanks for applying — your application is with our analyst team. Expect an update within ten days.', visible: true, days: 3 }] });
  application({ user: riyaId, opp: 'meridian-strategy', channel: 'horizon', stage: 'interview', recruiterStatus: 'interview', appliedDays: 9, submittedDays: 9, respondedDays: 7, interviewAt, cv: riyaCv.id, video: riyaVideo.id,
    coverNote: 'Your Southeast Asia market-entry work matches what I enjoy most: structuring ambiguous problems and testing them with data.',
    message: 'We would like to invite you to a 45-minute case interview with our Singapore team. A calendar invitation will follow.', updatedDays: 2,
    events: [{ actor: riyaId, role: 'student', type: 'submitted', to: 'applied', message: 'Application submitted on HORIZON with a validated CV and video resume.', visible: true, days: 9 },
      { actor: meiId, role: 'recruiter', type: 'recruiter_status', from: 'submitted', to: 'shortlisted', message: 'You are shortlisted — thank you for a thoughtful cover note.', visible: true, days: 7 },
      { actor: meiId, role: 'recruiter', type: 'recruiter_status', from: 'shortlisted', to: 'interview', message: 'We would like to invite you to a 45-minute case interview with our Singapore team. A calendar invitation will follow.', visible: true, days: 2 }] });
  // Still waiting for a first reply, inside the response window: shows the accountability clock (demo data).
  application({ user: riyaId, opp: 'meridian-analytics', channel: 'horizon', stage: 'applied', recruiterStatus: 'submitted', appliedDays: 4, submittedDays: 4, cv: riyaCv.id,
    coverNote: 'I enjoy turning messy data into a clear story for a client. In my market-sizing project I cleaned three sources in SQL and presented a pricing view to faculty.', updatedDays: 4,
    events: [{ actor: riyaId, role: 'student', type: 'submitted', to: 'applied', message: 'Application submitted on HORIZON with a validated CV.', visible: true, days: 4 }] });
  application({ user: riyaId, opp: 'kestrel-pm', stage: 'preparing', personalDeadline: inDays(10), nextAction: 'Finish the product teardown for the cover note', createdDays: 6, updatedDays: 1,
    events: [{ actor: riyaId, role: 'student', type: 'created', to: 'interested', message: 'Added to your application tracker.', days: 6 }, { actor: riyaId, role: 'student', type: 'stage_changed', from: 'interested', to: 'preparing', days: 1 }] });
  application({ user: riyaId, opp: 'sakura-ops', stage: 'applied', appliedDays: 12, nextAction: 'Follow up with the recruiter if there is no reply by next week', updatedDays: 12,
    events: [{ actor: riyaId, role: 'student', type: 'created', to: 'applied', message: 'Added to your application tracker.', days: 12 }] });
  application({ user: riyaId, opp: 'atlas-policy', stage: 'assessment', appliedDays: 15, personalDeadline: inDays(6), notes: 'Writing test: a 1,500-word policy brief on digital public infrastructure, due in six days.', updatedDays: 2,
    events: [{ actor: riyaId, role: 'student', type: 'created', to: 'applied', message: 'Added to your application tracker.', days: 15 }, { actor: riyaId, role: 'student', type: 'stage_changed', from: 'applied', to: 'assessment', days: 2 }] });
  application({ user: riyaId, opp: 'canal-growth', stage: 'interested', createdDays: 3, updatedDays: 3, events: [{ actor: riyaId, role: 'student', type: 'created', to: 'interested', message: 'Added to your application tracker.', days: 3 }] });
  application({ user: riyaId, opp: 'seine-impact', stage: 'offer', appliedDays: 30, notes: 'Offer letter received. Decide by the end of the month; check the internship agreement process with the IPM office.', updatedDays: 1,
    events: [{ actor: riyaId, role: 'student', type: 'created', to: 'applied', days: 30 }, { actor: riyaId, role: 'student', type: 'stage_changed', from: 'applied', to: 'interview', days: 14 }, { actor: riyaId, role: 'student', type: 'stage_changed', from: 'interview', to: 'offer', days: 1 }] });
  application({ user: riyaId, opp: 'northbank-winter', channel: 'horizon', stage: 'rejected', recruiterStatus: 'not_selected', appliedDays: 70, submittedDays: 70, respondedDays: 60, decidedDays: 52, cv: riyaCv.id,
    message: 'Thank you for your time. This cycle we prioritised candidates with prior banking internships; we would welcome your application to the summer programme.', updatedDays: 52,
    events: [{ actor: riyaId, role: 'student', type: 'submitted', to: 'applied', visible: true, days: 70 }, { actor: eleanorId, role: 'recruiter', type: 'recruiter_status', from: 'submitted', to: 'under_review', visible: true, days: 60 },
      { actor: eleanorId, role: 'recruiter', type: 'recruiter_status', from: 'under_review', to: 'not_selected', message: 'Thank you for your time. This cycle we prioritised candidates with prior banking internships; we would welcome your application to the summer programme.', visible: true, days: 52 }] });
  const arjunApp = application({ user: arjunId, opp: 'meridian-strategy', channel: 'horizon', stage: 'applied', recruiterStatus: 'submitted', appliedDays: 16, submittedDays: 16, cv: arjunCv.id,
    coverNote: 'I enjoy turning engineering problems into business decisions and would love to learn consulting on regional growth projects.', updatedDays: 16,
    events: [{ actor: arjunId, role: 'student', type: 'submitted', to: 'applied', message: 'Application submitted on HORIZON with a validated CV.', visible: true, days: 16 }] });
  application({ user: saraId, opp: 'meridian-analytics', channel: 'horizon', stage: 'applied', recruiterStatus: 'shortlisted', appliedDays: 6, submittedDays: 6, respondedDays: 4, cv: saraCv.id,
    coverNote: 'I have built Tableau dashboards for a campus analytics club and want to apply them to real client problems.', message: 'You are shortlisted — expect an online assessment invitation this week.', updatedDays: 4,
    events: [{ actor: saraId, role: 'student', type: 'submitted', to: 'applied', visible: true, days: 6 }, { actor: meiId, role: 'recruiter', type: 'recruiter_status', from: 'submitted', to: 'shortlisted', message: 'You are shortlisted — expect an online assessment invitation this week.', visible: true, days: 4 }] });

  for (const key of ['kestrel-ml', 'harbourline-data', 'lumen-health', 'hanriver-robotics', 'gulfline-founders', 'meridian-analytics']) {
    db.run('INSERT INTO saved_opportunities (user_id, opportunity_id, created_at) VALUES (?, ?, ?)', [riyaId, oppIds[key], ago(Math.floor(Math.random() * 10) + 1)]);
  }

  // ---------------------------------------------------------------- Destinations
  seedDestinations(db, adminId);

  // ------------------------------------------------------------------ Grievances
  const G = require('../services/grievances');
  function grievance(g) {
    const created = new Date(Date.now() - g.createdHours * 3600 * 1000);
    const due = G.dueDates(g.priority, created);
    const id = db.run(`INSERT INTO grievances (complainant_id, guest_name, guest_email, access_key_hash, category, subject, description, against_type, against_id, against_label, respondent_org_id,
      priority, status, level, is_anonymous, shared_with_respondent, assigned_to, ack_due_at, resolution_due_at, response_due_at, acknowledged_at, resolved_at, closed_at, resolution_summary,
      satisfaction_rating, satisfaction_comment, is_demo, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    [g.user || null, g.guestName || null, g.guestEmail || null, g.accessKey ? sha256(g.accessKey) : null, g.category, g.subject, g.description, g.againstType || 'platform', g.againstId || null,
      g.againstLabel || 'HORIZON platform', g.respondentOrg || null, g.priority, g.status, g.shared ? 1 : 0, g.assigned || null, due.ack_due_at, due.resolution_due_at,
      g.shared ? toSql(addDays(new Date(), 4)) : null, g.ackHours != null ? toSql(addHours(created, g.ackHours)) : null, g.resolvedHours != null ? toSql(addHours(created, g.resolvedHours)) : null,
      g.closedHours != null ? toSql(addHours(created, g.closedHours)) : null, g.resolution || null, g.rating || null, g.ratingComment || null, toSql(created), toSql(new Date())]).lastInsertRowid;
    db.run('UPDATE grievances SET ticket_no = ? WHERE id = ?', [G.ticketNo(id, toSql(created)), id]);
    for (const e of g.events) {
      db.run('INSERT INTO grievance_events (grievance_id, actor_id, actor_role, event_type, visibility, from_status, to_status, message, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [id, e.actor || null, e.role, e.type, e.visibility || 'complainant', e.from || null, e.to || null, e.message || null, toSql(addHours(created, e.atHours))]);
    }
    return id;
  }
  const receipt = (h = 0) => ({ role: 'system', type: 'receipt', atHours: h, message: 'Your grievance was received. A person from the grievance desk will acknowledge it within 24 hours.' });
  const canal = db.get('SELECT o.id, o.title, org.name FROM opportunities o JOIN organisations org ON org.id = o.organisation_id WHERE o.id = ?', [oppIds['canal-growth']]);
  grievance({ user: riyaId, category: 'offer_mismatch', priority: 'high', status: 'closed', createdHours: 18 * 24, ackHours: 3, resolvedHours: 4 * 24, closedHours: 5 * 24, assigned: adminId,
    subject: 'Listing says paid, employer page says unpaid', description: 'The Growth Marketing Intern listing shows a monthly stipend, but the careers page linked from it says the role is unpaid. Which is correct?',
    againstType: 'opportunity', againstId: canal.id, againstLabel: `${canal.name} — ${canal.title}`, respondentOrg: orgIds.canal,
    resolution: 'We re-checked the listing against the employer’s source page. The stipend is correct; the older careers page was outdated. We updated the listing’s “last verified” date.', rating: 4, ratingComment: 'Quick and clear, thank you.',
    events: [{ actor: riyaId, role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0), { actor: adminId, role: 'admin', type: 'acknowledged', atHours: 3, message: 'Your grievance has been acknowledged by the grievance desk.' },
      { actor: adminId, role: 'admin', type: 'status_changed', from: 'acknowledged', to: 'under_review', atHours: 3.2, message: 'We are checking the listing against the employer’s source.' },
      { actor: adminId, role: 'admin', type: 'internal_note', visibility: 'internal', atHours: 30, message: 'Source page cached version shows the stipend; public page outdated. No action against employer needed.' },
      { actor: adminId, role: 'admin', type: 'status_changed', from: 'under_review', to: 'resolved', atHours: 96, message: 'We re-checked the listing against the employer’s source page. The stipend is correct; the older careers page was outdated. We updated the listing’s “last verified” date.' },
      { actor: riyaId, role: 'complainant', type: 'feedback', from: 'resolved', to: 'closed', atHours: 120, message: 'Rated the resolution 4/5. “Quick and clear, thank you.”' }] });
  grievance({ user: riyaId, category: 'fee_demand', priority: 'urgent', status: 'under_review', createdHours: 26, ackHours: 2, assigned: adminId,
    subject: 'WhatsApp message asking me to pay a “training fee”', description: 'After I applied to Meridian Arc on HORIZON, someone on WhatsApp claiming to be from their HR team asked me to pay ₹2,500 for “mandatory pre-joining training”. I have not paid.',
    againstType: 'organisation', againstId: orgIds.meridian, againstLabel: 'Meridian Arc Consulting', respondentOrg: orgIds.meridian,
    events: [{ actor: riyaId, role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0), { actor: adminId, role: 'admin', type: 'acknowledged', atHours: 2, message: 'Your grievance has been acknowledged by the grievance desk.' },
      { actor: adminId, role: 'admin', type: 'status_changed', from: 'submitted', to: 'under_review', atHours: 2.1, message: 'Thank you for reporting this. HORIZON never charges students, and verified recruiters may not ask for payment. Please do not pay. We are investigating with the organisation. If you have lost money, report it at cybercrime.gov.in or call 1930.' },
      { actor: adminId, role: 'admin', type: 'internal_note', visibility: 'internal', atHours: 5, message: 'Meridian’s verified recruiter (Mei Lin Tan) confirms no WhatsApp outreach. Likely impersonation. Preparing a scam alert banner for Meridian listings.' }] });
  grievance({ guestName: 'Ananya S.', guestEmail: 'ananya.guest@example.org', accessKey: 'DEMO-GRV0-KEY1', category: 'privacy', priority: 'high', status: 'submitted', createdHours: 5,
    subject: 'Please delete my data from an old registration', description: 'I registered last year with a personal email by mistake and never completed verification. Please delete my account data.',
    events: [{ role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0)] });
  grievance({ user: arjunId, category: 'no_response', priority: 'normal', status: 'awaiting_response', createdHours: 22, ackHours: 4, assigned: adminId, shared: true,
    subject: 'No update 16 days after applying', description: 'I applied to the Strategy Consulting Summer Intern role on HORIZON 16 days ago and have not received any update. HORIZON says recruiters respond within 14 days.',
    againstType: 'opportunity', againstId: oppIds['meridian-strategy'], againstLabel: 'Meridian Arc Consulting — Strategy Consulting Summer Intern', respondentOrg: orgIds.meridian,
    events: [{ actor: arjunId, role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0), { actor: adminId, role: 'admin', type: 'acknowledged', atHours: 4, message: 'Your grievance has been acknowledged by the grievance desk.' },
      { actor: adminId, role: 'admin', type: 'response_requested', visibility: 'parties', from: 'acknowledged', to: 'awaiting_response', atHours: 4.2, message: 'The application has passed the 14-day response window. The grievance desk has asked Meridian Arc Consulting to respond within 5 days.' }] });
  grievance({ user: meiId, category: 'technical', priority: 'normal', status: 'closed', createdHours: 12 * 24, ackHours: 6, resolvedHours: 2 * 24, closedHours: 3 * 24, assigned: adminId,
    subject: 'Applicant CV preview not loading in Safari', description: 'Opening an applicant’s CV in Safari shows a blank page; it works in Chrome.',
    resolution: 'Fixed: CVs now open with the correct content headers in Safari. Thank you for reporting it.', rating: 5,
    events: [{ actor: meiId, role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0), { actor: adminId, role: 'admin', type: 'acknowledged', atHours: 6, message: 'Your grievance has been acknowledged by the grievance desk.' },
      { actor: adminId, role: 'admin', type: 'status_changed', from: 'acknowledged', to: 'resolved', atHours: 48, message: 'Fixed: CVs now open with the correct content headers in Safari. Thank you for reporting it.' },
      { actor: meiId, role: 'complainant', type: 'feedback', from: 'resolved', to: 'closed', atHours: 72, message: 'Rated the resolution 5/5.' }] });
  grievance({ user: saraId, category: 'verification', priority: 'normal', status: 'closed', createdHours: 30 * 24, ackHours: 9, resolvedHours: 26, closedHours: 40, assigned: adminId,
    subject: 'My NIT Trichy email was not recognised', description: 'Registration said my email domain is not verified for NIT Tiruchirappalli.',
    resolution: 'We verified nitt.edu against the institute’s official website and added it. Your account was approved automatically after email confirmation.', rating: 5,
    events: [{ actor: saraId, role: 'complainant', type: 'submitted', to: 'submitted', atHours: 0 }, receipt(0), { actor: adminId, role: 'admin', type: 'acknowledged', atHours: 9, message: 'Your grievance has been acknowledged by the grievance desk.' },
      { actor: adminId, role: 'admin', type: 'status_changed', from: 'acknowledged', to: 'resolved', atHours: 26, message: 'We verified nitt.edu against the institute’s official website and added it. Your account was approved automatically after email confirmation.' },
      { actor: saraId, role: 'complainant', type: 'feedback', from: 'resolved', to: 'closed', atHours: 40, message: 'Rated the resolution 5/5.' }] });

  // --------------------------------------------------------------- Notifications
  const n = (userId, type, title, body, link, days, read = false) => db.run('INSERT INTO notifications (user_id, type, title, body, link, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [userId, type, title, body, link, read ? ago(days - 0.1) : null, ago(days)]);
  n(riyaId, 'verification', 'You are verified', 'Your IIM Indore email confirmed your enrolment. Welcome to HORIZON.', '/app', 45, true);
  n(riyaId, 'document', 'Your CV is HORIZON-verified', 'Checked against institutional records (demo).', '/app/profile', 18, true);
  n(riyaId, 'application', 'Northbank Ridge Capital: Under review', 'Your application is with our analyst team.', '/app/applications', 3);
  n(riyaId, 'application', 'Strategy Consulting Summer Intern: Interview invitation', 'We would like to invite you to a 45-minute case interview with our Singapore team.', '/app/applications', 2);
  n(meiId, 'grievance', 'Response requested on a grievance', 'No update 16 days after applying', '/recruiter/grievances', 0.8);
  n(meiId, 'applicant', 'New applicant: Arjun Nair', 'Strategy Consulting Summer Intern', `/recruiter/applications/${arjunApp}`, 16, true);
  n(adminId, 'verification', 'New student verification request', 'Kabir Menon submitted proof for review.', '/admin/verifications', 0.8);
  n(adminId, 'verification', 'New recruiter verification request', 'Daniel Brooks submitted proof for review.', '/admin/verifications', 1);

  db.run("INSERT INTO audit_logs (actor_id, actor_role, action, details) VALUES (NULL, 'system', 'seed.loaded', ?)", [JSON.stringify({ at: nowSql(), demo: true })]);
  log('[seed] demo accounts, applications, grievances and destination guides loaded');
}

module.exports = { seed };

if (require.main === module) {
  (async () => {
    const reset = process.argv.includes('--reset');
    if (config.isProd) { console.error('Refusing to seed demo data when NODE_ENV=production.'); process.exit(1); }
    if (reset) {
      for (const f of [config.databaseFile, `${config.databaseFile}-wal`, `${config.databaseFile}-shm`]) fs.rmSync(f, { force: true });
      fs.rmSync(config.storageDir, { recursive: true, force: true });
      console.log('[seed] removed existing database and private uploads');
    }
    const { getDb, closeDb } = require('./index');
    const { migrate } = require('./migrate');
    const db = getDb();
    migrate(db);
    if (db.value('SELECT COUNT(*) FROM users')) {
      console.log('[seed] database already contains users — nothing to do. Use "npm run db:reset" to start fresh.');
    } else {
      await seed(db);
      console.log(`[seed] done → ${config.databaseFile}`);
    }
    closeDb();
  })().catch((err) => { console.error('[seed] failed:', err); process.exit(1); });
}
