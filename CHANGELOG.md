# Changelog

## 2026-11-19 — "Quiet authority" redesign and the accountability clock

No new dependencies, no schema changes (`001_initial.sql` untouched, no new migration), no change to CSRF, sessions, role guards, rate limits, CAPTCHA, verification or grievance policy logic. Every new API field is computed at read time and only returned to users already entitled to the underlying data. Demo data stays labelled.

Tests: 88 → 104 (`npm test` and `npm run test:node-sqlite` both pass).

### Phase 0 — Audit
- Captured the original build at 1440/1024/768/430/390/360 px in headless Chrome (144 screens), recorded 88/88 passing tests and computed WCAG contrast for 31 colour pairs (15 failed).
- Reproduced the mobile banner defect. It is the desktop row layout applied at phone width: the `nowrap` button cannot shrink, the text block collapses to three lines, and `.welcome { overflow: hidden }` silently clips the button. Production served unversioned CSS with `max-age=3600`, so a cached stylesheet produces exactly the reported screenshot. A second cause appeared during the work: a column flex container with `flex-wrap: wrap` sizes each line to its widest item's max-content.

### Phase 1 — Design system and app shell
- `public/css/horizon.css`
  - New tokens: spacing (`--space-*`), type (`--fs-*`), z-index (`--z-*`), `--text-muted` / `--text-subtle` (with `--text-2` / `--text-3` as aliases), `--border-input`, `--text-placeholder` and text-strength shades (`--teal-700`, `--gold-700`, `--success-700`, `--warning-700`, `--error-700`). Palette values unchanged.
  - All hard-coded z-indexes replaced by the scale. Every font weight is now a loaded weight (650/750/800/550 → 600/700/500); headings use 600.
  - Contrast fixes made at the token level (see table below).
  - Cards: flat (border) by default, raised (shadow) on interactive hover; no border-plus-shadow pairs. Card padding follows the scale (24 desktop, 16 mobile).
  - `.badge-quiet` for low-priority status; gold badges removed from cards (gold is one accent per screen); teal reserved for verification.
  - Forms: darker 3:1 input borders, 4.5:1 placeholders, errors with an icon and text, 44 px inputs on phones (16 px text, so iOS does not zoom).
  - Buttons and controls: 44 × 44 px hit areas on phones via a pseudo-element, without changing the drawn size of compact controls.
  - Tables: pinned header rows (`.table-wrap.is-long`), and `.show-sm` secondary lines so hidden columns stay readable on phones.
  - Empty states use the horizon mark; branded loader; skeletons matched to the dashboard, card grid and detail layouts.
  - Utility classes (`gap-*`, `rel`, `no-underline`, `text-body`, `label-caps`, `video-frame`, …) replacing repeated inline styles.
  - Root-cause layout fixes: single-column grids use `minmax(0, 1fr)` (a plain `1fr` grows to a child's min-content, which overflowed at 320 px); banner buttons may shrink and wrap; the phone banner is a single-line column flex container.
  - Removed 15 provably unused rules (`.btn-teal`, `.card-footer`, `.otp`, `.divider-dot`, `.dot`, `.nav-count`, `.sk-card` and others).
- `public/js/app/main.js` — grouped student sidebar (Discover / Track / Plan / Account; `NAV` items may now include `{ group }`); phone top bar shows a back link and the page title only; student bottom navigation (Overview, Explore, Applications, Saved, Profile) with a gold indicator and safe-area padding; Back/Forward restores scroll while new pages start at the top; 160 ms view fade-in (off under reduced motion); in-page `#anchors` scroll and focus without re-rendering; sidebar drawer traps focus and closes on Escape; notifications panel grouped by day with unread markers; boot errors offer Retry; pages outside the navigation no longer mark Overview as current.
- `public/js/lib/ui.js` — `empty()` with the horizon motif and a compact variant, `errorState()` with a Retry button, `brandLoader()`, `skeletonDashboard()`, `skeletonDetail()`, layout-matched card skeletons.
- `public/js/lib/format.js` — `dayGroup()` and `relativeDay()`.
- `public/js/lib/icons.js` — `eyeOff` icon (same 24 × 24 line style).
- `public/js/lib/validate.js` — help text joins `aria-describedby`; fields validate on blur once touched.
- `public/js/lib/combobox.js` — `aria-selected` on the active option and a labelled listbox.
- All HTML pages — `theme-color` and `color-scheme` meta tags; versioned stylesheet URLs (`?v=2026.11.2`) so a deploy cannot pair new markup with a cached stylesheet. `app.html` — `viewport-fit=cover` and a branded initial loader.

### Phase 2 — Dashboard, accountability clock, trust surfacing
- `server/services/applications.js` (new) — the single home of two rules:
  - `responseClock(row)` → `respondBy`, `daysToRespond`, `responseOverdue` for submitted HORIZON applications that have no first response and are not withdrawn (nulls otherwise).
  - `nextActions({ apps, cv })` → up to three `{ type, priority, title, subtitle, href, dueAt }`, ranked interview within 72 h > reply overdue > listing deadline within 7 days > personal deadline within 7 days > interview within 14 days > CV blocker. Ties break by earliest `dueAt`; one action per application.
- `server/routes/student.js` — `serializeApp` adds the clock fields; `/api/dashboard` adds `nextActions`, `awaitingReply` (count, overdue count and the nearest due application) and `containsDemoData`. Existing fields kept.
- `server/routes/opportunities.js` — the student's `detail.application` gains `submittedAt`, `firstResponseAt` and the clock fields (same helper); `/filters` adds `containsDemoData`.
- `server/routes/recruiter.js` — the recruiter's `overdue` now uses the same helper as the student, so both sides see "Overdue" at the same moment; adds `respondBy`, `daysToRespond` and a `repliesDue` queue (oldest first) on the dashboard.
- `server/services/opportunities.js` — organisation `verifiedAt` on listing detail (already public on the organisation page).
- `server/db/seed.js` — one more illustrative application for the demo student (a HORIZON application to an existing fictional listing, four days old, no reply yet) so the reply clock is visible in her workspace. No new organisations or listings.
- `tests/accountability.test.js` (new, 16 tests) — inside the window, exactly at the end of the window, overdue, answered, withdrawn, external; the API on the tracker, the opportunity page and the recruiter side; next-actions ranking, ties, limit, empty and CV-blocker cases; recruiters and administrators get 403 / no student-only fields; students only see their own applications.
- `public/js/lib/components.js` — `respondClock()` (replied / waiting / last three days / overdue with "Raise this with HORIZON" pre-selecting the existing "No response" grievance category; a thin horizon line with a gold sun travelling from Applied to Due; text equivalent for screen readers); `replyChip()` for recruiter lists; `trustStrip()`; `oppCard()` decluttered (four facts, at most two badges, quiet "Verified · date" marker, corner "Demo" label, match reasons inside the card, stipend as the largest text); one dismissible demo notice; `grievanceLink()`; `checkSummary()`.
- `public/js/app/views/student-dashboard.js` — compact greeting with one gold call to action ("Explore 16 open internships"), Next up card, reply strip, slim profile bar, four tiles (Saved, Applied, Interviews, Offers), two-column body that re-orders on phones; pipeline stages link to `/app/applications?stage=`.

### Phase 3 — Explore, opportunity detail, tracker
- `public/js/app/views/explore.js` — quick filter chips (Paid, Visa sponsored, Remote, Closing within 30 days, Apply on HORIZON) with `aria-pressed`; collapsible filter groups (first three open on desktop) showing six options by count plus "Show more"; country search; results count (live region) and sort pinned under the top bar on desktop; phone drawer with an active-filter count, focus trap, Escape, backdrop and a sticky "Show N results" / "Clear all" footer; no-results state names the filter whose removal brings back the most results. URL state and server-side filtering unchanged.
- `public/js/app/views/opportunity.js` — hero order: organisation, title, chips, trust strip, summary, actions; one primary, one secondary, one tertiary action; on phones the facts and trust panel come before the description and the primary action sits in a sticky bar once the in-page button scrolls away; "What happens after you apply" timeline for HORIZON listings; applied note states the reply date and shows the clock.
- `public/js/app/views/applications.js` — desktop board: six open stages plus one collapsible "Closed (n)" column; summary tiles jump to their column (or filter the list view); phones: stage tablist with counts (arrow keys, `?stage=` honoured and updated) and one stage at a time; cards show the reply clock and interview time; details drawer (full-screen on phones) shows history before notes; list view gains the clock and phone secondary lines.

### Phase 4 — Landing and authentication
- `public/index.html` — exact hero copy and calls to action; Open Graph and Twitter tags (local only; no canonical because `APP_URL` is not available to static HTML; no image); new "What ‘nothing disappears’ looks like" section with an illustrative timeline; Platform benefits merged into About; industries folded into destinations; ivory/white alternation; inline styles removed.
- `public/js/pages/landing.js` — four measurable promises (14 days and 24 hours read from `/api/config`); illustrative example card; neutral problem labels with the fix made primary; featured listings use the new card (three on phones).
- `public/css/site.css` — 72/48 px section rhythm, hero and promise strip, map height on phones, static arcs under reduced motion, labelled step indicator, token weights, contrast, 320 px header, `minmax(0, 1fr)` auth grid.
- `public/js/lib/site.js` — mobile menu traps focus, closes on Escape and on link click; shorter call to action under 400 px.
- `public/js/pages/auth-common.js`, `login.js`, `register.js`, `verify.js`, `public/login.html`, `public/js/lib/captcha.js` — the same three promises on every auth aside; icon show/hide password button with `aria-label` and `aria-pressed`; labelled step indicator (Create account → Confirm email → Verify enrolment/organisation) with `aria-current`; resend-code cooldown announced in a live region (server limits unchanged); no exclamation marks. CAPTCHA and demo-credentials behaviour unchanged.
- `public/404.html`, `public/error.html` — skip link, horizon motif and three next actions.

### Phase 5 — Secondary screens
- `profile.js` — Academic, Skills and interests, Preferences, Experience, Links and Documents cards; sticky "On this page" index and completion on desktop; CV report leads with "N passed · N suggestions"; recorder limits unchanged.
- `notifications.js` — grouped by Today / Yesterday / Earlier, unread dots, "Mark all read".
- `destinations.js`, `resources.js` — "Last updated" and "Official source" chips on every destination guide; resource anchors now scroll in place.
- `shared/grievance-ui.js`, `grievances.js`, `grievance-public.js`, `grievance.html`, `transparency.js` — ticket number and current stage first; external avenues kept; heading order fixed; phone secondary lines in lists.
- `recruiter-dashboard.js`, `applicants.js`, `applicant-detail.js` — "Replies due" is the top card (oldest first, overdue in error tone, "Open applicant"); "Reply due" / "Overdue" wording matches the student.
- `admin-overview.js` — four queue tiles (verifications, document reviews, grievances overdue, listings pending review) linking to filtered lists; admin list views pin their header row.
- `organisation.js` — four trust tiles: verification, verified date, response rate, average first response.
- `saved.js`, `listing-form.js`, `admin-*.js`, `shared.js` — inline-style clean-up only (no behaviour change).

### Phase 6 — Accessibility, QA
- One `<h1>` per view and no skipped heading levels on 24 audited pages; no unnamed buttons/links, unlabelled inputs, duplicate IDs or images without `alt`.
- 210 screenshots (30 screens × 1440/1024/768/430/390/360/320 px): no horizontal overflow, no console errors, no CSP violations.
- 34 scripted interaction checks pass (drawer focus trap and Escape, quick filters, tracker tabs and `?stage=`, drag and drop, keyboard "Move to", drawer order, Back scroll restore, trust-strip anchors, overdue clock to pre-filled grievance, sticky action bar, mobile menu, password toggle, reduced motion).
- `README.md` — test count.

### Contrast (WCAG 2.2 AA; text 4.5:1, UI components 3:1)

| Pair | Before | Ratio | After | Ratio | Needs |
|---|---|---|---|---|---|
| Secondary text (`--text-2` → `--text-muted`) on ivory | #5D6A77 | 5.08:1 ✓ | #535F6B | 5.99:1 ✓ | 4.5:1 |
| Tertiary text (`--text-3` → `--text-subtle`) on ivory | #6F7B87 | 3.97:1 ✗ | #5F6B77 | 5.00:1 ✓ | 4.5:1 |
| Tertiary text on white | #6F7B87 | 4.32:1 ✗ | #5F6B77 | 5.45:1 ✓ | 4.5:1 |
| Tertiary text on `--surface-2` | #6F7B87 | 3.95:1 ✗ | #5F6B77 | 4.98:1 ✓ | 4.5:1 |
| `.stat-meta` on white | #6F7B87 | 4.32:1 ✗ | #5F6B77 | 5.45:1 ✓ | 4.5:1 |
| Input placeholder on white | #9AA5B0 | 2.51:1 ✗ | #6B7682 | 4.63:1 ✓ | 4.5:1 |
| Input border on white (UI component) | #D3D9DF | 1.42:1 ✗ | #85919D | 3.21:1 ✓ | 3.0:1 |
| Switch track, off (UI component) | #D3D9DF | 1.42:1 ✗ | #85919D | 3.21:1 ✓ | 3.0:1 |
| `.badge-gold` text on `--gold-50` | #9A6418 | 4.53:1 ✓ | #835310 | 5.94:1 ✓ | 4.5:1 |
| `.badge-demo` text on #FFF7E8 | #8A5A12 | 5.55:1 ✓ | #7A4F0F | 6.68:1 ✓ | 4.5:1 |
| `.eyebrow` teal on ivory | #397D78 | 4.40:1 ✗ | #2E6965 | 5.80:1 ✓ | 4.5:1 |
| Links (teal) on ivory | #397D78 | 4.40:1 ✗ | #2E6965 | 5.80:1 ✓ | 4.5:1 |
| `.badge-teal` on `--teal-50` | #397D78 | 4.20:1 ✗ | #2E6965 | 5.53:1 ✓ | 4.5:1 |
| `.badge-success` on `--success-50` | #23865B | 4.01:1 ✗ | #1C6E4A | 5.50:1 ✓ | 4.5:1 |
| `.badge-warning` on `--warning-50` | #9A6A1E | 4.25:1 ✗ | #8A5D17 | 5.17:1 ✓ | 4.5:1 |
| `.badge-error` on `--error-50` | #C84C4C | 4.01:1 ✗ | #A93B3B | 5.46:1 ✓ | 4.5:1 |
| `.stage-withdrawn` on #F1F3F5 | #8794A1 | 2.78:1 ✗ | #5F6B77 | 4.90:1 ✓ | 4.5:1 |
| `.oc-deadline.soon` on white | #9A6A1E | 4.71:1 ✓ | #8A5D17 | 5.74:1 ✓ | 4.5:1 |
| `.field-error` on white | #C84C4C | 4.57:1 ✓ | #A93B3B | 6.22:1 ✓ | 4.5:1 |
| `.sidebar-role` / group labels on navy | #7F93A8 | 4.97:1 ✓ | #9AACBF | 6.76:1 ✓ | 4.5:1 |
| `.nav-link .icon` on navy (UI) | #8FA3B8 | 6.06:1 ✓ | #9AACBF | 6.76:1 ✓ | 3.0:1 |
| Footer text on #0C1B2C | #93A5B8 | 6.88:1 ✓ | #A3B3C4 | 8.11:1 ✓ | 4.5:1 |
| `.btn-accent` navy on gold (unchanged) | #10243A | 6.46:1 ✓ | #10243A | 6.46:1 ✓ | 4.5:1 |
| Reply clock, waiting (new) on white | — | — | #2E6965 | 6.32:1 ✓ | 4.5:1 |
| Reply clock, ≤ 3 days (new) on white | — | — | #8A5D17 | 5.74:1 ✓ | 4.5:1 |
| Reply clock, overdue (new) on white | — | — | #A93B3B | 6.22:1 ✓ | 4.5:1 |
| Bottom nav, inactive (new) on white | — | — | #5F6B77 | 5.45:1 ✓ | 4.5:1 |
| Breadcrumb separator (decorative, `aria-hidden`, exempt) | #B7C0C9 | 1.69:1 | #B7C0C9 | 1.69:1 | — |
