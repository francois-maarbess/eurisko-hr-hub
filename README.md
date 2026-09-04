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
