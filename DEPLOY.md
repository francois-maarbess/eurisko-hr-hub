# Deploying to Render (free tier)

Two services from this one repo: a Node web service (API) and a static site
(frontend). applies `render.yaml`, or follow the manual steps below —
both describe the same configuration.

## Option A — Blueprint (recommended)

1. Dashboard → Blueprints → New Blueprint Instance → select this repo.
2. When prompted, fill the `sync: false` values:
   - `GROQ_API_KEY` — free key from https://console.groq.com (optional;
     without it AI runs fully offline, nothing breaks).
   - `CORS_ORIGINS` — leave blank for the first deploy; set to the frontend
     URL (step 4) afterwards.
   - `VITE_API_BASE` — leave blank for the first deploy (see step 3).
3. After the backend is live (`https://eurisko-hr-hub-1.onrender.com/health`
   returns `"status":"ok"`), copy its URL and set the frontend's
   `VITE_API_BASE` to it, then redeploy the static site
   (the API address is baked in at build time — editing the variable alone
   does nothing without a rebuild).
4. Back on the backend, set `CORS_ORIGINS` to the frontend URL and redeploy.
   This ends permissive-CORS mode.

## Option B — manual (what the current live services use)

Backend web service (Node, Oregon, Free): build
`npm install --include=dev; npx prisma generate; npm run build`, start
`npx tsx prisma/seed.ts && npm run start`, health check `/health`, env as in
`render.yaml` (`NODE_VERSION 22.12.0`, `NODE_ENV production`, generated
`JWT_SECRET`, …). Migrations run as the `preDeployCommand`
(`npx prisma migrate deploy`) — the blueprint owns this; a manually
configured service that copies only `startCommand` must add the migrate step
or it can boot against a stale schema. Check `/health`
(`migrations.pending: 0`) after every deploy.
Frontend static site: root directory `frontend`, build
`npm install; npm run build`, publish directory `dist`, env `VITE_API_BASE`.

## Honest caveats (tell evaluators this upfront)

- **Cold starts:** free instances sleep after ~15 idle minutes; the first
  request after sleep takes ~50s. Refresh once. Active use never sleeps.
- **Ephemeral data:** restarts and redeploys wipe the SQLite file; every boot
  rebuilds exactly the 3 demo users + catalog and zero tickets. Anything an
  evaluator creates can vanish on redeploy — that is the documented $0 trade,
  not a bug. `DEMO.md` always works from a fresh boot.
- **Demo credentials are disposable by design.** The seed password
  (`Password123!`) is public and is re-applied on every boot, so changing it
  on the live deployment does not stick — do not present the live admin
  account as secured. Treat all three demo accounts as shared, disposable
  evaluation logins. Real credential hygiene (unique passwords, rotation) is
  fully supported by the app and applies to any non-seeded account.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Build fails `nest: not found` | dev dependencies pruned (`NODE_ENV=production` + plain `npm install`) | Build command must include `--include=dev` |
| Login spins / network error on frontend | `VITE_API_BASE` missing or wrong at build time | Set it, then **rebuild** (Clear build cache and deploy) |
| API 404s from frontend after both deploy | `CORS_ORIGINS` not set to frontend URL | Set it on the backend, redeploy |
| `/health` 503 | DB unreachable or migrations pending | Check logs; redeploy applies `preDeployCommand` migrations |
| Stale UI after a fix | Cached bundle or old deploy | Hard refresh (Ctrl+Shift+R); confirm the service built the latest commit |
