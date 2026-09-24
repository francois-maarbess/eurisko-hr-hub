# Guided Demo (2 minutes)

Three commands, then follow the script. Everything below is deterministic —
no API keys, no network, same storyline every time.

## Setup (Terminal 1 and 2)

```bash
# fresh database + demo storyline
npm run db:reset
npx tsx scripts/demo-scenario.ts

# Terminal 1 — backend
npm run start:dev

# Terminal 2 — frontend
cd frontend && npm run dev
```

Open `http://localhost:5173`.

## The tour

**Act 1 — The employee (30s).** Log in as `alice@acme.com` / `Password123!`.
You see "Laptop smoking on my desk" with a live ⏱ SLA countdown (~50 min)
and an "Open …m" age badge. Click **✨ Draft with AI**, type
`my screen is cracked need it asap`, draft, submit — no API key needed.

**Act 2 — The agent (45s).** Sign out, log in as `bob@acme.com` / `Password123!`.
Open the **Queue** tab, claim the smoking laptop. Open **▸ Internal Staff
Notes** on "VPN drops every hour" — private agent note invisible to Alice.
Add one yourself with Ctrl+Enter.

**Act 3 — The admin (45s).** Sign out, log in as `admin@acme.com` / `Password123!`.
Open the **Administration** panel: live per-department active/total bars,
CSAT ★ 5.00 (1 rating), status breakdown. Click the ⓘ button for what
active/total mean. Hit **📥 Export to CSV**. Open **▸ Activity Timeline**
on any ticket — every claim, note, and status change is audit-logged.

**Finale — close the loop.** As Bob, complete the smoking laptop with a
resolution note. As Alice, give it ★★★★★. Watch the CSAT average move.

## Reset

`npm run db:reset` returns to the pristine baseline (3 demo users, 0 requests).
Re-run `npx tsx scripts/demo-scenario.ts` to rebuild the storyline.
