# Changelog

All instructor-visible changes. SQLite-only, zero new prerequisites — every entry
preserves the SQLite setup and locked npm dependencies.

## Unreleased (submission handoff: week-5 ops doc, README handoff, deploy blueprint)

- New `docs/week5-release-operations.md`: remote target, config/secrets table,
  release gate, health/logs monitoring, failure+recovery procedure, final smoke.
- README is now a handoff surface: Live App (URL, demo access, critical
  journey), Operations (health, logs, recovery, release gate), full docs tree
  and week-by-week evidence map.
- New `render.yaml` + `DEPLOY.md`: one-blueprint Render deploy, cold-start and
  ephemeral-data honesty notes, troubleshooting.

## Unreleased (AI resolution reliability and assistant foundation)

- Fixed Groq JSON-mode resolution drafting by requiring JSON explicitly in the
  provider prompt; increased the playbook timeout to ten seconds.
- Groq resolution failures now degrade to a clearly labeled local `[Confirm]`
  template instead of returning a 503; no-key and provider-failure paths are
  covered offline.
- Added authenticated `POST /ai/chat` with caller-scoped reads, bounded tool
  execution, confirmation-gated writes, injection refusal, audit events, and
  SQLite-backed chat history. The Overview assistant now uses this endpoint
  when configured and remains honest/local without a key.

## Unreleased (queue, trust, and onboarding polish)

**Finish pass: contrast, touch, states, demo docs**
- Success green darkened to `#15803d` (WCAG AA on fills, alerts, and badges).
- Minimum 24px touch targets on filters, board titles, and remove buttons;
  board move buttons stay visible on touch devices.
- Audit search shows errors and no-results explicitly; overview has a skeleton.
- Request form enforces backend length caps with live counters; DEMO documents
  the keyboard-only and narrow-screen paths.

**Dialog and readability fixes**
- Modal dialogs no longer steal focus while typing; the first field is focused
  once on open (fixes resolution notes, takeover/reroute reasons, MFA disable).
- Ticket detail shows only the human `REQ-XXXXXX` reference; the raw database
  ID is no longer displayed.
- The `claimed` queue tab is now labeled "My History" with per-tab captions
  explaining My Work (open workload) vs history (including completed).

**Queue workflow**
- Department Queue is clearly grouped; list/board and sorting preferences persist.
- Search, status, quick filters, and sorting can be cleared or removed individually;
  result counts make filtered queues easier to understand.
- Kanban cards support keyboard status actions as well as drag-and-drop.

**Trust and admin safety**
- Staff-only notes and activity are labeled as private to staff.
- Confirmations protect takeover, rerouting, user deactivation, and MFA disable.
- Admin loading and empty search results are explicit instead of silent.

**Instructor setup**
- The documented Node.js range matches the current Vite toolchain and CI.
- Quick Start uses locked installs and gives correct environment-file copy commands
  for macOS, Linux, PowerShell, and Command Prompt.

## Unreleased (gaps pass — 90 backend + 10 frontend tests, 9 AI evals)

**Zero-config safety**
- Node.js engine requirement documented in both manifests; `npm run verify` is the
  single pre-push gate.
- `PORT` honored by the API; Vite auto-picks a free port if 5173 is busy.
- `npm run db:doctor` read-only health check; README troubleshooting box.
- Seed holds exactly 3 users (alice, bob, admin); e2e self-provisions its stranger.

**Code health**
- Real lint: backend flat config + frontend `ts/tsx` coverage (was `echo` / `js-only`).
  Fixed 31 backend + 10 frontend findings (dead vars, require-imports, format
  helper extraction, modal focus trap, QuickSwitcher handler, wall-clock purity notes).
- `scripts/test-count.ts` + CI `--check`: README counts can never drift again.

**Uploads**
- 50MB/user quota (`UPLOAD_QUOTA_BYTES`), sanitized download filenames,
  20/min upload throttle, boot + daily purge with `/health.retention`,
  malware-scan seam for week-5.

**Throttling**
- Limits on password change, user creation, AI draft; `trust proxy` (1 hop);
  `THROTTLE_STORE` Redis seam documented; all knobs in `.env.example`.

**Frontend proof + access**
- Vitest: 10 unit tests (`formatEnum`, `toRef`, `formatDateTime`); CI runs them.
- Charts carry text summaries + table fallbacks + `role=img` labels.
- `strings/en.ts` foundation (AppShell migrated), `dir="ltr"`, Intl dates.

## Unreleased (this push — 90 tests, 9 AI evals)

**Trustworthy core**
- Deactivated users lose API access immediately (`JwtStrategy` checks `active` per request).
- Error shape identical everywhere: `HttpExceptionFilter` registered as `APP_FILTER` so e2e, tests, and prod return `{ statusCode, message, requestId, timestamp }`.
- Queue: real DB `skip/take` on orderable views, `claimedBy=me|unassigned|<id>` filter, in-memory priority sort preserved for URGENT-first order.
- Slow-route signal: `SLOW_LOG_MS` (default 1000ms) WARN line with correlation ID.

**Employee experience**
- New-request draft persists in `localStorage`, cleared on submit.
- Creating opens the ticket detail: reference `REQ-XXXXXX`, tracker (Submitted → Assigned → In Progress → Resolved), and what-happens-next for owners.
- Attachments upload with real progress bar (`XMLHttpRequest`, `role=progressbar`).

**AI depth**
- Every draft returns `promptVersion` + `trace { matchedKeywords, rationale }`; UI shows “Why this classification?”.
- New `GET /ai/health` (provider, model, prompt version, key-present, last error).
- New `POST /requests/:id/ai-correction` stored as `AI_CORRECTION` audit with corrected codes; visible in Activity Timeline.
- Eval `every draft carries prompt version + why-trace` (9/9 pass).

**Admin analytics**
- New `GET /requests/analytics`: avg claim/resolve hours, rejection/reroute rates, aging buckets, top-10 workload-by-agent.
- New `GET /audit` (admin): actor/action/requestId/from/to/limit search, 200 cap.
- `GET /requests/export` honors `?status=&departmentId=&priority=`; admin UI adds matching filters.
- Admin UI: user search, audit search, analytics cards, password field is `type=password`.

**A11y + perf**
- Modal focus trap + restore; `Tabs` use `role=tablist/tab` + `aria-selected`.
- Queue search debounced 300ms; filter/highlight run on settled input.
- `Dashboard`, `AdminPanel`, `MfaSettings` lazy-loaded with skeleton fallback.
- `index.html`: real title, description, theme-color, font preconnect; `index.css` no longer render-blocks on Google Fonts.

**Proof**
- E2E: deactivation invalidation, claimedBy matrix, analytics/audit/export/AI-health/correction coverage, correlation IDs.
- CI: backend build, `prisma validate`, `npm audit`, corrected test count.
