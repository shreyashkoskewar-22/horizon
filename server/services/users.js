'use strict';
const { getDb } = require('../db');
const { parseJsonArray, parseJson, domainMatches, emailDomain } = require('../lib/util');

const homeFor = (u) => (u.role === 'admin' ? '/admin' : u.role === 'recruiter' ? '/recruiter' : '/app');
const isFullyApproved = (u) => u.status === 'approved' && (u.role === 'admin' || !!u.email_verified_at);
const nextFor = (u) => (isFullyApproved(u) ? homeFor(u) : '/verify');

function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id,
    role: u.role,
    fullName: u.full_name,
    firstName: String(u.full_name).split(' ')[0],
    email: u.email,
    status: u.status,
    statusReason: u.status_reason || null,
    emailVerified: !!u.email_verified_at,
    verificationMethod: u.verification_method || null,
    institution: u.institution_id ? { id: u.institution_id, name: u.institution_name, shortName: u.institution_short } : null,
    organisation: u.organisation_id ? { id: u.organisation_id, name: u.organisation_name, verified: u.organisation_status === 'verified' } : null,
    createdAt: u.created_at,
  };
}

/** Finds the verified institution that owns an email domain (longest match wins). */
function institutionForEmail(email) {
  const domain = emailDomain(email);
  const rows = getDb().all(`
    SELECT d.domain, d.institution_id, i.name FROM institution_domains d
    JOIN institutions i ON i.id = d.institution_id
    WHERE d.is_verified = 1 AND i.is_active = 1 AND i.verification_status = 'verified'`);
  const hits = rows.filter((r) => domainMatches(domain, r.domain.toLowerCase())).sort((a, b) => b.domain.length - a.domain.length);
  return hits[0] || null;
}

function verificationState(u) {
  const db = getDb();
  const last = db.get('SELECT * FROM verification_requests WHERE user_id = ? ORDER BY id DESC LIMIT 1', [u.id]);
  const pending = last && last.status === 'pending' ? last : null;
  const domainHit = u.role === 'student' ? institutionForEmail(u.email) : null;
  const domainMatched = !!(domainHit && domainHit.institution_id === u.institution_id);
  return {
    status: u.status,
    statusReason: u.status_reason || null,
    emailVerified: !!u.email_verified_at,
    needsEmail: u.role !== 'admin' && !u.email_verified_at,
    needsProof: u.role !== 'admin' && !!u.email_verified_at && ['pending', 'rejected'].includes(u.status) && !pending,
    domainMatched,
    requestType: u.role === 'recruiter' ? 'recruiter' : 'student',
    pendingRequest: pending ? { id: pending.id, createdAt: pending.created_at } : null,
    lastDecision: last && last.status !== 'pending' ? { status: last.status, message: last.user_message, reviewedAt: last.reviewed_at } : null,
  };
}

function currentDocument(userId, kind) {
  return getDb().get('SELECT * FROM documents WHERE user_id = ? AND kind = ? AND is_current = 1 ORDER BY id DESC LIMIT 1', [userId, kind]);
}

function documentSummary(doc) {
  if (!doc) return null;
  return {
    id: doc.id,
    kind: doc.kind,
    originalName: doc.original_name,
    sizeBytes: doc.size_bytes,
    mimeType: doc.mime_type,
    status: doc.review_status,
    report: parseJson(doc.validation_report),
    meta: parseJson(doc.meta, {}),
    reviewNote: doc.review_note,
    reviewedAt: doc.reviewed_at,
    manualReviewRequested: !!doc.manual_review_requested,
    createdAt: doc.created_at,
    url: `/api/documents/${doc.id}/file`,
  };
}

function studentProfileRow(userId) {
  const p = getDb().get('SELECT * FROM student_profiles WHERE user_id = ?', [userId]);
  if (!p) return null;
  return {
    programme: p.programme,
    academicLevel: p.academic_level,
    currentYear: p.current_year,
    graduationYear: p.graduation_year,
    academicInterests: parseJsonArray(p.academic_interests),
    specialisation: p.specialisation,
    skills: parseJsonArray(p.skills),
    languages: parseJsonArray(p.languages),
    preferredCountries: parseJsonArray(p.preferred_countries),
    preferredIndustries: parseJsonArray(p.preferred_industries),
    experience: p.experience,
    linkedinUrl: p.linkedin_url,
    portfolioUrl: p.portfolio_url,
    githubUrl: p.github_url,
    bio: p.bio,
    updatedAt: p.updated_at,
  };
}

function profileCompletion(profile, cv, video) {
  if (!profile) return { percent: 0, missing: [] };
  const items = [
    ['Short professional introduction', !!profile.bio],
    ['Academic interests', profile.academicInterests.length > 0],
    ['Area of specialisation', !!profile.specialisation],
    ['At least three skills', profile.skills.length >= 3],
    ['Languages known', profile.languages.length > 0],
    ['Preferred countries', profile.preferredCountries.length > 0],
    ['Preferred industries', profile.preferredIndustries.length > 0],
    ['Previous experience', !!profile.experience],
    ['LinkedIn profile', !!profile.linkedinUrl],
    ['Portfolio or GitHub link', !!(profile.portfolioUrl || profile.githubUrl)],
    ['Validated CV (PDF)', !!cv && ['auto_verified', 'verified'].includes(cv.review_status)],
    ['Video resume', !!video && video.review_status !== 'rejected'],
  ];
  const done = items.filter(([, ok]) => ok).length + 1; // programme/year are always present
  return { percent: Math.round((done / (items.length + 1)) * 100), missing: items.filter(([, ok]) => !ok).map(([label]) => label) };
}

function recruiterProfileRow(userId) {
  const p = getDb().get('SELECT * FROM recruiter_profiles WHERE user_id = ?', [userId]);
  return p ? { designation: p.designation, bio: p.bio, linkedinUrl: p.linkedin_url, updatedAt: p.updated_at } : null;
}

module.exports = {
  homeFor, nextFor, isFullyApproved, publicUser, institutionForEmail, verificationState, currentDocument, documentSummary,
  studentProfileRow, profileCompletion, recruiterProfileRow,
};
