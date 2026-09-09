# Week 2 Agentic Workflow

## Understand
- The Week 1 data model supports a bounded slice of request transitions for the demo:
  - `PENDING -> IN_PROGRESS`
  - `PENDING -> CANCELLED`
  - `IN_PROGRESS -> COMPLETED`
- The completion invariant is explicit: a request can only move to `COMPLETED` when a non-empty `resolution_note` is present in the request body.
- `COMPLETED` and `CANCELLED` are terminal states, so backward transitions from either are invalid.
- For the UI demo, the backend also needs `GET /requests` so the dashboard can render the full in-memory queue instead of a single hardcoded request card.

## Direct
- I expanded the in-memory request model so each request includes `title`, `description`, `priority`, `status`, and optional `resolution_note`.
- I added `GET /requests` in `RequestsController` to return the full seeded queue (`req-1`, `req-2`, `req-3`).
- I updated `RequestsService` to support `CANCELLED` as a valid state and to enforce the bounded state-machine rules.
- I built a React queue dashboard in `frontend/src/TicketStatusManager.tsx` that renders cards for all requests, supports claim/resolve actions, accepts inline resolution notes, and shows per-card inline errors.

## Prove
Expected vs. actual outcomes for the demo-backed API:

1. `GET /requests`
   - Expected: `200 OK` and all three seeded requests with title, description, priority, status, and current note.
   - Actual: `200 OK` with the full queue payload.

2. `req-1` from `PENDING` to `IN_PROGRESS`
   - Expected: `200 OK` and a response showing `status: "IN_PROGRESS"`.
   - Actual: `200 OK` with `{"id":"req-1","status":"IN_PROGRESS"}`.

3. `req-1` from `PENDING` to `CANCELLED`
   - Expected: `200 OK` and a response showing `status: "CANCELLED"`.
   - Actual: `200 OK` with `{"id":"req-1","status":"CANCELLED"}`.

4. `req-2` from `IN_PROGRESS` to `COMPLETED` with `resolution_note`
   - Expected: `200 OK` with `status: "COMPLETED"` and the supplied note preserved.
   - Actual: `200 OK` with `{"id":"req-2","status":"COMPLETED","resolution_note":"Resolved successfully."}`.

5. `req-3` from `COMPLETED` to `PENDING`
   - Expected: `400 Bad Request` because terminal states cannot move backward.
   - Actual: `400 Bad Request` with `Invalid status transition for this request`.

6. `req-1` from `IN_PROGRESS` to `COMPLETED` without `resolution_note`
   - Expected: `400 Bad Request` because completion requires a note.
   - Actual: `400 Bad Request` with `A resolution_note is required when transitioning to COMPLETED`.

7. `req-1` from `PENDING` to `COMPLETED` on a fresh server instance
   - Expected: `400 Bad Request` because skipping `IN_PROGRESS` is not allowed.
   - Actual: `400 Bad Request` with `Invalid status transition for this request`.

The verified demo behavior now matches the expanded Week 1 state machine, including cancellation, full queue fetching, and the card-based dashboard experience.
