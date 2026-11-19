# HORIZON

**Global opportunities. Verified Indian talent.**

HORIZON is an international internship discovery and application-tracking platform for students of India's **Institutions of National Importance (INIs)**. Both sides are verified: students through their institution, recruiters through their organisation. Every CV is validated before a recruiter sees it, profiles can carry a moderated video resume, and a built-in grievance desk works to published timelines.

> **Demo data notice.** A fresh development install is seeded with fictional organisations and listings. Every one is labelled **"Illustrative listing" / "DEMO DATA"** and links to `example.com`. They are not real vacancies. Platform counts shown in development describe this demo database only.

Why these features exist, with sources: [`docs/PAIN_POINTS.md`](docs/PAIN_POINTS.md).

---

## Quick start

**Requirements:** Node.js **22.13 or later** (uses the built-in `node:sqlite` if the optional `better-sqlite3` package can't be installed). No other services are needed for development.

```bash
npm install
npm run dev
```

Open **http://localhost:3000**. On the first start the database is created in `data/horizon.db` and demo data is loaded.

| Role | Email | Password |
|---|---|---|
| Student (IIM Indore, approved) | `riya.demo@iimidr.ac.in` | `Horizon!Student2026` |
| Recruiter (Meridian Arc Consulting, verified) | `talent@meridianarc.example` | `Horizon!Recruiter2026` |
| Administrator | `admin@horizon.example` | `Horizon!Admin2026` |
| Student awaiting manual verification | `kabir.pending@example.org` | `Horizon!Pending2026` |
| Recruiter awaiting verification | `daniel@harbourline.example` | `Horizon!Pending2026` |

Two more approved demo students (`arjun.demo@iitb.ac.in`, `sara.demo@nitt.edu`) use the student password. These credentials exist **only** in development: they come from `SEED_*` variables (see `.env.example`), are shown on the login page only when `NODE_ENV=development`, and the seed script refuses to run in production.

### CAPTCHA in development

Login, registration and guest grievances are protected by **Cloudflare Turnstile**, verified on the server through Cloudflare's Siteverify endpoint.

- **Default:** Turnstile with Cloudflare's official *test* keys — the widget appears and always passes. Needs internet access to `challenges.cloudflare.com`.
- **Offline:** set `CAPTCHA_PROVIDER=dev-bypass` (in `.env` or the shell). The form shows a labelled "Development CAPTCHA" checkbox whose fixed token is still checked **on the server**. This mode is refused when `NODE_ENV=production`.

### Email in development

Without SMTP settings, emails (verification codes, grievance receipts) are printed to the server console and shown in a **development mailbox** on the verification page. Add `SMTP_*` variables to send real mail.

### Useful commands

| Command | What it does |
|---|---|
| `npm run dev` | Start with auto-restart on server changes |
| `npm start` | Start without the file watcher |
| `npm run db:migrate` | Create / update the schema |
| `npm run db:seed` | Load demo data into an empty database |
| `npm run db:reset` | Delete the database **and private uploads**, then migrate and seed |
| `npm run admin:create` | Production bootstrap: reference data + first administrator (no demo data) |
| `npm test` | 104 automated tests (registration, CAPTCHA, login, access control, search, saving, tracker, reply clock and next actions, CV/video validation, admin CRUD, grievances, rate limiting, headers) |
| `npm run test:node-sqlite` | The same tests on Node's built-in SQLite driver |

---

## What's in it

### Students (`/app`)
- **Registration & verification:** institutional email + 6-digit code. If the email domain is confirmed for the chosen INI, the account is approved automatically; otherwise the student uploads an ID for administrator review. Only verified INIs (Ministry of Education list) can be selected.
- **Dashboard:** greeting, profile strength, live counts, explainable recommendations, upcoming deadlines (listing deadlines, personal deadlines, interviews), saved listings, application progress, destinations.
- **Explore internships:** server-side keyword search, filters (country, industry, organisation type, work mode, visa sponsorship, paid/unpaid, compensation range with an indicative USD equivalent, duration, deadline, level, year, application method), sorting, pagination; filters live in the URL.
- **Listing details:** full description, eligibility, compensation, visa/relocation/accommodation support, source and last-verified date, no-fee confirmation, the organisation's response rate, save/track/apply/report.
- **Apply on HORIZON** (verified organisations only) with a validated CV, optional approved video and explicit consent — or track an external application. HORIZON never submits applications on anyone's behalf; external listings link to the employer.
- **Application tracker:** Kanban board (drag and drop, plus a keyboard-accessible "Move to" control) and list view; dates, interview times, next actions, notes and full history. HORIZON applications are updated by the recruiter and can be withdrawn.
- **Profile:** academic details, skills, interests, languages, preferences, experience, links; **CV upload with a validation report**; **video resume** upload or in-browser recording (≤120 s).
- **Global destinations** (admin-managed country guides with official sources and dates), **career resources**, **notifications**, **grievance desk**.

### Recruiters (`/recruiter`)
- Work-email registration (personal email providers refused; for an existing organisation the email domain must match it, for a new one it is checked against the official website) + authorisation document; approval only once the organisation is verified.
- Dashboard with overdue-response alerts and a public response rate; listings (post, edit, drafts, review status and reviewer notes, no-fee pledge); applicants per listing or across the organisation; applicant view with profile, cover note, CV and its validation report, approved video, history, status updates (interview time required; **a reason is required to decline**), private notes; organisation profile; personal profile with intro video; grievances concerning the organisation with a right to reply.

### Administrators (`/admin`)
- Overview with queues; manage internships (review/publish/send back with a note, feature, mark verified, archive, archive all expired, delete — listings with applications are archived instead); add/edit listings with source link and last-verified date.
- Students and recruiters (search, filter, approve, reject, suspend with reason — suspension ends active sessions), verification requests with automatic checks and the uploaded proof, institutions (with official source and confirmed email domains; deactivate rather than delete), organisations, document reviews (flagged CVs, video moderation), global resources, the grievance desk (status, messages to the complainant or both parties, internal notes, priority, assignment, request the organisation's response, resolution summary), reports, and an audit log.

### Grievance redressal
Ticket number on submission (signed in, or as a guest with CAPTCHA and a private tracking key) · 24-hour acknowledgement and 15-day resolution targets (72 hours for fee demands and harassment) · the organisation is asked for its side before a decision · Level 2 escalation to the Grievance Officer when a deadline passes or within 30 days of a decision · reopen within 7 days · rating · public **transparency report** with aggregates only (`/transparency`). The timelines mirror India's IT Rules, 2021 for intermediaries.

---

## Database

SQLite (`data/horizon.db`), schema in `server/db/migrations/001_initial.sql`. Timestamps are stored in UTC.

| Area | Tables |
|---|---|
| Eligibility | `institutions` (official recognition reference + source link, verified/unverified, active), `institution_domains` (confirmed email domains) |
| People | `users` (role student/recruiter/admin, status pending/approved/rejected/suspended, email verification, lockout), `student_profiles`, `recruiter_profiles`, `organisations` (domain, website, registration, verification) |
| Verification | `email_verifications` (hashed one-time codes), `verification_requests` (proof document, automatic checks, decision, internal note, message to user) |
| Documents | `documents` — CVs, videos, ID/organisation proofs, grievance evidence; stored privately under `storage/` with random names, served only through an authorisation check; holds the validation report and review status |
| Opportunities | `opportunities` (source, last verified, no-fee pledge, status, demo flag, application mode), `skills`, `opportunity_skills`, `saved_opportunities` |
| Applications | `applications` (one per student and listing; channel external/HORIZON; student stage and recruiter status; snapshots so history survives archiving), `application_events` |
| Content | `destination_resources` (official links, source URL, last-updated date) |
| Redressal | `grievances` (SLA due dates, level, respondent organisation, access-key hash), `grievance_events` (visibility: complainant / parties / internal) |
| Platform | `notifications`, `email_outbox`, `audit_logs`, `sessions` |

---

## Security notes
- Passwords hashed with bcrypt; account lockout after repeated failures; per-IP rate limits on login, registration, codes, uploads and grievance tracking.
- Session cookie is `HttpOnly`, `SameSite=Lax` and `Secure` in production; the session ID is regenerated at login; synchronizer-token CSRF protection plus an Origin check on every state-changing request.
- Every API route enforces role and approval on the server — calling an admin URL as a student returns 403, and the admin pages redirect.
- CAPTCHA tokens are always verified server-side; secrets live only in environment variables.
- Uploads are checked by file contents (magic bytes), size-limited, renamed, stored outside the public folder and never exposed through public URLs; CVs reach only the organisations a student applied to.
- Helmet security headers with a strict Content-Security-Policy; output is escaped by default in the front end.
- Production start-up refuses: missing/short `SESSION_SECRET`, `dev-bypass` CAPTCHA, Cloudflare test keys, `SEED_ON_START=true`, `DEV_MAILBOX=true`.

---

## Going live — configuration still required

1. **Environment:** `NODE_ENV=production`, a random `SESSION_SECRET` (≥32 chars), `APP_URL`, `HOST=0.0.0.0` if needed, `TRUST_PROXY` behind a proxy, HTTPS at the proxy.
2. **Cloudflare Turnstile:** create a widget for your domain and set `TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`.
3. **Email:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` (with SPF/DKIM on your domain); `DEV_MAILBOX=false`.
4. **First administrator:** `ADMIN_EMAIL=… ADMIN_PASSWORD='…' ADMIN_NAME='…' npm run admin:create` — loads the institution list and destination guides, never demo data. Keep `SEED_ON_START=false`.
5. **Grievance Officer:** publish a real name and email (`GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`).
6. **Institutions:** the list was taken from the Ministry of Education's INI page on 18 Nov 2026 (https://www.education.gov.in/en/node/198). Re-check it, confirm each email domain with the institution before marking it verified, and add domains for the rest (until then their students go through ID review).
7. **Destination guides:** review each against its official source and update the "last updated" date.
8. **Listings:** add genuine opportunities from **Manage Internships → Add internship** with the original source link and the date you verified it, or let verified recruiters post them for review.
9. **Legal:** have the Terms and Privacy Policy reviewed (including India's Digital Personal Data Protection Act, 2023) and set data-retention periods.
10. **Operations:** back up `data/` and `storage/` together; for multiple servers move uploads to private object storage and the database to a managed server.

---

## Project structure

```
server/
  app.js, index.js, config.js      Express app, start-up, configuration and production safety checks
  db/                              driver wrapper (better-sqlite3 or node:sqlite), migrations, reference data, demo seed
  middleware/                      authentication guards, security headers, CSRF, rate limits
  routes/                          auth, public, opportunities, student, profile, directory, recruiter, admin, grievances
  services/                        CAPTCHA, CV validation, video inspection, files, grievances, events/notifications
public/
  index.html, login.html, …        public pages
  app.html + js/app/               single-page workspaces for students, recruiters and administrators
  js/lib/, css/, fonts/, img/      shared UI library, design system, Inter font
scripts/create-admin.js            production bootstrap
tests/                             node:test + supertest suites
docs/PAIN_POINTS.md                research behind the design
```

## Known limitations
- Recruiter updates reach students on the next page load plus a notification — there is no live push or chat.
- Compensation conversion to USD uses a fixed, indicative rate table for sorting and filtering only.
- Video moderation and manual CV/ID verification depend on administrators' review capacity.
- Response-rate badges appear only after enough applications pass the 14-day window.
- SQLite and local disk storage suit a single server; see "Going live" for scaling.
