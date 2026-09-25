# Week 5 — Release Operations

How this app runs in production, how we know it is healthy, and how it
recovers when something breaks. Everything below describes behavior that
exists and is verified — not aspirations.

## 1. Remote target

- **Backend:** Node 22 web service. Build: install with dev dependencies,
  `prisma generate`, `nest build`. Start: `prisma migrate deploy`, then
  `prisma/seed.ts` (idempotent upserts — safe to run on every boot), then
  `node dist/main.js`. Listens on `PORT` (Render injects it).
- **Frontend:** static site. Build `npm ci && npm run build` inside
  `frontend/`, publish `dist/`, with `VITE_API_BASE` pointing at the backend
  URL (baked in at build time — changing it requires a rebuild).
- Both services are declared in `render.yaml` at the repo root so a fresh
  deploy is one blueprint apply, not dashboard archaeology.

## 2. Configuration and secrets

| Variable | Where | Required in prod? | Notes |
|---|---|---|---|
| `DATABASE_URL` | backend env | yes | `file:./dev.db`-style SQLite path on the instance |
| `JWT_SECRET` | backend env | yes | Generated random value. The `week3-dev-secret` fallback exists for local clones only; production refuses to boot without a real secret (`src/main.ts`, `NODE_ENV=production` guard) |
| `GROQ_API_KEY` | backend env | no | Free key. Absent = offline extractor + template drafts; documented in `docs/week4-production-ai.md` |
| `GROQ_MODEL` | backend env | no | Defaults to a pinned model id; override without a code change if Groq retires it |
| `CORS_ORIGINS` | backend env | yes | Comma-separated frontend URL(s). Empty reflects any origin — local-dev only |
| `TRUST_PROXY` | backend env | yes | `1` behind Render/Nginx so throttling sees real client IPs |
| `VITE_API_BASE` | frontend build env | yes | Backend URL, baked into the bundle at build time |
| `PORT` / `VITE_PORT` | platform / local | platform | Backend honors `PORT`; frontend dev auto-picks a free port |

The real `.env` is gitignored and has never been committed. `.env.example`
documents every variable above. Throttle, quota, TTL, and retention knobs are
all env-overridable with safe local defaults (see `.env.example`).

## 3. Release gate (must ALL pass before any submit or deploy)

1. `npm run verify` exits 0 (typecheck, both lints with zero warnings,
    137 backend tests, 13 AI evals, both builds).
2. `cd frontend && npm test` — 10 vitest suites green.
3. `npm run test:count -- --check` passes with README counts synced.
4. CI on the pushed branch is green (typecheck, lint ×2, tests, evals,
   builds, count check).
5. `npm run db:doctor` reports 3 users, 0 requests on a fresh reset.

## 4. Health, logs, monitoring

- `GET /health` returns `status` (`ok`/`degraded`), `database`, migration
  `{applied, pending}`, outbox `{pending, failed}`, retention sweep state,
  AI `{provider, model, lastErrorAt, lastErrorMessage}`, version and uptime.
  It returns **503** when the database is unreachable or migrations are
  pending, so the platform restarts or alerts instead of serving a
  half-working app. No secrets, keys, or connection strings are ever
  included — status words and counts only.
- `GET /ai/health` (auth) adds `keyPresent` for AI debugging without
  exposing the key.
- Every request logs one line (`method path status ms`) with an
  `x-request-id` echoed back on the response and inside error bodies, so one
  ID traces a failure end to end. Routes slower than `SLOW_LOG_MS`
  (default 1000ms) log a WARN line.
- There is no paid observability and none is required: health + logs +
  CI is the monitoring story, sized to a free-tier deployment.

## 5. Failure and recovery (demonstrated, not claimed)

Known failure modes and the designed response:

| Failure | Detection | Recovery |
|---|---|---|
| Container restart / ephemeral disk wipe | `/health` 503 or fresh empty DB | Boot chain runs migrations + idempotent seed: 3 users + catalog rebuilt automatically. Tickets do not auto-reappear — documented, not hidden (see ephemeral note in `DEPLOY.md`) |
| Database unreachable | `/health` 503, error log with request id | Platform restarts the service; mutations fail closed (503, never silent success) |
| Groq down / key missing / model retired | `/ai/health` `lastError*`, warn logs | Offline extractor + template drafts take over; chat degrades to named messages with one auto-retry |
| Throttle abuse | 429 responses, per-IP limits | Configured limits hold; Redis seam documented for multi-instance future |

Recovery proof procedure (run before every submit, keep the log):
`db:reset` → boot → `/health` ok → login as all 3 demo users → create/claim/complete one ticket → wipe DB file → reboot → `/health` ok → login works, catalog intact.

## 6. Final smoke (post-deploy, every time)

1. `/health` returns 200 with `migrations.pending: 0`.
2. Frontend loads, login works for `admin@acme.com` / `alice@acme.com` / `bob@acme.com`.
3. Critical journey: Alice creates → Bob claims → Bob resolves with note → Alice rates 5 stars → CSAT moves.
4. Admin exports CSV; audit timeline shows the transitions.
5. Assistant answers one stats question and drafts one ticket (confirm path).

If any step fails, the release is NO-GO: fix, re-verify, re-smoke. Do not
submit a known-red build.
