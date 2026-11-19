'use strict';
/**
 * Minimal dependency-free PDF writer (standard Helvetica fonts, WinAnsi).
 * Used to generate demo documents for the seed script and for automated tests.
 * Each page is an array of lines: a string, or { text, size, bold, gap }.
 */
function esc(s) {
  return String(s)
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-')
    .replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)')
    .replace(/[^\x20-\x7E]/g, '?');
}

function makePdf(pages, { title = 'Document', producer = 'HORIZON demo generator' } = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const catalogId = add(null); // placeholder
  const pagesId = add(null);
  const fontReg = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const fontBold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const pageIds = [];
  for (const lines of pages) {
    let y = 790;
    let content = '';
    for (const raw of lines) {
      const line = typeof raw === 'string' ? { text: raw } : raw;
      const size = line.size || 11;
      if (line.gap) y -= line.gap;
      if (line.text) {
        content += `BT /${line.bold ? 'F2' : 'F1'} ${size} Tf 56 ${y.toFixed(1)} Td (${esc(line.text)}) Tj ET\n`;
      }
      y -= size * 1.45;
      if (y < 50) break;
    }
    const contentId = add(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}endstream`);
    const pageId = add(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontReg} 0 R /F2 ${fontBold} 0 R >> >> /Contents ${contentId} 0 R >>`);
    pageIds.push(pageId);
  }
  objs[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objs[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;
  const infoId = add(`<< /Title (${esc(title)}) /Producer (${esc(producer)}) >>`);

  let out = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n';
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out, 'latin1'));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out, 'latin1');
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) out += `${String(off).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Builds a realistic one-page CV for demos and tests. */
function makeCvPdf({ name, email, institution, programme, graduationYear, extraLines = [], pages = 1 }) {
  const first = [
    { text: name, size: 20, bold: true },
    `${email}  |  +91 90000 00000  |  linkedin.com/in/demo-profile`,
    { text: 'EDUCATION', bold: true, size: 12, gap: 10 },
    `${institution}`,
    `${programme} - Expected graduation ${graduationYear}`,
    'Relevant coursework: Statistics, Microeconomics, Marketing Management, Business Analytics',
    { text: 'EXPERIENCE AND PROJECTS', bold: true, size: 12, gap: 10 },
    'Market-entry study (course project): sized a consumer-tech opportunity across three ASEAN markets.',
    'Built a demand-forecasting model in Python (pandas, scikit-learn) on 2 years of retail data.',
    'Organised an inter-college case competition with 40+ participating teams.',
    { text: 'SKILLS', bold: true, size: 12, gap: 10 },
    'Python, SQL, Excel, Tableau, financial modelling, market research, presentation design',
    { text: 'LANGUAGES', bold: true, size: 12, gap: 10 },
    'English (fluent), Hindi (native), French (A2)',
    ...extraLines,
  ];
  const all = [first];
  for (let i = 1; i < pages; i++) all.push([{ text: `Additional page ${i + 1}`, bold: true }, 'Continued details for testing page limits.']);
  return makePdf(all, { title: `${name} - CV` });
}

module.exports = { makePdf, makeCvPdf };
