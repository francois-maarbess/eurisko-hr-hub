# Changelog

All instructor-visible changes. SQLite-only, zero new prerequisites — every entry
preserves the SQLite setup and locked npm dependencies.

## Unreleased (assistant reliability, draft UX, chat persistence, docs sync)

- Assistant proposals queue per session: multi-step jobs ("create two
  requests") advance one confirmation at a time, auto-presenting the next —
  saying two no longer files one. Legacy single-object rows still confirm.
- Draft-with-AI never clobbers: a low-confidence second result keeps the good
  draft and says so; the offline scorer routes explicit onboarding words and
  multi-department signals high with a workflow (pinned by an eval using the
  exact onboarding sentence). Review step lists every cross-department task
  about to be filed, with a task-counted submit button.
- Assistant window persists across views and reloads (always-mounted shell +
  stored session id, cleared on logout); confirming a step picks up the next
  pending confirmation instead of dropping it.
- Trace popover shows friendly provider names (Offline/AI assistant);
  login card is back to "Sign in with your company email".
- Docs re-synced to the code: 139 backend / 10 frontend / 14 evals with a
  recomputed per-file breakdown, week-4 fallback emphasis plus a worked
  parent/child example with test steps, and an Academy scope map in
  architecture.md so production-target wording (SSO, Firebase, mobile)
  reads as the defense asset it is.

## Unreleased (smart assistant, password session revoke, dark mode, docs)

- Assistant brain upgrade: tools are always on (a keyword gate once locked the
  model out of proposing on paraphrased asks), local intent hint
  (chit-chat/act/sensitive) asserted offline, 60s catalog cache, trimmed
  8-message history, no client auto-retry, timeouts named distinctly from
  rate limits. New tools: owner-cancel proposals, agent workload, inbox
  summary. Passwords/secrets are never accepted in chat — the assistant routes
  to Security settings and starts 2FA setup server-side. Evals grow 9 → 13
  (`npm run eval:ai`), including the exact transcript lines that used to fail.
- Password changes now revoke every session: the app bounces to login with
  "sign in with your new password". Security view is Account + Change
  password + two-factor, with sign-out-everywhere. Covered by a revoke test.
- Dark mode (navy slate, opt-in, light always default): full token system,
  header/login toggle with system follow, dimmed action blue, chatbot and
  dashboard contrast sweep. Ticket cards de-densified (clamped descriptions,
  More menu, filter popover) and New Request is a 4-step stepper.
- Docs: `NOTIFY_WEBHOOK_URL` documented in `.env.example` (outbox POSTs JSON
  with `X-Idempotency-Key`, backoff then dead-letter; unset = local inbox
  only). Week-4 assistant doc and week-5 release gate re-synced to 137
  backend tests / 13 evals.

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
