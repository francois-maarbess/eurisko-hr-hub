# SLA Target Design

## Why per-ticket deadlines

Each request receives a target completion duration at creation and stores its
absolute deadline in `slaDueAt` with its source in `slaSource`. The target is
an operational estimate, not a contractual guarantee or an emergency
response promise. Once stored, every countdown, breach query, and export uses
that value and never calls the model again.

## Decision flow (`AiIntakeService.decideSlaHours`)

1. With optional `GROQ_API_KEY`, Groq may propose an integer duration in
   milliseconds anywhere in the inclusive **15-minute to 30-day** policy
   range. The continuous range is not restricted to fixed priority buckets.
2. The prompt asks the model to weigh stated business impact, affected scope,
   operational blockage, time sensitivity, and sensitivity. Priority is one
   signal, not an override. The application strictly validates the JSON shape,
   exact integer range, and bounded rationale before accepting it.
3. The request waits for at most **2.5 seconds** for the SLA estimate, before
   any database transaction starts. Missing key, timeout, network error, or
   invalid output uses the deterministic priority fallback. `slaSource` is
   recorded as `AI` only for an accepted estimate and `RULE` otherwise.
4. Fallback targets remain URGENT 4h / STANDARD 24h / LOW 48h. Macro child
   tasks use these deterministic targets so creating a workflow never issues
   one extra model call per child.

Reroutes recompute a fresh deadline (the ticket reopens as PENDING).

## Guarantees

- No key, no network, no problem: drafts and request creation remain usable;
  the stored deadline uses the priority fallback.
- At most one SLA model call per submitted parent request — countdowns, reports, and exports
  read the stored column, never call the model.
- The 15-minute and 30-day bounds are product guardrails. They prevent
  impossible sub-minute workplace targets and avoid unbounded deadlines.
- Old tickets (NULL `slaDueAt`) use the legacy priority math in the UI.

## Macro workflow lifecycle

- The root request stays a normal request in the employee-selected department
  and must be claimed/completed under the ordinary request rules.
- Each reviewed child is an ordinary independent request in its own active
  department/request-type pair, owned by the same employee and independently
  claimed, worked, audited, and completed.
- A parent cannot transition to `COMPLETED` while any child is not `COMPLETED`.
  Rejected children therefore require the parent to be rejected rather than
  falsely reporting the overall workflow as complete.
- A parent owner or system administrator may inspect all children. Department
  staff see only child details routed to a department they are authorized for;
  the parent detail endpoint does not expose sibling department task content.
- Parent and children are written atomically. A client submission UUID makes
  retrying the same submission idempotent. Notifications are emitted after
  commit using the existing notification outbox and keys.
