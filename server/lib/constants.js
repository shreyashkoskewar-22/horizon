'use strict';

const INDUSTRIES = [
  'Management Consulting', 'Finance', 'Investment Banking', 'Technology', 'Data Analytics', 'Artificial Intelligence',
  'Product Management', 'Marketing & Growth', 'Operations & Supply Chain', 'Strategy & Operations', 'Public Policy',
  'Research', 'Sustainability', 'International Development',
];

const ORG_TYPES = [
  'Multinational corporation', 'Consulting firm', 'Bank or financial institution', 'Startup', 'Technology company',
  'Research institution', 'University or academic institution', 'Think tank or policy organisation',
  'NGO or development organisation', 'Government-backed programme',
];

const INSTITUTION_CATEGORIES = ['IIT', 'IIM', 'NIT', 'IIIT', 'IISER', 'AIIMS', 'NIPER', 'NID', 'SPA', 'Central University', 'Medical & Health', 'Other INI'];

const WORK_MODES = ['onsite', 'hybrid', 'remote'];
const VISA_OPTIONS = ['yes', 'no', 'not_required', 'case_by_case'];
const ACADEMIC_LEVELS = ['undergraduate', 'postgraduate', 'doctoral'];

const STAGES = ['interested', 'preparing', 'applied', 'assessment', 'interview', 'offer', 'rejected', 'withdrawn'];
const SUBMITTED_STAGES = ['applied', 'assessment', 'interview', 'offer', 'rejected'];
const RECRUITER_STATUSES = ['submitted', 'under_review', 'shortlisted', 'assessment', 'interview', 'offer', 'not_selected'];
const RECRUITER_TO_STAGE = {
  submitted: 'applied', under_review: 'applied', shortlisted: 'applied', assessment: 'assessment',
  interview: 'interview', offer: 'offer', not_selected: 'rejected',
};

/**
 * Indicative conversion rates (USD per one unit of currency) used ONLY to sort and filter
 * stipends across currencies. Listings always display the original amount and currency.
 * Update these periodically; they are not financial data.
 */
const USD_PER_UNIT = {
  USD: 1, EUR: 1.08, GBP: 1.27, SGD: 0.74, JPY: 0.0067, CHF: 1.12, AUD: 0.65, KRW: 0.00073,
  AED: 0.2723, INR: 0.012, CAD: 0.73, HKD: 0.128, NZD: 0.6, SEK: 0.095, DKK: 0.145, NOK: 0.093,
};
const CURRENCIES = Object.keys(USD_PER_UNIT);
const toUsdMonthly = (isPaid, amount, currency) => (isPaid && amount && USD_PER_UNIT[currency] ? Math.round(amount * USD_PER_UNIT[currency]) : null);

const GRIEVANCE_CATEGORIES = {
  fee_demand: { label: 'Asked to pay a fee or deposit', priority: 'urgent' },
  harassment: { label: 'Harassment or inappropriate conduct', priority: 'urgent' },
  fake_listing: { label: 'Fake or misleading listing', priority: 'high' },
  offer_mismatch: { label: 'Offer differs from the listing', priority: 'high' },
  discrimination: { label: 'Discrimination', priority: 'high' },
  privacy: { label: 'Privacy or personal data concern', priority: 'high' },
  no_response: { label: 'No response to my application', priority: 'normal' },
  verification: { label: 'Account verification decision', priority: 'normal' },
  document_review: { label: 'CV or video review decision', priority: 'normal' },
  candidate_conduct: { label: 'Candidate conduct (for recruiters)', priority: 'normal' },
  technical: { label: 'Technical problem', priority: 'normal' },
  other: { label: 'Something else', priority: 'normal' },
};
const GRIEVANCE_STATUSES = ['submitted', 'acknowledged', 'under_review', 'awaiting_response', 'resolved', 'rejected', 'closed'];
const GRIEVANCE_OPEN = ['submitted', 'acknowledged', 'under_review', 'awaiting_response'];

module.exports = {
  INDUSTRIES, ORG_TYPES, INSTITUTION_CATEGORIES, WORK_MODES, VISA_OPTIONS, ACADEMIC_LEVELS,
  STAGES, SUBMITTED_STAGES, RECRUITER_STATUSES, RECRUITER_TO_STAGE, USD_PER_UNIT, CURRENCIES, toUsdMonthly,
  GRIEVANCE_CATEGORIES, GRIEVANCE_STATUSES, GRIEVANCE_OPEN,
};
