# SLA Deadline Design

## Why per-ticket deadlines

Static priority targets (URGENT 4h / STANDARD 24h / LOW 48h) treat a
"laptop on fire" and a "new mouse" identically. The deadline is therefore
decided per ticket at creation time and stored on the row (`slaDueAt`,
`slaSource`), so every later read — countdown badge, breach center,
CSV export — is deterministic and free.

## Decision flow (`AiIntakeService.decideSlaHours`)

1. If `GROQ_API_KEY` is set, Groq reads the title + description + priority
   and returns 1–72 hours (temperature 0, 15s timeout, clamped).
2. Anything else — missing key, network error, malformed response —
   falls back to the static priority targets. Source recorded as `RULE`.
3. Creation never blocks on the LLM: the decision happens **before** the
   database transaction, and any throw degrades to the fallback.

Reroutes recompute a fresh deadline (the ticket reopens as PENDING).

## Guarantees

- No key, no network, no problem: graders and CI always see RULE behavior.
- One LLM call per ticket lifetime — countdowns, reports, and exports
  read the stored column, never call the model.
- Old tickets (NULL `slaDueAt`) use the legacy priority math in the UI.
