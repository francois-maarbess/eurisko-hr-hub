# Product Specification: Internal Operations Service Hub

## 1. Purpose

The Internal Operations Service Hub gives employees one reliable place to request help, official documents, workplace services, and technical support. Every request is routed to an accountable department, tracked through a controlled lifecycle, and retained in an auditable history.

### Known facts and constraints

- The system is internal-only and uses company SSO.
- Employees should not need to know which department owns a request type; routing derives ownership from the catalog.
- A request belongs to exactly one department and one request type at a time.
- Department membership is independent from platform role.
- The system must preserve correctness when storage, database, SSO, or notification dependencies are unavailable.
- The product is a service hub, not payroll processing, accounting, real-time chat, or automated document generation.

### Do / Don't

**Do**

- Centralize requests in one intake system and make ownership, status, and next steps clear.
- Enforce authorization and validation on the server for every sensitive operation.
- Keep state transitions transactional and record meaningful changes in an append-only audit trail.
- Keep documents private, validate uploads, and broker all downloads through the API.
- Use durable asynchronous notifications, retries, and reconciliation for downstream work.

**Don't**

- Do not trust client-supplied identity, department ownership, or permission claims.
- Do not allow cross-user or cross-department access.
- Do not expose secrets, public storage URLs, document contents, tokens, or sensitive request text in logs.
- Do not report failed mutations as successful or silently ignore dependency failures.
- Do not accept unsupported or unsafe files, including video files.
- Do not use email or chat as the system of record for request status.

## 2. Actors and stakeholders

### Actors

* **Employee:** submits requests, follows progress, cancels pending requests, and receives resolutions.
* **Department agent:** reviews, claims, updates, and resolves requests assigned to their department.
* **Department manager:** supervises the department queue, manages department members and request types, and re-routes requests when necessary.
* **System administrator:** manages the complete platform, departments, permissions, and cross-department reporting.

### Stakeholders

* **Employees:** need a simple and reliable way to get help.
* **Department teams:** need an organized queue and clear ownership of work.
* **HR and People Operations leadership:** need visibility into employee service quality and request history.
* **IT, Facilities, and Finance leadership:** need department-specific workload and performance information.
* **Company management:** needs secure, auditable, and measurable internal operations.

## 3. Users and permissions

| Role | Permissions |
| --- | --- |
| Employee | Browse the catalog, create requests, view and cancel their own pending requests, download their own resolutions |
| Department agent | View, claim, work on, reject, and resolve requests in assigned departments |
| Department manager | All agent permissions plus manage department members and request types and re-route requests within policy |
| System administrator | Configure all departments, members, catalogs, and requests; access cross-department reporting |

Users authenticate through company SSO. Department membership is separate from the platform role, so one person may be an agent in more than one department.

## 4. Initial department catalog

All catalog entries are active by default and have a stable identifier, description, owning department, and default priority.

### Human Resources (`HR`)

* Employment verification and employment letters
* Payroll and payslip questions
* Benefits and insurance
* Onboarding and offboarding
* Workplace policy questions

### IT & Technical Support (`IT`)

* Laptop or desktop problem
* Software installation or update
* Account or password access
* Email or calendar problem
* VPN or network access
* Equipment request or replacement

### Facilities & Workplace (`FAC`)

* Office repair or maintenance
* Desk or meeting-room problem
* Access badge or building access
* Office supplies
* Workspace move or setup

### Finance (`FIN`)

* Expense reimbursement
* Invoice or vendor question
* Payment or banking question
* Budget clarification

### People Operations (`PEO`)

* Training request
* Performance support
* Employee wellbeing
* Workplace experience feedback

## 5. Core workflow

1. Employee selects an active department and request type.
2. The API verifies that the request type belongs to that department and creates the request as `PENDING`.
3. The owning department receives the request in its queue.
4. An authorized agent claims the request, changing it to `IN_PROGRESS`.
5. The agent adds a resolution note and/or an approved document.
6. The agent marks it `COMPLETED`; at least one resolution artifact is required.
7. The employee is notified and can read the resolution or download the document.

### Statuses and transitions

* `PENDING -> IN_PROGRESS`: owning department agent or manager claims the request.
* `PENDING -> CANCELLED`: requesting employee cancels it.
* `PENDING -> REJECTED`: owning department agent or manager rejects it with a reason.
* `IN_PROGRESS -> COMPLETED`: owning department agent or manager supplies a resolution note or document.
* `IN_PROGRESS -> REJECTED`: owning department agent or manager rejects it with a reason.
* `COMPLETED`, `REJECTED`, and `CANCELLED` are terminal.

