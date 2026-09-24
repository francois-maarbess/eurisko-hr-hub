# Week 4 — Production AI: AI-Assisted Request Intake (v0.4)

## What was built

One AI-assisted Request Intake capability in the same Internal Operations
Service Hub repo. An employee types free text ("my laptop screen is cracked,
need a replacement ASAP"); the backend returns a **structured draft
candidate** (department, request type, title, description, priority); the
human reviews it in the form and submits through the existing validated
`POST /requests` flow.

**AI is advisory. Software + human authority stays final.** Nothing is ever
created by the AI path — `POST /requests/ai-draft` returns a candidate only.
The existing creation endpoint, DTO validation, auth rules, and state machine
are untouched.

**No paid AI provider required.** The default provider is a deterministic,
dependency-free local extractor (keyword scoring over the product's own
catalog — zero network, zero keys, works offline). If `GROQ_API_KEY` is set,
a Groq LLM provider is tried first and any failure falls back to local.

## How it works

```
free text → POST /requests/ai-draft (JWT) → catalog load (DB-owned context)
  → provider extracts codes → validateCandidate() enforces product rules
  → { departmentId, requestTypeId, title, description, priority,
      confidence, provider } → human reviews → POST /requests
```

- **Bounded context:** the model only ever sees department/request-type
  codes from the database. It cannot invent values.
- **Validation (`validateCandidate`, pure function):** unknown department or
  type → 400s with messages; unknown priority → coerced to STANDARD;
  short/garbage text → safe fallbacks that still satisfy DTO minimums. Invalid output is
  rejected, never created.
- **UNKNOWN is reserved for off-topic input only** (gibberish, sports,
  cooking, small talk): the service answers 400 with a human-readable
  message ("I can only help with workplace requests…"). Anything
  work-related — typos, emotions, vague wording, personal hardship — always
  resolves to the closest category, never UNKNOWN.
- **Confidence:** `high` when the match is decisive, `low` when ambiguous —
  the UI tells the user to double-check (`CreateRequestForm.tsx` AI box).
- **Sensitive flag:** distress/safety signals (harassment, crying, unsafe…)
  mark the draft `sensitive: true`, force URGENT, and show a discreet UI
  note. Advisory only — a human still reviews every word.
- **Frontend:** "Draft with AI" box above the existing form fills every
  field from the candidate. Submit path unchanged.

## How to run

```bash
npm install
npx prisma generate
npx prisma migrate dev
npx tsx prisma/seed.ts

npm test          # 62 tests: 10 transitions + 3 integration + 10 AI unit + 6 auth unit + 3 purge/duplicate unit + 30 E2E
npm run eval:ai   # 8 representative AI eval cases, offline, deterministic
```

Optional: set `GROQ_API_KEY` to enable the LLM provider (falls back to
local on any failure). Nothing else changes.

## Eval coverage (PROVE)

`npm run eval:ai` runs 8 cases with no network, no database, no key:

1. **clear** — urgent laptop request → IT/LAPTOP/URGENT, high confidence
2. **thin** — single word "vpn" → IT/VPN/STANDARD, description padded
3. **ambiguous** — "help me get set up" → valid in-catalog values, low confidence
4. **invalid output** — unknown department/category codes → rejected (400)
5. **provider failure** — throwing provider → local fallback still drafts
6. **conditional behavior** — calm wording ("at your convenience, no rush") → STANDARD, never forced URGENT
7. **distressed + typos** — harassment/crying/sick wording → PEO/WELLBEING, URGENT, `sensitive: true`, high confidence
8. **off-topic** — "who won the formula 1 race" → clean 400 workplace-requests message, never a forced ticket

## Files

- `src/ai/ai.provider.ts` — provider contract + catalog/draft types
- `src/ai/local-ai.provider.ts` — deterministic offline extractor (default)
- `src/ai/groq-ai.provider.ts` — optional LLM provider (raw HTTPS, no SDK)
- `src/ai/ai-intake.service.ts` — catalog load, provider fallback, `validateCandidate`
- `src/ai/ai.controller.ts` — `POST /requests/ai-draft` (JWT-guarded)
- `src/ai/ai.module.ts`, `src/ai/ai-intake.service.spec.ts` (8 unit tests)
- `scripts/eval-ai.ts` — 8 eval cases, exit code signals pass/fail
- `test/app.e2e-spec.ts` — draft happy path (creates nothing) + empty/anon rejections
- `frontend/src/CreateRequestForm.tsx` — AI draft box + confidence note
