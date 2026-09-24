# Changelog

All instructor-visible changes. SQLite-only, zero new prerequisites — every entry
preserves `cp .env.example .env && npm install && npm run db:reset`.

## Unreleased (gaps pass — 90 backend + 10 frontend tests, 9 AI evals)

**Zero-config safety**
- `engines: node>=18` (root + frontend), `npm run verify` single pre-push gate.
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