Every transition records the actor, timestamp, previous status, new status, and reason or note where applicable.

## 6. Functional requirements

* **Catalog:** Employees can list active departments and request types. Inactive entries cannot receive new requests.
* **Routing:** The request's `department_id` and `request_type_id` are stored at creation and validated together.
* **Priority:** Employees choose `LOW`, `STANDARD`, or `URGENT`; queues sort urgent requests first, then oldest creation time.
* **Employee history:** Employees can list and inspect only their own requests.
* **Department queue:** Agents and managers can list only requests belonging to their assigned departments.
* **Claiming:** Claiming is atomic; only one agent can claim an unclaimed request.
* **Cancellation:** Employees can cancel only their own `PENDING` requests.
* **Resolution:** Completion requires a non-empty resolution note, a document, or both.
* **Documents:** Only authorized department staff can upload or delete a document. Downloads are brokered by the API.
* **Notifications:** Notify the employee on creation, claim, rejection, completion, and cancellation. Notify department staff on new or re-routed requests.
* **Audit:** Audit entries are append-only and cover creation, assignment, claims, status changes, document operations, membership changes, and catalog changes.

## 7. Non-functional requirements

### Security

* Enforce SSO token validation on every API request.
* Enforce platform and department-scoped RBAC server-side; never trust a department ID supplied by the client.
* Return `403 Forbidden` for cross-user or cross-department access.
* Apply configurable rate limits per authenticated identity and endpoint category to prevent abuse and protect the database.
* Keep documents in private object storage. Do not expose public URLs or direct client storage credentials.
* Validate file size, MIME type, extension, and content signature. Reject unsupported types such as video files.
* Retain document payloads for 30 days after completion, then permanently purge them through an automated job.
* Log security-relevant failures without logging document contents, tokens, or sensitive request text.

### Performance and availability

* Normal catalog and request pages should load within three seconds on the company network.
* The system should support the expected number of employees and requests without requiring a separate service for every department.
* A database, SSO, or storage outage must return a clear error rather than silently losing a request.
* Notifications may be delayed during a provider outage, but the request update itself must remain saved.

### Auditability and maintainability

* Every status change, assignment, document action, and permission change must be recorded with the actor and timestamp.
* Audit records must be append-only and retained according to company policy.
* The system should use clear department and request-type identifiers so reports remain accurate if names change.
* Configuration such as rate limits, file limits, and retention periods should be changeable without rewriting business logic.

### Usability and accessibility

* An employee should be able to submit a request without training.
* Forms must clearly show the department, request type, priority, description, and optional attachments.
* Status labels and error messages must be understandable to non-technical employees.
* The interface should support keyboard navigation, readable contrast, and responsive layouts.

## 8. Product-level system behavior

The product requires a secure backend service to:

* show the department catalog;
* create and route employee requests;
* provide employee history and department queues;
* enforce permissions and valid status transitions;
* handle approved attachments securely;
* record audit history; and
* send notifications after important request events.

The exact API routes and technical implementation belong in the architecture and implementation documentation, not in this product specification.

## 9. Acceptance criteria

1. An employee submitting an IT laptop request sees it in the IT queue as `PENDING`; it is absent from HR, Finance, and Facilities queues.
2. A user without IT membership cannot read, claim, update, or download an IT request belonging to another employee.
3. A user without ownership cannot read another employee's request, even if they know its identifier.
4. Two simultaneous claims result in one successful claim and one `409 Conflict`.
5. Completion without a resolution note and without a document returns `400 Bad Request`.
6. Employees can cancel their own pending request and cannot cancel an in-progress or terminal request.
7. Unsupported files, including `.mp4`, are rejected before storage.
8. Deleting a document removes the storage object, clears its database reference, and creates an audit entry.
9. A missing storage object returns `404 Not Found` rather than a broken download.
10. Department queues sort `URGENT` before `STANDARD` before `LOW`, then oldest first.
11. Completed documents are automatically deleted after 30 days.
12. Every status transition has an immutable audit record.

## 10. Non-goals

* Automated document generation
* Payroll processing, expense payment, or accounting
* Real-time chat
* Replacing the company identity provider
* Complex animation or presentation-focused UI work

## 11. Open decisions before implementation

* Department-specific service-level targets
* Maximum attachment size and allowed document formats
* Notification preferences and escalation rules
* Production hosting, backup, and disaster-recovery targets
