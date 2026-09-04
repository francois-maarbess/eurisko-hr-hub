# Data Model: Employee Service Hub

## 1. Entities

### `users`

`id`, SSO subject, display name, email, platform role (`EMPLOYEE` or `SYSTEM_ADMIN`), active flag, timestamps.

### `departments`

`id`, stable code, name, description, active flag, timestamps.

### `department_members`

`department_id`, `user_id`, department role (`AGENT` or `MANAGER`), active flag, timestamps. Enforce one active membership per user and department.

### `request_types`

`id`, `department_id`, stable code, name, description, active flag, default priority, timestamps. A request type belongs to exactly one department.

### `requests`

`id`, `employee_id`, `department_id`, `request_type_id`, title, description, priority, status, claimed_by, resolution_note, rejection_reason, completed_at, created_at, updated_at.

Store both department and request type on the request for stable historical routing. A normal update cannot change either value. Re-routing is an explicit audited operation.

### `documents`

`id`, `request_id`, storage key, original filename, MIME type, byte size, checksum, uploaded_by, deleted_at, created_at, purge_at.

Store a storage key, not a public URL. A soft-deleted database row may remain for audit purposes while the object is permanently removed.

### `audit_logs`

`id`, request ID when applicable, actor ID, action, old value, new value, metadata, created timestamp. This is append-only.

## 2. Invariants

* Every request type and request department must match.
* An employee can read only their own requests.
* An agent or manager can read a request only when actively assigned to its department.
* Only an active department member or system administrator can operate a department request.
* A request can be completed only when a non-empty resolution note exists or at least one non-deleted document exists.
* A rejection must include a reason.
* A claimed request must have a claimant who is an active member of the owning department.
* Audit rows cannot be updated or deleted by the application role.
* Document purge is idempotent and must not restore a deleted object.

## 3. State machine

```text
PENDING      -> IN_PROGRESS   (department claim)
PENDING      -> CANCELLED     (requesting employee)
PENDING      -> REJECTED      (department staff + reason)
IN_PROGRESS  -> COMPLETED     (department staff + resolution)
IN_PROGRESS  -> REJECTED      (department staff + reason)
```

`COMPLETED`, `REJECTED`, and `CANCELLED` are terminal. A database constraint or transaction-level state check must reject all other transitions.

## 4. Authorization rules

* Platform role controls system-wide administration.
* Department membership controls access to department queues.
* Department manager controls only their own department's members, active request types, and permitted re-routing.
* System administrator controls all departments.
* The API derives employee and department identity from the authenticated token and authorization lookup, never from trusted client fields.

## 5. Access patterns and indexes

* Employee history: `requests(employee_id, created_at DESC)`.
* Department queue: `requests(department_id, status, priority, created_at)`.
* Catalog: `request_types(department_id, active, name)`.
* Membership lookup: `department_members(user_id, active, department_id)`.
* Audit history: `audit_logs(request_id, created_at)`.
* Purge worker: `documents(purge_at, deleted_at)`.

Use a priority ranking column or enum ordering so database sorting cannot depend on display strings.

## 6. Transaction boundaries

* Creation validates the catalog relationship and inserts the request plus its initial audit row in one transaction.
* Claim uses a conditional update (`status = PENDING AND claimed_by IS NULL`) and returns `409` when no row is updated because another claimant won.
* Status changes lock the request row, validate the state transition and resolution invariant, update the request, and append the audit row in one transaction.
* Document deletion removes the storage object first, then clears the active reference in a transaction; reconciliation detects either-side failures.
