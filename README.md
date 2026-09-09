# Internal Operations Service Hub

An internal service hub for submitting, routing, tracking, and resolving employee requests.

## What the product does

Employees submit one request through a single portal instead of using scattered email and chat messages. They choose a department and request type, describe the issue, set a priority, and track the request until it is resolved.

The initial departments are:

| Department | Example request types |
| --- | --- |
| Human Resources | Employment letters, benefits, onboarding, workplace policies |
| IT & Technical Support | Laptop problems, software, account access, email, VPN, equipment |
| Facilities & Workplace | Repairs, desks, meeting rooms, badges, supplies |
| Finance | Expenses, invoices, payment questions |
| People Operations | Training, performance, employee wellbeing |

Every request type belongs to exactly one department. An IT laptop request is therefore routed to the IT queue and cannot appear in the HR queue.

## Known facts and constraints

- Employees need one reliable channel instead of scattered email and chat requests.
- Each request belongs to exactly one accountable department and request type.
- Server-side authorization is mandatory; the client is never trusted for identity or ownership.
- Requests, documents, and lifecycle events must remain secure and auditable.
- Notifications are asynchronous and must not block a successful core request write.
- The product is a service hub, not a replacement for payroll, accounting, or real-time chat.

## Must do

- Centralize intake, route requests using catalog ownership, and show clear status.
- Enforce employee, department, manager, and administrator permissions.
- Record claims, status changes, routing, document actions, and membership changes in an immutable audit trail.
- Keep documents private and broker uploads and downloads through the API.
- Make claims and state transitions atomic, validated, and recoverable when dependencies fail.

## Must not do

- Do not trust client-supplied department IDs, user identity, or permissions.
- Do not permit cross-user or cross-department access.
- Do not expose database credentials, storage credentials, public object URLs, or sensitive content in logs.
- Do not accept unsafe or unsupported uploads, including video files.
- Do not silently ignore storage, notification, or reconciliation failures.
- Do not treat email or chat as the source of truth for request status.

## Documentation

* `docs/product-spec.md` - Product scope, actors, stakeholders, functional and non-functional requirements, and acceptance criteria.
* `docs/data-model.md` - Entities, constraints, state machine, authorization rules, and indexes.
* `docs/architecture.md` - Components, trust boundaries, flows, failure handling, and operational controls.
* `docs/decisions/ADR-001.md` - Decision to store document payloads outside the relational database.

## Current repository status

This repository currently contains the finalized product and technical specifications. Application code, migrations, and deployment configuration are intentionally not included in this specification phase.

## Run / Verify Instructions

1. Install the backend dependencies:

   ```bash
   cd C:\EuriskoFinal
   npm install
   ```

2. Install the frontend dependencies:

   ```bash
   cd C:\EuriskoFinal\frontend
   npm install
   ```

3. Start the NestJS server in one terminal:

   ```bash
   cd C:\EuriskoFinal
   npm run start:dev
   ```

4. Start the Vite frontend in a separate terminal:

   ```bash
   cd C:\EuriskoFinal\frontend
   npm run dev
   ```

5. Open the frontend in a browser at `http://localhost:5173` and confirm the app loads.

6. In a separate terminal, test the valid `PENDING -> CANCELLED` transition on a fresh server instance (restart the server first, because `req-1` starts as `PENDING` only on a clean boot):

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-1/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'CANCELLED'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

7. Test the valid `PENDING -> IN_PROGRESS` transition:

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-1/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'IN_PROGRESS'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

8. Test the valid `IN_PROGRESS -> COMPLETED` transition with a resolution note:

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-2/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'COMPLETED', resolution_note:'Resolved successfully.'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

9. Test the invalid backward transition from a terminal state:

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-3/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'PENDING'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

10. Test the invariant enforcement for completion without a `resolution_note`:

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-1/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'COMPLETED'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

11. Test the invalid skip transition `PENDING -> COMPLETED` on a fresh server instance (restart the server first, because `req-1` starts as `PENDING` only on a clean boot):

   ```bash
   cd C:\EuriskoFinal
   node -e "fetch('http://localhost:3000/requests/req-1/status', {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({status:'COMPLETED', resolution_note:'Note'})}).then(async r => { console.log('status', r.status); console.log(await r.text()); });"
   ```

Expected results:
- The backend runs on `http://localhost:3000`.
- The frontend runs on `http://localhost:5173`.
- Valid transitions return `200 OK`.
- `PENDING -> CANCELLED` is accepted and results in `CANCELLED`.
- Invalid transitions return `400 Bad Request`.
- Completion without `resolution_note` returns `400 Bad Request`.
