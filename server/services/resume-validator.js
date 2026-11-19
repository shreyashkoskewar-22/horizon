'use strict';
/**
 * Resume (CV) validation pipeline.
 *
 * Critical checks (any failure → upload rejected, file discarded):
 *   genuine PDF signature · no active content (JavaScript, launch actions, embedded files)
 *   · not encrypted · opens cleanly · at most 4 pages · has a readable text layer
 * Authenticity checks (failure → stored but FLAGGED for manual review, hidden from recruiters):
 *   name matches the verified account · mentions the verified institution · not a file already
 *   linked to another account
 * Quality checks (warnings only): graduation year, contact email, core sections, ideal length.
 *
 * Outcome: 'rejected' | 'flagged' | 'auto_verified'. An administrator can later mark a CV
 * 'verified' (manual verification badge) or 'changes_requested'.
 */
let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  return pdfjsPromise;
}

async function extractPdfText(buffer, { maxPages = 6 } = {}) {
  const pdfjs = await loadPdfjs();
  const task = pdfjs.getDocument({
    data: new Uint8Array(buffer), isEvalSupported: false, disableFontFace: true, useSystemFonts: false,
    verbosity: 0, stopAtErrors: false,
  });
  try {
    const doc = await task.promise;
    const pages = doc.numPages;
    let text = '';
    for (let i = 1; i <= Math.min(pages, maxPages); i += 1) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      text += `${content.items.map((it) => it.str || '').join(' ')}\n`;
    }
    const [js, attachments] = await Promise.all([doc.getJSActions().catch(() => null), doc.getAttachments().catch(() => null)]);
    return { pages, text, hasJs: !!(js && Object.keys(js).length), hasAttachments: !!(attachments && Object.keys(attachments).length) };
  } finally {
    await task.destroy().catch(() => {});
  }
}

const normalise = (s) => String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9@.]+/g, ' ').replace(/\s+/g, ' ').trim();
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const hasWord = (haystack, word) => new RegExp(`(^|[^a-z0-9])${escapeRe(word)}([^a-z0-9]|$)`).test(haystack);
const hasPhrase = (haystack, phrase) => !!phrase && hasWord(haystack, normalise(phrase));

const CRITICAL = new Set(['signature', 'active_content', 'encryption', 'parse', 'length', 'text_layer']);
const AUTHENTICITY = new Set(['name_match', 'institution_match', 'duplicate']);

