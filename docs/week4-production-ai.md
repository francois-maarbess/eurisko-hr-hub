# AI-assisted intake and operations workflows

## Authority and trust

AI is advisory. The model proposes structured drafts; software validates them
against the active catalog, and an employee reviews or corrects them before
submission. The model never writes database records or changes ticket status.
Every final request uses the authenticated, validated `POST /requests` flow.

The default is the deterministic, dependency-free local provider. Setting the
existing optional `GROQ_API_KEY` enables Groq. No new key or dependency is
required. Provider failure falls back to local classification and policy-based
SLA targets. Resolution playbooks use Groq when configured and a deterministic,
low-confidence `[Confirm]` template when it is not; neither path changes ticket
state.

## Operations Assistant

Authenticated users can call `POST /ai/chat` with `{ message, sessionId? }`.
The assistant uses the caller's JWT identity and active department memberships
for every read. It can report caller-scoped statistics (including per-department
numbers for admins and department members), list/search authorized
tickets, show authorized ticket details, classify vague free text into catalog
department/type/priority before proposing, report non-secret AI health, and start
MFA setup for the caller's own account. The authenticator code must still be
entered by the user in Security settings.

Create-request, claim, reroute, and admin create-user actions are proposal-only
until the UI returns the confirmation card and the caller explicitly confirms
with its confirmation ID. The server repeats authorization and validation when
executing and writes an audit event. The full pending payload persists in the
chat session row, so a restart rehydrates (never silently drops) a proposal;
confirmation IDs stay valid only for their own session. Departments and request
types are matched server-side from human words against the active catalog at
propose time — bad proposals fail once with the valid options, never in a loop.
Tool results shown to the model carry no confirmation or database IDs, and
assistant messages render as plain text (no markdown, no raw ids).

With no `GROQ_API_KEY`, the same window returns an honest local capability
message and performs no model-backed tool actions. With a key, Groq is called
through the existing raw `fetch` provider, with bounded structured-answer
parsing, a bounded six-step tool loop, a ten-second timeout, and a safe
unavailable response on provider failure. Groq does not allow JSON response mode
and function calling in the same request, so the server validates the returned
answer shape instead. Keys, prompts, hashes, tokens, private notes, and
unauthorized ticket data are never returned to the caller.

## AI request draft

`POST /requests/ai-draft` loads the active, database-owned catalog and returns
validated department/type IDs, title, description, priority, confidence,
sensitivity, short rationale, and the prompt version. Model text is treated
as untrusted input and output must match a strict runtime JSON contract.

- Unknown or inactive catalog entries are never accepted.
- Low-confidence or ambiguous workplace input returns focused clarification
  questions and no applied department/request-type IDs. Off-topic input gets a
  clear workplace-request message rather than a forced classification.
- Distress/harassment/safety signals are discreetly flagged and force the
  advisory draft priority to URGENT. This is not emergency response or
  professional advice; the employee reviews all fields.
- The offline classifier scores request-type evidence separately from
  department-wide context. Type-specific evidence has full weight; shared
  department words only break weak ties.

## SLA target policy

See [SLA target design](sla-design.md). Groq may estimate a continuous integer
millisecond duration between 15 minutes and 30 days from stated impact, scope,
blockage, time sensitivity, and sensitivity. The target is an internal planning
estimate, not a contractual or emergency-response guarantee. The bounded call
has a 2.5-second timeout and runs before the request transaction. On any
failure, URGENT/STANDARD/LOW use 4/24/48-hour deterministic targets and source
`RULE`; accepted estimates are stored with source `AI`.

## Reviewed multi-department workflows

For clearly multi-department requests, AI may propose up to six child tasks,
each routed using an active catalog pair. The requester may edit task text and
routing, remove individual tasks, or reject the full proposal. Server-side
validation is repeated at submit time. A stable submission UUID prevents
network retries from duplicating the request set.

The parent remains a normal request in the employee-selected department.
Approved children are normal independent requests owned by the same employee,
and are independently claimed, completed, audited, and assigned deterministic
fallback SLAs. Parent and child rows plus audit entries are created in one
Prisma transaction. The parent cannot complete while any child is not
`COMPLETED`; a rejected child means the overall parent must be rejected rather
than falsely marked complete. Owners and system administrators can inspect
the complete workflow. Department staff see only child details for requests
their department is authorized to access.

## Resolution playbook

An authenticated department agent or administrator can use **Claim & draft
resolution** on an eligible pending queue item. The UI first claims it through
the normal audited endpoint, then requests `POST /requests/:id/ai-playbook` as
the current assignee. The result is a professional resolution-note draft with
explicit assumptions. It must not claim work has already been performed. The
agent edits and verifies it, then chooses **Submit & complete**. AI never
updates status or request data; the existing completion endpoint still
enforces claim ownership and a resolution note or document. The endpoint is
rate-limited; if drafting fails after claim, the request remains claimed and
can still be completed with a manually written note.

## Verification

`npm run eval:ai` is deterministic and offline. Unit/e2e tests cover catalog
validation, ambiguous and sensitive examples, prompt-injection resistance,
strict provider schemas, bounded SLA calculations, provider fallback, macro
atomicity/idempotency/access/completion rules, and playbook output validation
and authorization. The standard test suite does not call Groq.
