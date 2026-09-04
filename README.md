# Employee Service Hub

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

## Documentation

* `docs/product-spec.md` - Product scope, actors, stakeholders, functional and non-functional requirements, and acceptance criteria.
* `docs/data-model.md` - Entities, constraints, state machine, authorization rules, and indexes.
* `docs/architecture.md` - Components, trust boundaries, flows, failure handling, and operational controls.
* `docs/decisions/ADR-001.md` - Decision to store document payloads outside the relational database.

## Current repository status

This repository currently contains the finalized product and technical specifications. Application code, migrations, and deployment configuration are intentionally not included in this specification phase.