async function validateResume(buffer, { fullName, institution, graduationYear, duplicateOwner = false }) {
  const checks = [];
  const add = (id, label, result, detail) => checks.push({ id, label, result, detail, critical: CRITICAL.has(id) });
  const finish = (meta = {}) => {
    const criticalFail = checks.some((c) => c.result === 'fail' && CRITICAL.has(c.id));
    const authFail = checks.some((c) => c.result === 'fail' && AUTHENTICITY.has(c.id));
    const status = criticalFail ? 'rejected' : authFail ? 'flagged' : 'auto_verified';
    const summary = {
      passed: checks.filter((c) => c.result === 'pass').length,
      warnings: checks.filter((c) => c.result === 'warn').length,
      failed: checks.filter((c) => c.result === 'fail').length,
    };
    return { status, checks, summary, meta, checkedAt: new Date().toISOString() };
  };

  const raw = buffer.toString('latin1');
  if (!raw.slice(0, 1024).includes('%PDF-')) {
    add('signature', 'Genuine PDF file', 'fail', 'This file is not a real PDF (its contents do not match the PDF format).');
    return finish();
  }
  add('signature', 'Genuine PDF file', 'pass', 'File signature matches the PDF format.');

  const risky = [];
  if (/\/JavaScript\b/.test(raw) || /\/JS[\s(<[]/.test(raw)) risky.push('JavaScript');
  if (/\/Launch\b/.test(raw)) risky.push('launch actions');
  if (/\/EmbeddedFiles?\b/.test(raw)) risky.push('embedded files');
  if (/\/RichMedia\b/.test(raw)) risky.push('rich media');
  if (risky.length) add('active_content', 'No active content', 'fail', `Contains ${risky.join(', ')}. Export a plain PDF (for example "Save as PDF") and upload it again.`);
  else add('active_content', 'No active content', 'pass', 'No scripts, launch actions or embedded files found.');

  if (/\/Encrypt\b/.test(raw)) add('encryption', 'Not password-protected', 'fail', 'The PDF is encrypted or password-protected. Recruiters must be able to open it.');
  else add('encryption', 'Not password-protected', 'pass', 'The PDF is not encrypted.');
  if (checks.some((c) => c.result === 'fail')) return finish();

  let parsed;
  try {
    parsed = await extractPdfText(buffer);
    add('parse', 'Opens correctly', 'pass', `Parsed ${parsed.pages} page${parsed.pages === 1 ? '' : 's'} successfully.`);
  } catch (err) {
    const detail = err && err.name === 'PasswordException' ? 'The PDF is password-protected.' : 'The PDF appears to be damaged and could not be opened.';
    add('parse', 'Opens correctly', 'fail', detail);
    return finish();
  }
  if (parsed.hasJs || parsed.hasAttachments) {
    const c = checks.find((x) => x.id === 'active_content');
    c.result = 'fail';
    c.detail = 'The PDF contains scripts or attachments. Export a plain PDF and upload it again.';
    return finish({ pages: parsed.pages });
  }

  const { pages } = parsed;
  if (pages > 4) add('length', 'Length', 'fail', `CVs must be 4 pages or fewer — yours has ${pages}.`);
  else if (pages > 2) add('length', 'Length', 'warn', `${pages} pages. Most international internship recruiters expect one or two pages.`);
  else add('length', 'Length', 'pass', `${pages} page${pages === 1 ? '' : 's'} — an ideal length.`);

  const text = normalise(parsed.text);
  const words = text ? text.split(' ').length : 0;
  if (text.replace(/\s/g, '').length < 300) {
    add('text_layer', 'Readable text', 'fail', 'Not enough selectable text was found. Upload a text-based PDF instead of a scan or image — screening systems cannot read images.');
  } else {
    add('text_layer', 'Readable text', 'pass', `${words} words of machine-readable text detected.`);
  }
  if (checks.some((c) => c.result === 'fail' && CRITICAL.has(c.id))) return finish({ pages, words });

  // Authenticity
  const nameTokens = normalise(fullName).split(' ').filter((t) => t.length >= 2);
  const found = nameTokens.filter((t) => hasWord(text, t));
  if (nameTokens.length && found.length === nameTokens.length) add('name_match', 'Name matches your account', 'pass', `Found "${fullName}" in the document.`);
  else if (nameTokens.length >= 2 && found.length >= nameTokens.length - 1 && found.length >= 1) add('name_match', 'Name matches your account', 'warn', `Only part of your name was found (${found.join(' ')}). Use the same name as your verified account.`);
  else add('name_match', 'Name matches your account', 'fail', `Your verified name ("${fullName}") does not appear in this CV. CVs must belong to the account holder; it will be reviewed manually.`);

  const instNames = [institution && institution.name, institution && institution.short_name].filter(Boolean);
  if (instNames.some((n) => hasPhrase(text, n))) add('institution_match', 'Mentions your verified institution', 'pass', `Found ${instNames.find((n) => hasPhrase(text, n))}.`);
  else add('institution_match', 'Mentions your verified institution', 'fail', `${institution ? institution.name : 'Your institution'} is not mentioned. Add it to your education section; until then the CV is reviewed manually.`);

  if (duplicateOwner) add('duplicate', 'Unique to your account', 'fail', 'This exact file is already linked to a different HORIZON account. It will be reviewed manually.');
  else add('duplicate', 'Unique to your account', 'pass', 'This file is not linked to any other account.');

  // Quality
  if (graduationYear && hasWord(text, String(graduationYear))) add('graduation_year', 'Graduation year', 'pass', `Expected graduation ${graduationYear} is stated.`);
  else add('graduation_year', 'Graduation year', 'warn', `State your expected graduation year (${graduationYear}) — international recruiters check eligibility windows.`);

  if (/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/.test(text)) add('contact', 'Contact email', 'pass', 'An email address is included.');
  else add('contact', 'Contact email', 'warn', 'Add an email address so recruiters can reach you.');

  const sections = {
    Education: /(^| )(education|academic|academics|qualifications)( |$)/.test(text),
    'Experience or projects': /(^| )(experience|internships?|projects?|work)( |$)/.test(text),
    Skills: /(^| )(skills|competencies|tools|technical)( |$)/.test(text),
  };
  const missing = Object.entries(sections).filter(([, ok]) => !ok).map(([k]) => k);
  if (missing.length) add('sections', 'Core sections', 'warn', `Consider adding: ${missing.join(', ')}.`);
  else add('sections', 'Core sections', 'pass', 'Education, experience/projects and skills sections found.');

  return finish({ pages, words });
}

module.exports = { validateResume, extractPdfText, normalise };
