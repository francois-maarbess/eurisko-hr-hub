# Data Model: Internal Operations Service Hub

## MODEL: LIFECYCLE + RULES
The system relies on three core entities (`users`, `requests`, `audit_logs`) bound by strict state and authorization rules.

**1. State Transitions (The `requests` table)**
* Valid transitions strictly flow forward: `PENDING` -> `IN_PROGRESS` -> `COMPLETED`. 
* A `PENDING` request can be moved to `CANCELLED` by the employee. 
* A `PENDING` or `IN_PROGRESS` request can be moved to `REJECTED` by the HR Admin.

**2. Invariants (Database-Level Enforcement)**
* **Resolution Rule:** If a request state is updated to `COMPLETED`, the database will reject the transaction if both `document_url` AND `resolution_note` are null.
* **Immutability Rule:** The `audit_logs` table operates as an append-only ledger. Row updates and deletions are strictly disabled at the database permission level.

**3. Authorization-Sensitive Rules**
* The `users` table holds a `role` enum (`EMPLOYEE` or `HR_ADMIN`). 
* Only users with `HR_ADMIN` can write to the `admin_id` column on a request to "claim" it.

## IMPLEMENTATION INPUT: ACCESS
Database indexes are applied strictly where access patterns justify the memory overhead.

**1. Important Queries / Access Patterns**
* **Employee Dashboard:** "Get all requests where `employee_id` = my_token_id." (High volume, read-heavy).
* **HR Queue:** "Get all requests where `status` = PENDING, sorted by `priority`." (Medium volume, read-heavy).
* **Audit Tracing:** "Get all state changes where `request_id` = X, sorted by timestamp." (Low volume, debugging/compliance).

**2. Justified Indexes**
* `idx_requests_employee_id`: Applied to instantly retrieve an individual user's history without scanning the entire table.
* `idx_requests_status_priority`: A composite index on `status` and `priority` to allow the HR dashboard queue to load and sort urgent tickets instantly.