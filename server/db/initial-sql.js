'use strict';
module.exports = `-- HORIZON initial schema.
-- Timestamps: UTC text 'YYYY-MM-DD HH:MM:SS'. Calendar dates: 'YYYY-MM-DD'.
-- List-like fields (skills, preferences) are JSON arrays stored as TEXT.

CREATE TABLE institutions (
  id                     INTEGER PRIMARY KEY,
  name                   TEXT NOT NULL UNIQUE COLLATE NOCASE,
  short_name             TEXT,
  category               TEXT NOT NULL,
  city                   TEXT,
  state                  TEXT,
  official_website       TEXT,
  recognition_reference  TEXT NOT NULL,             -- e.g. "Indian Institutes of Management Act, 2017"
  recognition_source_url TEXT,                      -- official list / gazette used to verify INI status
  verification_status    TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified')),
  verification_note      TEXT,
  is_active              INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0,1)),
  verified_at            TEXT,
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (verification_status <> 'verified' OR recognition_source_url IS NOT NULL)
);
CREATE INDEX idx_institutions_status ON institutions (verification_status, is_active);
CREATE INDEX idx_institutions_category ON institutions (category);

CREATE TABLE institution_domains (
  id             INTEGER PRIMARY KEY,
  institution_id INTEGER NOT NULL REFERENCES institutions(id) ON DELETE CASCADE,
  domain         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  is_verified    INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_institution_domains_inst ON institution_domains (institution_id);

CREATE TABLE organisations (
  id                  INTEGER PRIMARY KEY,
  name                TEXT NOT NULL,
  org_type            TEXT NOT NULL,
  website             TEXT,
  email_domain        TEXT COLLATE NOCASE,
  country             TEXT,
  headquarters        TEXT,
  description         TEXT,
  linkedin_url        TEXT,
  registration_number TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unverified' CHECK (verification_status IN ('verified','unverified','rejected')),
  verified_at         TEXT,
  is_demo             INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_organisations_name ON organisations (name COLLATE NOCASE);
CREATE INDEX idx_organisations_domain ON organisations (email_domain);

CREATE TABLE users (
  id                  INTEGER PRIMARY KEY,
  role                TEXT NOT NULL CHECK (role IN ('student','recruiter','admin')),
  full_name           TEXT NOT NULL,
  email               TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash       TEXT NOT NULL,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','suspended')),
  status_reason       TEXT,
  email_verified_at   TEXT,
  verification_method TEXT CHECK (verification_method IS NULL OR verification_method IN ('email_domain','manual','seed')),
  institution_id      INTEGER REFERENCES institutions(id),
  organisation_id     INTEGER REFERENCES organisations(id),
  failed_logins       INTEGER NOT NULL DEFAULT 0,
  locked_until        TEXT,
  last_login_at       TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (role <> 'student' OR institution_id IS NOT NULL),
  CHECK (role <> 'recruiter' OR organisation_id IS NOT NULL)
);
CREATE INDEX idx_users_role_status ON users (role, status);
CREATE INDEX idx_users_institution ON users (institution_id);
CREATE INDEX idx_users_organisation ON users (organisation_id);
CREATE INDEX idx_users_name ON users (full_name COLLATE NOCASE);

CREATE TABLE student_profiles (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  programme            TEXT NOT NULL,
  academic_level       TEXT NOT NULL DEFAULT 'undergraduate' CHECK (academic_level IN ('undergraduate','postgraduate','doctoral')),
  current_year         INTEGER NOT NULL CHECK (current_year BETWEEN 1 AND 6),
  graduation_year      INTEGER NOT NULL CHECK (graduation_year BETWEEN 2000 AND 2100),
  academic_interests   TEXT NOT NULL DEFAULT '[]',
  specialisation       TEXT,
  skills               TEXT NOT NULL DEFAULT '[]',
  languages            TEXT NOT NULL DEFAULT '[]',
  preferred_countries  TEXT NOT NULL DEFAULT '[]',
  preferred_industries TEXT NOT NULL DEFAULT '[]',
  experience           TEXT,
  linkedin_url         TEXT,
  portfolio_url        TEXT,
  github_url           TEXT,
  bio                  TEXT,
  updated_at           TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE recruiter_profiles (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  designation  TEXT NOT NULL,
  bio          TEXT,
  linkedin_url TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Private files (CVs, video resumes, verification proofs, grievance evidence). Never served publicly.
CREATE TABLE documents (
  id                      INTEGER PRIMARY KEY,
  user_id                 INTEGER REFERENCES users(id) ON DELETE CASCADE,
  kind                    TEXT NOT NULL CHECK (kind IN ('cv','video','id_proof','org_proof','grievance_evidence')),
  original_name           TEXT NOT NULL,
  stored_name             TEXT NOT NULL UNIQUE,
  mime_type               TEXT NOT NULL,
  size_bytes              INTEGER NOT NULL,
  sha256                  TEXT NOT NULL,
  review_status           TEXT NOT NULL DEFAULT 'submitted'
                          CHECK (review_status IN ('submitted','auto_verified','flagged','verified','changes_requested','pending_review','approved','rejected')),
  validation_report       TEXT,
  meta                    TEXT,
  review_note             TEXT,
  reviewed_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at             TEXT,
  manual_review_requested INTEGER NOT NULL DEFAULT 0,
  is_current              INTEGER NOT NULL DEFAULT 1,
  created_at              TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_documents_owner ON documents (user_id, kind, is_current);
CREATE INDEX idx_documents_review ON documents (kind, review_status);
CREATE INDEX idx_documents_sha ON documents (sha256);

CREATE TABLE verification_requests (
  id             INTEGER PRIMARY KEY,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  request_type   TEXT NOT NULL CHECK (request_type IN ('student','recruiter')),
  document_id    INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  submitted_note TEXT,
  registration_number TEXT,
  auto_checks    TEXT NOT NULL DEFAULT '[]',
  status         TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewer_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  internal_note  TEXT,
  user_message   TEXT,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  reviewed_at    TEXT
);
CREATE INDEX idx_verification_status ON verification_requests (status, request_type);
CREATE INDEX idx_verification_user ON verification_requests (user_id);

CREATE TABLE skills (
  id   INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE
);

CREATE TABLE opportunities (
  id                    INTEGER PRIMARY KEY,
  organisation_id       INTEGER NOT NULL REFERENCES organisations(id),
  posted_by             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  title                 TEXT NOT NULL,
  summary               TEXT NOT NULL,
  description           TEXT NOT NULL,
  responsibilities      TEXT,
  eligibility           TEXT,
  academic_requirements TEXT,
  academic_level        TEXT NOT NULL DEFAULT 'any' CHECK (academic_level IN ('any','undergraduate','postgraduate','doctoral')),
  eligible_years        TEXT NOT NULL DEFAULT '[]',
  required_documents    TEXT,
  industry              TEXT NOT NULL,
  country               TEXT NOT NULL,
  city                  TEXT NOT NULL,
  work_mode             TEXT NOT NULL CHECK (work_mode IN ('onsite','hybrid','remote')),
  duration_weeks        INTEGER NOT NULL CHECK (duration_weeks BETWEEN 1 AND 104),
  start_date            TEXT,
  end_date              TEXT,
  is_paid               INTEGER NOT NULL CHECK (is_paid IN (0,1)),
  stipend_amount        REAL,
  stipend_currency      TEXT,
  stipend_usd_monthly   REAL,                       -- indicative, for sorting/range filters only
  visa_sponsorship      TEXT NOT NULL CHECK (visa_sponsorship IN ('yes','no','not_required','case_by_case')),
  visa_details          TEXT,
  relocation_support    TEXT,
  accommodation_support TEXT,
  application_deadline  TEXT NOT NULL,
  application_mode      TEXT NOT NULL DEFAULT 'external' CHECK (application_mode IN ('external','horizon')),
  application_url       TEXT,
  source_name           TEXT,
  source_url            TEXT,
  last_verified_at      TEXT,
  no_fee_confirmed      INTEGER NOT NULL DEFAULT 0 CHECK (no_fee_confirmed IN (0,1)),
  status                TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_review','published','rejected','archived')),
  review_note           TEXT,
  is_featured           INTEGER NOT NULL DEFAULT 0 CHECK (is_featured IN (0,1)),
  is_verified           INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0,1)),
  is_demo               INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  published_at          TEXT,
  archived_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (is_paid = 0 OR (stipend_amount IS NOT NULL AND stipend_currency IS NOT NULL)),
  CHECK (application_mode = 'horizon' OR application_url IS NOT NULL)
);
CREATE INDEX idx_opportunities_status_deadline ON opportunities (status, application_deadline);
CREATE INDEX idx_opportunities_country ON opportunities (country);
CREATE INDEX idx_opportunities_industry ON opportunities (industry);
CREATE INDEX idx_opportunities_org ON opportunities (organisation_id);
CREATE INDEX idx_opportunities_published ON opportunities (published_at);
CREATE INDEX idx_opportunities_comp ON opportunities (stipend_usd_monthly);
CREATE INDEX idx_opportunities_title ON opportunities (title COLLATE NOCASE);

CREATE TABLE opportunity_skills (
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  skill_id       INTEGER NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  PRIMARY KEY (opportunity_id, skill_id)
);
CREATE INDEX idx_opportunity_skills_skill ON opportunity_skills (skill_id);

CREATE TABLE saved_opportunities (
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (user_id, opportunity_id)
);

-- Opportunities with applications are archived, never hard-deleted (ON DELETE RESTRICT),
-- and each application keeps a title/organisation snapshot so history stays readable.
CREATE TABLE applications (
  id                    INTEGER PRIMARY KEY,
  user_id               INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  opportunity_id        INTEGER NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  channel               TEXT NOT NULL DEFAULT 'external' CHECK (channel IN ('external','horizon')),
  stage                 TEXT NOT NULL DEFAULT 'interested'
                        CHECK (stage IN ('interested','preparing','applied','assessment','interview','offer','rejected','withdrawn')),
  recruiter_status      TEXT CHECK (recruiter_status IS NULL OR recruiter_status IN ('submitted','under_review','shortlisted','assessment','interview','offer','not_selected')),
  applied_on            TEXT,
  interview_at          TEXT,
  personal_deadline     TEXT,
  next_action           TEXT,
  notes                 TEXT,
  cover_note            TEXT,
  cv_document_id        INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  video_document_id     INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  recruiter_message     TEXT,
  recruiter_notes       TEXT,
  submitted_at          TEXT,
  first_response_at     TEXT,
  decided_at            TEXT,
  snapshot_title        TEXT NOT NULL,
  snapshot_organisation TEXT NOT NULL,
  created_at            TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at            TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, opportunity_id)
);
CREATE INDEX idx_applications_user_stage ON applications (user_id, stage);
CREATE INDEX idx_applications_opportunity ON applications (opportunity_id, channel);

CREATE TABLE application_events (
  id                   INTEGER PRIMARY KEY,
  application_id       INTEGER NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  actor_id             INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role           TEXT NOT NULL,
  event_type           TEXT NOT NULL,
  from_value           TEXT,
  to_value             TEXT,
  message              TEXT,
  visible_to_recruiter INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_application_events_app ON application_events (application_id, created_at);

CREATE TABLE destination_resources (
  id                        INTEGER PRIMARY KEY,
  country                   TEXT NOT NULL UNIQUE,
  slug                      TEXT NOT NULL UNIQUE,
  region                    TEXT,
  overview                  TEXT NOT NULL,
  major_sectors             TEXT NOT NULL DEFAULT '[]',
  common_durations          TEXT,
  work_arrangements         TEXT,
  visa_resources            TEXT NOT NULL DEFAULT '[]',
  official_links            TEXT NOT NULL DEFAULT '[]',
  relocation_considerations TEXT,
  source_url                TEXT NOT NULL,
  last_updated              TEXT NOT NULL,
  is_published              INTEGER NOT NULL DEFAULT 1 CHECK (is_published IN (0,1)),
  updated_by                INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at                TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at                TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE grievances (
  id                     INTEGER PRIMARY KEY,
  ticket_no              TEXT UNIQUE,
  complainant_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,
  guest_name             TEXT,
  guest_email            TEXT,
  access_key_hash        TEXT,
  category               TEXT NOT NULL,
  subject                TEXT NOT NULL,
  description            TEXT NOT NULL,
  against_type           TEXT NOT NULL DEFAULT 'platform' CHECK (against_type IN ('platform','opportunity','organisation','user')),
  against_id             INTEGER,
  against_label          TEXT,
  respondent_org_id      INTEGER REFERENCES organisations(id) ON DELETE SET NULL,
  priority               TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high','urgent')),
  status                 TEXT NOT NULL DEFAULT 'submitted'
                         CHECK (status IN ('submitted','acknowledged','under_review','awaiting_response','resolved','rejected','closed')),
  level                  INTEGER NOT NULL DEFAULT 1 CHECK (level IN (1,2)),
  is_anonymous           INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0,1)),
  shared_with_respondent INTEGER NOT NULL DEFAULT 0 CHECK (shared_with_respondent IN (0,1)),
  evidence_document_id   INTEGER REFERENCES documents(id) ON DELETE SET NULL,
  assigned_to            INTEGER REFERENCES users(id) ON DELETE SET NULL,
  ack_due_at             TEXT NOT NULL,
  resolution_due_at      TEXT NOT NULL,
  response_due_at        TEXT,
  acknowledged_at        TEXT,
  resolved_at            TEXT,
  closed_at              TEXT,
  escalated_at           TEXT,
  resolution_summary     TEXT,
  satisfaction_rating    INTEGER CHECK (satisfaction_rating IS NULL OR satisfaction_rating BETWEEN 1 AND 5),
  satisfaction_comment   TEXT,
  is_demo                INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0,1)),
  created_at             TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at             TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (complainant_id IS NOT NULL OR guest_email IS NOT NULL)
);
CREATE INDEX idx_grievances_status ON grievances (status, priority);
CREATE INDEX idx_grievances_complainant ON grievances (complainant_id);
CREATE INDEX idx_grievances_respondent ON grievances (respondent_org_id);
CREATE INDEX idx_grievances_created ON grievances (created_at);

-- visibility: 'parties' = complainant + admin + respondent (when shared); 'complainant' = complainant + admin; 'internal' = admin only
CREATE TABLE grievance_events (
  id           INTEGER PRIMARY KEY,
  grievance_id INTEGER NOT NULL REFERENCES grievances(id) ON DELETE CASCADE,
  actor_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role   TEXT NOT NULL,
  event_type   TEXT NOT NULL,
  visibility   TEXT NOT NULL DEFAULT 'complainant' CHECK (visibility IN ('parties','complainant','internal')),
  from_status  TEXT,
  to_status    TEXT,
  message      TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_grievance_events_grievance ON grievance_events (grievance_id, created_at);

CREATE TABLE notifications (
  id         INTEGER PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT,
  link       TEXT,
  read_at    TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_notifications_user ON notifications (user_id, read_at);

CREATE TABLE email_verifications (
  id          INTEGER PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash   TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  attempts    INTEGER NOT NULL DEFAULT 0,
  consumed_at TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_verifications_user ON email_verifications (user_id);

CREATE TABLE email_outbox (
  id         INTEGER PRIMARY KEY,
  to_email   TEXT NOT NULL,
  subject    TEXT NOT NULL,
  body       TEXT,
  status     TEXT NOT NULL CHECK (status IN ('logged','sent','failed')),
  error      TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_email_outbox_to ON email_outbox (to_email, created_at);

CREATE TABLE audit_logs (
  id          INTEGER PRIMARY KEY,
  actor_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
  actor_role  TEXT,
  action      TEXT NOT NULL,
  entity_type TEXT,
  entity_id   INTEGER,
  details     TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_audit_logs_created ON audit_logs (created_at);
CREATE INDEX idx_audit_logs_entity ON audit_logs (entity_type, entity_id);
CREATE INDEX idx_audit_logs_action ON audit_logs (action);

CREATE TABLE sessions (
  sid     TEXT PRIMARY KEY,
  sess    TEXT NOT NULL,
  user_id INTEGER,
  expires INTEGER NOT NULL
);
CREATE INDEX idx_sessions_expires ON sessions (expires);
CREATE INDEX idx_sessions_user ON sessions (user_id);
`;

