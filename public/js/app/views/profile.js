import { html, render, $, on, formToObject } from '../../lib/dom.js';
import { icon } from '../../lib/icons.js';
import { get, put, post, del, upload } from '../../lib/api.js';
import { docBadge, checkList, checkSummary } from '../../lib/components.js';
import { toast, toastError, confirmDialog, withLoading, tagInput, mountTagInputs, openModal } from '../../lib/ui.js';
import { validateForm, liveValidate, applyServerErrors } from '../../lib/validate.js';
import { fmtDate, bytes } from '../../lib/format.js';
import { pageHeader, field } from '../shared.js';

const YEAR = new Date().getFullYear();

export default async function profile(ctx) {
  ctx.setTitle('My Profile');
  ctx.setCrumbs([{ label: 'My Profile' }]);
  let data = await get('/api/profile');
  const isStudent = ctx.role === 'student';
  const cfg = ctx.cfg;

  function draw() {
    const p = data.profile || {};
    const u = data.user;
    const academic = html`<section class="card" id="p-academic" aria-labelledby="p-academic-h">
          <div class="card-header"><h2 id="p-academic-h">${icon('user')} ${isStudent ? 'Academic' : 'About you'}</h2><span class="badge badge-teal">${icon('shieldCheck')} Verified ${isStudent ? 'student' : 'recruiter'}</span></div>
          <div class="card-body"><div class="form-grid">
            ${field('fullName', 'Full name', html`<input class="input" id="f-fullName" value="${u.fullName}" disabled>`, { help: 'Matches your verification. Contact the grievance desk to correct it.' })}
            ${isStudent ? html`
              ${field('institution', 'Institution', html`<input class="input" id="f-institution" value="${u.institution.name}" disabled>`)}
              ${field('programme', 'Academic programme', html`<input class="input" id="f-programme" name="programme" value="${p.programme}" data-validate="required|min:2|max:120">`, { span: true })}
              ${field('academicLevel', 'Level of study', html`<select class="select" id="f-academicLevel" name="academicLevel">${['undergraduate', 'postgraduate', 'doctoral'].map((l) => html`<option value="${l}" ${p.academicLevel === l ? 'selected' : ''}>${l[0].toUpperCase() + l.slice(1)}</option>`)}</select>`)}
              ${field('currentYear', 'Current year', html`<select class="select" id="f-currentYear" name="currentYear">${[1, 2, 3, 4, 5, 6].map((y) => html`<option value="${y}" ${p.currentYear === y ? 'selected' : ''}>Year ${y}</option>`)}</select>`)}
              ${field('graduationYear', 'Graduation year', html`<select class="select" id="f-graduationYear" name="graduationYear">${Array.from({ length: 9 }, (_, i) => YEAR - 1 + i).map((y) => html`<option value="${y}" ${p.graduationYear === y ? 'selected' : ''}>${y}</option>`)}</select>`)}
              ${field('specialisation', 'Area of specialisation', html`<input class="input" id="f-specialisation" name="specialisation" value="${p.specialisation || ''}" data-validate="max:120" placeholder="e.g. Finance and analytics">`)}`
    : html`${field('organisation', 'Organisation', html`<input class="input" id="f-organisation" value="${u.organisation.name}" disabled>`)}
              ${field('designation', 'Designation', html`<input class="input" id="f-designation" name="designation" value="${p.designation}" data-validate="required|min:2|max:100">`)}
              ${field('linkedinUrl', 'LinkedIn profile', html`<input class="input" id="f-linkedinUrl" name="linkedinUrl" type="url" value="${p.linkedinUrl || ''}" data-validate="url" placeholder="https://www.linkedin.com/in/…">`, { optional: true, span: true })}`}
            ${field('bio', isStudent ? 'Short professional introduction' : 'Introduction for students', html`<textarea class="textarea" id="f-bio" name="bio" rows="4" maxlength="800" data-validate="max:800" placeholder="${isStudent ? 'Two or three sentences about what you’re looking for and why.' : 'What your team does and what interns can expect.'}">${p.bio || ''}</textarea>`, { span: true })}
          </div></div>
        </section>`;
    const saveRow = html`<div class="row justify-end"><button class="btn btn-primary btn-lg" type="submit">${icon('check')} Save profile</button></div>`;

    if (!isStudent) {
      render(ctx.el, html`${pageHeader({ title: 'My profile', subtitle: 'Students see your name, designation, introduction and approved intro video on your organisation’s page.' })}
      <div class="detail">
        <form class="stack gap-5" data-profile novalidate>${academic}${saveRow}</form>
        <aside class="aside-sticky">
          <section class="card card-pad"><h3>${icon('building')} ${u.organisation.name}</h3><p class="small muted">Keep your organisation description current — students see it next to every listing.</p><a class="btn btn-sm btn-block" href="/recruiter/organisation">Edit organisation profile</a></section>
          <section class="card" data-video-card>${videoCard()}</section>
        </aside>
      </div>`);
    } else {
      const SECTIONS = [['p-academic', 'Academic'], ['p-skills', 'Skills and interests'], ['p-prefs', 'Preferences'], ['p-experience', 'Experience'], ['p-links', 'Links'], ['p-documents', 'Documents']];
      const c = data.completion;
      render(ctx.el, html`${pageHeader({ title: 'My profile', subtitle: 'Recruiters you apply to see this profile, your validated CV and (optionally) your video resume.' })}
      <div class="profile-layout">
        <div class="stack gap-5 profile-main">
          <form class="stack gap-5" data-profile novalidate>
            ${academic}
            <section class="card" id="p-skills" aria-labelledby="p-skills-h"><div class="card-header"><h2 id="p-skills-h">${icon('sparkles')} Skills and interests</h2></div>
              <div class="card-body"><div class="form-grid">
                ${field('skills', 'Skills', tagInput({ name: 'skills', values: p.skills, placeholder: 'Add a skill and press Enter', suggestions: ['Python', 'SQL', 'Excel', 'Financial Modelling', 'Market Research', 'PowerPoint', 'Tableau', 'Machine Learning', 'Product Thinking', 'Research Writing'] }), { span: true, help: 'Used for recommendations and shown to recruiters.' })}
                ${field('academicInterests', 'Academic interests', tagInput({ name: 'academicInterests', values: p.academicInterests, placeholder: 'e.g. Behavioural economics' }), { span: true })}
                ${field('languages', 'Languages known', tagInput({ name: 'languages', values: p.languages, placeholder: 'e.g. French (B1)' }), { span: true })}
              </div></div></section>
            <section class="card" id="p-prefs" aria-labelledby="p-prefs-h"><div class="card-header"><h2 id="p-prefs-h">${icon('target')} Preferences</h2><span class="subtle small">Shapes your recommendations</span></div>
              <div class="card-body"><div class="form-grid">
                ${field('preferredCountries', 'Preferred countries', tagInput({ name: 'preferredCountries', values: p.preferredCountries, placeholder: 'e.g. Singapore', suggestions: ['Singapore', 'United Kingdom', 'United States', 'Germany', 'France', 'Netherlands', 'Japan', 'Switzerland', 'Australia', 'South Korea', 'United Arab Emirates'] }))}
                ${field('preferredIndustries', 'Preferred industries', tagInput({ name: 'preferredIndustries', values: p.preferredIndustries, placeholder: 'e.g. Product Management', suggestions: cfg.lists.industries }))}
              </div></div></section>
            <section class="card" id="p-experience" aria-labelledby="p-experience-h"><div class="card-header"><h2 id="p-experience-h">${icon('briefcase')} Experience</h2></div>
              <div class="card-body">
                ${field('experience', 'Previous experience', html`<textarea class="textarea" id="f-experience" name="experience" rows="5" maxlength="4000" data-validate="max:4000" placeholder="Internships, projects, competitions, positions of responsibility — one per line.">${p.experience || ''}</textarea>`, { help: 'One item per line. Recruiters see this exactly as written.' })}
              </div></section>
            <section class="card" id="p-links" aria-labelledby="p-links-h"><div class="card-header"><h2 id="p-links-h">${icon('link')} Links</h2></div>
              <div class="card-body"><div class="form-grid">
                ${field('linkedinUrl', 'LinkedIn URL', html`<input class="input" id="f-linkedinUrl" name="linkedinUrl" type="url" value="${p.linkedinUrl || ''}" data-validate="url" placeholder="https://www.linkedin.com/in/…">`, { optional: true })}
                ${field('portfolioUrl', 'Portfolio URL', html`<input class="input" id="f-portfolioUrl" name="portfolioUrl" type="url" value="${p.portfolioUrl || ''}" data-validate="url" placeholder="https://…">`, { optional: true })}
                ${field('githubUrl', 'GitHub URL', html`<input class="input" id="f-githubUrl" name="githubUrl" type="url" value="${p.githubUrl || ''}" data-validate="url" placeholder="https://github.com/…">`, { optional: true, help: 'Where applicable.' })}
              </div></div></section>
            ${saveRow}
          </form>
          <section id="p-documents" aria-labelledby="p-documents-h">
            <div class="section-title"><h2 id="p-documents-h">${icon('fileText')} Documents</h2><span class="subtle small">Saved separately as soon as you upload</span></div>
            <div class="doc-grid"><section class="card" data-cv-card>${cvCard()}</section><section class="card" data-video-card>${videoCard()}</section></div>
          </section>
        </div>
        <aside class="aside-sticky profile-aside">
          <section class="card card-pad"><div class="row between"><h3 class="mb-0">Profile completion</h3><strong>${c.percent}%</strong></div>
            <div class="progress gold mt-8" role="progressbar" aria-valuenow="${c.percent}" aria-valuemin="0" aria-valuemax="100" aria-label="Profile completion"><span style="width:${c.percent}%"></span></div>
            ${c.missing.length ? html`<ul class="check-list mt-16">${c.missing.slice(0, 5).map((m) => html`<li>${icon('alertCircle', { cls: 'warn' })}<span class="cl-detail text-body">${m}</span></li>`)}</ul>` : html`<p class="small mt-8 mb-0 text-success">${icon('checkCircle', { size: 15 })} Your profile is complete.</p>`}</section>
          <nav class="card card-pad profile-nav" aria-label="Profile sections"><h3 class="label-caps">On this page</h3>
            <ul>${SECTIONS.map(([id, label]) => html`<li><a href="#${id}">${label}</a></li>`)}</ul></nav>
        </aside>
      </div>`);
    }
    const form = $('[data-profile]', ctx.el);
    liveValidate(form);
    mountTagInputs(form);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!validateForm(form)) return;
      const v = formToObject(form);
      if (isStudent) { v.currentYear = Number(v.currentYear); v.graduationYear = Number(v.graduationYear); }
      await withLoading(form.querySelector('[type=submit]'), async () => {
        try { data = await put('/api/profile', v); toast('Profile saved.'); draw(); } catch (err) { if (!applyServerErrors(form, err.fields)) toastError(err); }
      });
    });
  }

  function cvCard(rejectedReport = null) {
    const cv = data.cv;
    const report = rejectedReport || (cv && cv.report);
    return html`<div class="card-header"><h2>${icon('fileText')} CV</h2>${cv ? docBadge(cv.status) : ''}</div>
      <div class="card-body stack gap-4">
        ${rejectedReport ? html`<div class="alert alert-error">${icon('xCircle')}<div><div class="alert-title">Upload rejected</div>Fix the failed checks below and upload again. Nothing was saved.</div></div>` : ''}
        ${cv ? html`<div class="row"><span class="avatar sm file-pdf" aria-hidden="true">PDF</span><div class="grow"><div class="strong truncate">${cv.originalName}</div><div class="subtle">${bytes(cv.sizeBytes)} · uploaded ${fmtDate(cv.createdAt)}${cv.meta && cv.meta.pages ? ` · ${cv.meta.pages} page${cv.meta.pages > 1 ? 's' : ''}` : ''}</div></div></div>
          ${cv.status === 'flagged' ? html`<div class="alert alert-warning">${icon('clock')}<div>Some authenticity checks didn’t pass, so a reviewer will check this CV. You can’t apply on HORIZON until it’s cleared.</div></div>` : ''}
          ${cv.status === 'changes_requested' ? html`<div class="alert alert-error">${icon('alertCircle')}<div><div class="alert-title">Changes requested</div>${cv.reviewNote}</div></div>` : ''}
          ${cv.status === 'verified' ? html`<div class="alert alert-success">${icon('shieldCheck')}<div>Manually verified by HORIZON${cv.reviewedAt ? ` on ${fmtDate(cv.reviewedAt)}` : ''}. Recruiters see a verified badge.</div></div>` : ''}` : ''}
        ${report ? html`<div class="cv-report"><div class="label-caps">Validation report</div>${checkSummary(report.summary)}
          <details ${rejectedReport || (cv && cv.status !== 'verified' && cv.status !== 'auto_verified') ? 'open' : ''}><summary class="strong small">Show every check</summary><div class="mt-16">${checkList(report.checks)}</div></details></div>` : ''}
        <label class="dropzone" data-cv-drop tabindex="0">${icon('upload', { size: 24 })}<div class="strong mt-8">${cv ? 'Replace CV' : 'Upload your CV'}</div><div class="subtle">PDF only · up to ${cfg.uploads.cvMaxMb} MB · text-based, not scanned</div>
          <input type="file" accept="application/pdf,.pdf" hidden data-cv-input></label>
        <div class="progress" data-cv-progress hidden><span style="width:0%"></span></div>
        ${cv ? html`<div class="row wrap gap-2"><a class="btn btn-sm" href="${cv.url}" target="_blank" rel="noopener">${icon('eye', { size: 15 })} View</a><a class="btn btn-sm" href="${cv.url}?download=1">${icon('download', { size: 15 })} Download</a>
          ${!['verified'].includes(cv.status) && !cv.manualReviewRequested ? html`<button class="btn btn-sm" data-cv-review>${icon('shieldCheck', { size: 15 })} Request verification</button>` : ''}
          ${cv.manualReviewRequested ? html`<span class="badge badge-info">Verification requested</span>` : ''}
          <button class="btn btn-sm btn-danger" data-cv-delete>${icon('trash', { size: 15 })} Remove</button></div>` : ''}
        <p class="subtle xs mb-0">${icon('lock', { size: 13 })} Stored privately. Shared only with organisations you apply to on HORIZON.</p>
      </div>`;
  }

  function videoCard() {
    const v = data.video;
    return html`<div class="card-header"><h2>${icon('video')} ${isStudent ? 'Video resume' : 'Intro video'}</h2>${v ? docBadge(v.status) : html`<span class="badge">Optional</span>`}</div>
      <div class="card-body stack gap-4">
        ${v ? html`<video controls preload="metadata" src="${v.url}" class="video-frame"></video>
          <div class="subtle">${v.meta && v.meta.durationSeconds ? `${Math.round(v.meta.durationSeconds)} seconds · ` : ''}${bytes(v.sizeBytes)} · uploaded ${fmtDate(v.createdAt)}</div>
          ${v.status === 'pending_review' ? html`<div class="alert alert-warning">${icon('clock')}<div>Awaiting moderation. It becomes visible to ${isStudent ? 'recruiters you apply to' : 'students'} once approved.</div></div>` : ''}
          ${v.status === 'rejected' ? html`<div class="alert alert-error">${icon('alertCircle')}<div><div class="alert-title">Not approved</div>${v.reviewNote || 'Please record a new video.'}</div></div>` : ''}`
    : html`<p class="small muted mb-0">${isStudent ? 'A 60–90 second introduction helps recruiters meet you before an interview.' : 'A short welcome from your team helps students trust your listings.'} Up to ${cfg.uploads.videoMaxSeconds} seconds.</p>`}
        <div class="row wrap gap-2">
          <label class="btn btn-sm">${icon('upload', { size: 15 })} ${v ? 'Replace' : 'Upload video'}<input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov,.m4v" hidden data-video-input></label>
          <button class="btn btn-sm" data-record>${icon('camera', { size: 15 })} Record in browser</button>
          ${v ? html`<button class="btn btn-sm btn-danger" data-video-delete>${icon('trash', { size: 15 })} Remove</button>` : ''}
        </div>
        <div class="progress" data-video-progress hidden><span style="width:0%"></span></div>
        <p class="subtle xs mb-0">${icon('lock', { size: 13 })} MP4, MOV or WebM · up to ${cfg.uploads.videoMaxMb} MB · reviewed by HORIZON before anyone else sees it.</p>
      </div>`;
  }

  async function uploadCv(file) {
    if (!file) return;
    if (!/\.pdf$/i.test(file.name)) return toast('Upload a PDF file.', { type: 'error' });
    if (file.size > cfg.uploads.cvMaxMb * 1048576) return toast(`The maximum size is ${cfg.uploads.cvMaxMb} MB.`, { type: 'error' });
    const bar = $('[data-cv-progress]', ctx.el);
    bar.hidden = false;
    const fd = new FormData();
    fd.append('cv', file);
    try {
      const res = await upload('/api/profile/cv', fd, { onProgress: (p) => { bar.firstElementChild.style.width = `${p}%`; } });
      toast(res.report.status === 'flagged' ? 'Uploaded — sent for a quick manual review.' : 'CV uploaded and validated.', { type: res.report.status === 'flagged' ? 'info' : 'success' });
      data = await get('/api/profile');
      draw();
    } catch (err) {
      bar.hidden = true;
      if (err.data && err.data.report) render($('[data-cv-card]', ctx.el), cvCard(err.data.report));
      else toastError(err);
    }
  }

  function videoDuration(file) {
    return new Promise((resolve) => {
      const vEl = document.createElement('video');
      vEl.preload = 'metadata';
      vEl.onloadedmetadata = () => { const d = vEl.duration; URL.revokeObjectURL(vEl.src); resolve(Number.isFinite(d) ? d : null); };
      vEl.onerror = () => resolve(null);
      vEl.src = URL.createObjectURL(file);
    });
  }

  async function uploadVideo(file, knownDuration = null) {
    if (!file) return;
    if (file.size > cfg.uploads.videoMaxMb * 1048576) return toast(`The maximum size is ${cfg.uploads.videoMaxMb} MB.`, { type: 'error' });
    const duration = knownDuration ?? await videoDuration(file);
    if (duration && duration > cfg.uploads.videoMaxSeconds + 1) return toast(`Your video is ${Math.round(duration)} seconds. The limit is ${cfg.uploads.videoMaxSeconds} seconds.`, { type: 'error' });
    const bar = $('[data-video-progress]', ctx.el);
    bar.hidden = false;
    const fd = new FormData();
    fd.append('video', file);
    if (duration) fd.append('durationSeconds', String(duration));
    try {
      await upload('/api/profile/video', fd, { onProgress: (p) => { bar.firstElementChild.style.width = `${p}%`; } });
      toast('Video uploaded — it will be visible after moderation.');
      data = await get('/api/profile');
      draw();
    } catch (err) { bar.hidden = true; toastError(err); }
  }

  function recorder() {
    let stream = null; let rec = null; let chunks = []; let timer = null; let seconds = 0; let blob = null;
    const max = cfg.uploads.videoMaxSeconds;
    const m = openModal({
      title: 'Record a video resume', wide: true,
      description: `Up to ${max} seconds. Look at the camera, speak naturally, and keep it specific.`,
      body: html`<div class="stack"><video data-live autoplay muted playsinline class="video-frame"></video>
        <div class="row between"><span class="badge" data-timer>0:00 / ${Math.floor(max / 60)}:${String(max % 60).padStart(2, '0')}</span><span class="subtle small" data-hint>Allow camera and microphone access to begin.</span></div></div>`,
      footer: html`<button class="btn" data-close>Cancel</button><button class="btn btn-danger-solid" data-rec hidden>${icon('camera')} Start recording</button><button class="btn" data-stop hidden>${icon('square')} Stop</button><button class="btn" data-redo hidden>${icon('refresh')} Record again</button><button class="btn btn-primary" data-use hidden>${icon('upload')} Use this video</button>`,
      onClose: () => { clearInterval(timer); if (rec && rec.state !== 'inactive') rec.stop(); if (stream) stream.getTracks().forEach((t) => t.stop()); },
    });
    const live = $('[data-live]', m.el);
    const show = (sel, on) => { $(sel, m.el).hidden = !on; };
    const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { width: 1280, height: 720 }, audio: true });
        live.srcObject = stream; live.muted = true; live.controls = false;
        $('[data-hint]', m.el).textContent = 'Ready when you are.';
        show('[data-rec]', true);
      } catch { $('[data-hint]', m.el).textContent = 'Camera or microphone is unavailable. You can upload a recorded file instead.'; }
    };
    $('[data-rec]', m.el).addEventListener('click', () => {
      const type = ['video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm'].find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
      rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
      chunks = []; seconds = 0;
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => {
        clearInterval(timer);
        blob = new Blob(chunks, { type: rec.mimeType || 'video/webm' });
        live.srcObject = null; live.src = URL.createObjectURL(blob); live.muted = false; live.controls = true;
        show('[data-stop]', false); show('[data-redo]', true); show('[data-use]', true);
        $('[data-hint]', m.el).textContent = 'Review your recording, then use it or record again.';
      };
      rec.start(1000);
      show('[data-rec]', false); show('[data-stop]', true);
      $('[data-hint]', m.el).textContent = 'Recording…';
      timer = setInterval(() => { seconds += 1; $('[data-timer]', m.el).textContent = `${fmt(seconds)} / ${fmt(max)}`; if (seconds >= max) rec.stop(); }, 1000);
    });
    $('[data-stop]', m.el).addEventListener('click', () => rec && rec.stop());
    $('[data-redo]', m.el).addEventListener('click', () => { live.src = ''; live.srcObject = stream; live.controls = false; live.muted = true; show('[data-redo]', false); show('[data-use]', false); show('[data-rec]', true); $('[data-timer]', m.el).textContent = `0:00 / ${fmt(max)}`; });
    $('[data-use]', m.el).addEventListener('click', () => {
      const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
      const file = new File([blob], `video-resume.${ext}`, { type: blob.type });
      m.close();
      uploadVideo(file, seconds);
    });
    start();
  }

  on(ctx.el, 'change', '[data-cv-input]', (e, input) => uploadCv(input.files[0]));
  on(ctx.el, 'change', '[data-video-input]', (e, input) => uploadVideo(input.files[0]));
  on(ctx.el, 'keydown', '[data-cv-drop]', (e, d) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); d.querySelector('input').click(); } });
  on(ctx.el, 'dragover', '[data-cv-drop]', (e, d) => { e.preventDefault(); d.classList.add('is-over'); });
  on(ctx.el, 'dragleave', '[data-cv-drop]', (e, d) => d.classList.remove('is-over'));
  on(ctx.el, 'drop', '[data-cv-drop]', (e, d) => { e.preventDefault(); d.classList.remove('is-over'); uploadCv(e.dataTransfer.files[0]); });
  on(ctx.el, 'click', '[data-record]', recorder);
  on(ctx.el, 'click', '[data-cv-review]', async (e, b) => {
    await withLoading(b, async () => { try { await post('/api/profile/cv/request-review', {}); toast('Verification requested. You’ll be notified when it’s reviewed.'); data = await get('/api/profile'); draw(); } catch (err) { toastError(err); } });
  });
  on(ctx.el, 'click', '[data-cv-delete]', async () => {
    if (!(await confirmDialog({ title: 'Remove your CV?', message: 'You won’t be able to apply on HORIZON until you upload a new one. Applications already sent keep the CV you submitted.', confirmText: 'Remove', danger: true }))) return;
    try { await del('/api/profile/cv'); toast('CV removed.'); data = await get('/api/profile'); draw(); } catch (err) { toastError(err); }
  });
  on(ctx.el, 'click', '[data-video-delete]', async () => {
    if (!(await confirmDialog({ title: 'Remove your video?', message: 'It will no longer be available to new applications.', confirmText: 'Remove', danger: true }))) return;
    try { await del('/api/profile/video'); toast('Video removed.'); data = await get('/api/profile'); draw(); } catch (err) { toastError(err); }
  });
  draw();
}
