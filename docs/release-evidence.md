# Release evidence — recovery and final smoke

Run date (UTC): 2026-09-26. App version 1.0.0. Procedure: `docs/week5-release-operations.md` §5.
Commands below ran against a local build (`nest build` + `node dist/main.js`).

## 1. Database wipe and rebuild (failure → recovery)

- Deleted `prisma/dev.db` (simulates ephemeral-disk wipe / fresh deploy).
- `npx prisma migrate deploy` → "All migrations have been successfully applied."
- `npx tsx prisma/seed.ts` → users, departments, request types initialized.
- `npm run db:doctor` → file present and reachable; alice, bob, admin active;
  5 departments, 23 request types; **0 requests, 3 users**.

## 2. Boot and health

- Server booted; `GET /health` → 200:
  `status ok`, `database connected`, `migrations {applied: 10, pending: 0}`,
  `outbox {pending: 0, failed: 0}`, AI provider groq with no recorded errors.

## 3. Critical journey (all three demo logins)

- `POST /auth/login` × 3 (alice, bob, admin) → all 200 with JWTs.
- Alice `POST /requests` (IT/LAPTOP) → 201; Bob `PATCH /:id/claim` →
  `IN_PROGRESS`; Bob `PATCH /:id/status` (`COMPLETED` + note) → `COMPLETED`;
  Alice `POST /:id/feedback` (`rating: 5`) → `5`.
- Admin `GET /requests/export` → 200 CSV.
- Admin `GET /requests/:id/activity` → 4 rows (create, claim, complete, rate).
- Admin `POST /ai/chat` ("How many open tickets are there right now?") →
  substantive answer (>20 chars), 201.

## 4. Post-run state

- Smoke ticket removed; `npm run db:reset` + `db:doctor` → 0 requests,
  3 users. Working tree clean. Full `npm run verify` exit 0 separately
  (132 backend, 10 frontend, 9 evals; see CI on the pushed branch).
