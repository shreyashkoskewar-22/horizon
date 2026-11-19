/** Consistent date, currency and label formatting across the product (en-GB conventions). */
const LOCALE = 'en-GB';

export function parseDate(s) {
  if (!s) return null;
  if (s instanceof Date) return s;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00`);
  return new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`);
}
export const fmtDate = (s, opts = {}) => { const d = parseDate(s); return d && !Number.isNaN(d.getTime()) ? d.toLocaleDateString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', ...opts }) : '—'; };
export const fmtShort = (s) => fmtDate(s, { year: undefined });
export const fmtDateTime = (s) => { const d = parseDate(s); return d ? d.toLocaleString(LOCALE, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
export const fmtTime = (s) => { const d = parseDate(s); return d ? d.toLocaleTimeString(LOCALE, { hour: '2-digit', minute: '2-digit' }) : ''; };

export function timeAgo(s) {
  const d = parseDate(s);
  if (!d) return '';
  const sec = Math.round((Date.now() - d.getTime()) / 1000);
  if (sec < 0) return fmtDate(s);
  if (sec < 60) return 'just now';
  if (sec < 3600) return `${Math.floor(sec / 60)} min ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)} h ago`;
  if (sec < 86400 * 7) { const n = Math.floor(sec / 86400); return `${n} day${n === 1 ? '' : 's'} ago`; }
  return fmtDate(s);
}

/** "Today", "Yesterday" or "Earlier" — used to group notifications. */
export function dayGroup(s) {
  const d = parseDate(s);
  if (!d) return 'Earlier';
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const day = new Date(d); day.setHours(0, 0, 0, 0);
  const diff = Math.round((today - day) / 86400000);
  return diff <= 0 ? 'Today' : diff === 1 ? 'Yesterday' : 'Earlier';
}

/** "in 3 days", "tomorrow", "today", "2 days ago" for a date or date-time. */
export function relativeDay(s) {
  const n = daysUntil(s);
  if (n == null) return '';
  if (n === 0) return 'today';
  if (n === 1) return 'tomorrow';
  if (n === -1) return 'yesterday';
  return n > 0 ? `in ${n} days` : `${-n} days ago`;
}

export function daysUntil(s) {
  const d = parseDate(s);
  if (!d) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const target = new Date(d); target.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000);
}

export function deadlineLabel(s) {
  const n = daysUntil(s);
  if (n == null) return '';
  if (n < 0) return 'Applications closed';
  if (n === 0) return 'Closes today';
  if (n === 1) return 'Closes tomorrow';
  if (n <= 14) return `${n} days left`;
  return `Apply by ${fmtShort(s)}`;
}

export function daysLeft(s) {
  const n = daysUntil(s);
  if (n == null) return '';
  if (n < 0) return 'Closed';
  if (n === 0) return 'Closes today';
  if (n === 1) return '1 day left';
  return `${n} days left`;
}

export function hoursLabel(h) {
  if (h == null) return '';
  const a = Math.abs(h);
  const txt = a >= 48 ? `${Math.round(a / 24)} days` : `${a} h`;
  return h >= 0 ? `${txt} left` : `${txt} overdue`;
}

export function money(amount, currency) {
  if (amount == null) return '';
  try { return new Intl.NumberFormat(LOCALE, { style: 'currency', currency, maximumFractionDigits: 0, currencyDisplay: 'symbol' }).format(amount); } catch { return `${currency} ${Math.round(amount).toLocaleString(LOCALE)}`; }
}
export const stipend = (o) => (o.isPaid && o.stipend ? `${money(o.stipend.amount, o.stipend.currency)} / month` : 'Unpaid');
export const usdApprox = (n) => (n == null ? '' : `≈ US$${Math.round(n).toLocaleString('en-US')} / month (indicative)`);
export const bytes = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;
export const weeks = (n) => (n % 4 === 0 && n >= 8 ? `${n / 4} months` : `${n} weeks`);

export function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export const initials = (name) => String(name || '').split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || 'H';

export const LABELS = {
  stage: { interested: 'Interested', preparing: 'Preparing Application', applied: 'Applied', assessment: 'Online Assessment', interview: 'Interview', offer: 'Offer Received', rejected: 'Rejected', withdrawn: 'Withdrawn' },
  recruiterStatus: { submitted: 'Submitted', under_review: 'Under review', shortlisted: 'Shortlisted', assessment: 'Assessment', interview: 'Interview', offer: 'Offer', not_selected: 'Not selected' },
  workMode: { onsite: 'On-site', hybrid: 'Hybrid', remote: 'Remote' },
  visa: { yes: 'Visa sponsored', no: 'No visa sponsorship', not_required: 'No visa needed', case_by_case: 'Visa case-by-case' },
  visaLong: { yes: 'Visa sponsorship offered', no: 'No visa sponsorship', not_required: 'No visa required (remote)', case_by_case: 'Visa support decided case by case' },
  level: { any: 'Any level', undergraduate: 'Undergraduate', postgraduate: 'Postgraduate', doctoral: 'Doctoral' },
  doc: { auto_verified: 'Automated checks passed', verified: 'HORIZON-verified', flagged: 'Under manual review', changes_requested: 'Changes requested', pending_review: 'Awaiting moderation', approved: 'Approved', rejected: 'Not approved', submitted: 'Submitted' },
  user: { approved: 'Approved', pending: 'Pending verification', rejected: 'Rejected', suspended: 'Suspended' },
  listing: { draft: 'Draft', pending_review: 'In review', published: 'Published', rejected: 'Changes requested', archived: 'Archived' },
  priority: { normal: 'Normal', high: 'High', urgent: 'Urgent' },
  orgStatus: { verified: 'Verified', unverified: 'Unverified', rejected: 'Rejected' },
};
export const STAGES = Object.keys(LABELS.stage);
export const RECRUITER_STATUSES = Object.keys(LABELS.recruiterStatus);

export const COUNTRY_CODES = {
  Singapore: 'SG', 'United States': 'US', 'United Kingdom': 'UK', Germany: 'DE', France: 'FR', Japan: 'JP', Netherlands: 'NL',
  Switzerland: 'CH', Australia: 'AU', 'South Korea': 'KR', 'United Arab Emirates': 'AE', India: 'IN', Canada: 'CA', Ireland: 'IE',
};
export const countryCode = (c) => COUNTRY_CODES[c] || String(c || '?').slice(0, 2).toUpperCase();
