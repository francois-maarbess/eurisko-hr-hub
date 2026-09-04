# Product Specification: Employee Service Hub

## 1. Purpose

The Employee Service Hub gives employees one reliable place to request help, official documents, workplace services, and technical support. Every request is routed to an accountable department, tracked through a controlled lifecycle, and retained in an auditable history.

## 2. Users and permissions

| Role | Permissions |
| --- | --- |
| Employee | Browse the catalog, create requests, view and cancel their own pending requests, download their own resolutions |
| Department agent | View, claim, work on, reject, and resolve requests in assigned departments |
| Department manager | All agent permissions plus manage department members and request types and re-route requests within policy |
| System administrator | Configure all departments, members, catalogs, and requests; access cross-department reporting |

Users authenticate through company SSO. Department membership is separate from the platform role, so one person may be an agent in more than one department.

## 3. Initial department catalog

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

## 4. Core workflow

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

## 5. Functional requirements

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

## 6. Security and operational requirements

* Enforce SSO token validation on every API request.
* Enforce platform and department-scoped RBAC server-side; never trust a department ID supplied by the client.
* Return `403 Forbidden` for cross-user or cross-department access.
* Apply rate limits per authenticated identity and endpoint class; limits must be configurable rather than hard-coded to one universal value.
* Keep documents in private object storage. Do not expose public URLs or direct client storage credentials.
* Validate file size, MIME type, extension, and content signature. Reject unsupported types such as video files.
* Retain document payloads for 30 days after completion, then permanently purge them through an automated job.
* Log security-relevant failures without logging document contents, tokens, or sensitive request text.

## 7. API behavior contract

The implementation should expose equivalent REST operations:

* `GET /departments` and `GET /departments/{id}/request-types`
* `POST /requests`
* `GET /requests` (employee-owned history or department-scoped queue)
* `GET /requests/{id}`
* `POST /requests/{id}/claim`
* `POST /requests/{id}/cancel`
* `PATCH /requests/{id}/status`
* `POST /requests/{id}/documents`
* `DELETE /requests/{id}/documents/{documentId}`
* `GET /requests/{id}/documents/{documentId}/download`
* `GET /requests/{id}/audit`

Use `400` for invalid transitions or payloads, `403` for authorization failures, `404` when a resource is not visible or does not exist, `409` for concurrent claims, `413` for oversized files, and `503` when a required dependency is unavailable.

## 8. Acceptance criteria

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

## 9. Non-goals

* Automated document generation
* Payroll processing, expense payment, or accounting
* Real-time chat
* Replacing the company identity provider
* Complex animation or presentation-focused UI work

## 10. Open decisions before implementation

* Department-specific service-level targets
* Maximum attachment size and allowed document formats
* Notification preferences and escalation rules
* Production hosting, backup, and disaster-recovery targets
