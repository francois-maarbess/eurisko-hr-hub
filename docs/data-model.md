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


I absolutely will. Translating this file from "architect speak" into what you are actually going to build next week is the best way to prepare for your interview.

Let's break down exactly what every concept in data-model.md means for you as the backend developer, and then we will get this folder pushed to GitHub so you can email the link to the academy before tomorrow's 12:00 PM deadline.

Part 1: Translating data-model.md into Developer Logic
1. "Three core entities (users, requests, audit_logs)"

Entities: This just means you are going to create exactly three tables in your PostgreSQL database. Nothing more, nothing less.

2. "State Transitions ... strictly flow forward"

What this means for your code: Next week, you will write an if statement in your backend API. If a ticket is currently COMPLETED, and someone sends a request to change it back to PENDING, your code will return an HTTP 400 Bad Request. The database will physically block it.

3. "Invariants (Database-Level Enforcement)"

Invariants: This means "rules that cannot be broken under any circumstances, even if there is a bug in the code."

Resolution Rule: When you build the database, you will add a CHECK constraint. It tells the database: "If status = COMPLETED, then either document_url is NOT NULL, or resolution_note is NOT NULL." If both are empty (NULL), PostgreSQL will throw an error and refuse to save the row.

Immutability Rule / Append-Only Ledger: "Immutable" means unchangeable. When you set up the audit_logs table, you will configure the database permissions so that the backend API is only allowed to run INSERT commands. If a hacker or a rogue HR admin tries to run an UPDATE or DELETE command on the audit log, the database will block them.

4. "Authorization-Sensitive Rules"

enum: An "enum" (enumeration) is a strict list of allowed values. For the role column, the database will only accept the exact strings "EMPLOYEE" or "HR_ADMIN". If someone tries to save a user as "SUPER_BOSS", the database rejects it.

5. "Access Patterns & Indexes"

Access Patterns: These are simply the SQL SELECT statements your React Native app will ask your backend to run the most frequently.

Indexes: Imagine a database table with 100,000 tickets. If an employee logs in and wants to see their 3 tickets, the database usually has to scan all 100,000 rows to find them. An Index is like the alphabetical index at the back of a textbook. idx_requests_employee_id tells PostgreSQL to keep a tiny, highly organized shortcut list of employee IDs in its RAM. When you ask for your tickets, the database uses the index to jump straight to your 3 tickets in milliseconds.