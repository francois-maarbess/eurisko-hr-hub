# Week 3 — Full-Stack Delivery

## What was built

A narrow, end-to-end **Service Request** flow: an employee creates an IT support request, a department agent claims it, and the agent resolves it with a resolution note.

## Architecture

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite (TypeScript) |
| Backend | NestJS 11 (TypeScript) |
| Database | Prisma 7 + SQLite |
| Auth | JWT (passport-jwt) |

## The Flow

1. **Login** — User enters email → receives JWT token
2. **Create Request** — Employee selects department + request type, fills title/description/priority → `POST /requests`
3. **Claim** — IT agent claims the request → `PATCH /requests/:id/claim`
4. **Resolve** — Agent adds resolution note → `PATCH /requests/:id/status` with `COMPLETED`

## API Contract

### `POST /auth/login`
```json
Request:  { "email": "alice@acme.com" }
Response: { "accessToken": "eyJ..." }
```

### `POST /requests` (requires JWT)
```json
Request:  { "departmentId": "...", "requestTypeId": "...", "title": "...", "description": "...", "priority": "URGENT" }
Response: { "id": "...", "status": "PENDING", ... }
```

### `PATCH /requests/:id/claim` (requires JWT, must be dept member)
```json
Response: { "id": "...", "status": "IN_PROGRESS", "claimant": {...} }
```

### `PATCH /requests/:id/status` (requires JWT)
```json
Request:  { "status": "COMPLETED", "resolutionNote": "Done." }
Response: { "id": "...", "status": "COMPLETED", "resolutionNote": "Done." }
```

## Authorization Rule

**Allowed:** Bob (IT department member) can claim IT requests.
**Denied:** Alice (employee, not an IT member) cannot claim IT requests → `409 Conflict`.

## Invalid Request (Rejected on Purpose)

Creating a request with `priority: "INVALID"` or a field not in the DTO (`sneakyField`) → `400 Bad Request` via `ValidationPipe` with `forbidNonWhitelisted: true`.

## Expected Failure (Handled on Purpose)

Completing a request without a `resolutionNote` → `400 Bad Request` with message: "A resolution note is required when transitioning to COMPLETED".

## Tests

| Type | What it covers | File |
|------|---------------|------|
| **Unit test** | Status transition rules (10 cases: valid + invalid + terminal) | `src/requests.service.spec.ts` |
| **Integration test** | Prisma ↔ SQLite: create → claim → complete lifecycle, relation verification | `test/integration.spec.ts` |
| **E2E test** | Full HTTP flow: auth, create, claim, complete, authorization denial, invalid transitions, DTO validation, regression | `test/app.e2e-spec.ts` |

### Run tests
```bash
npm test
```

## Regression Protection

The E2E tests verify that:
- COMPLETED requests cannot be reopened
- PENDING → COMPLETED (skip) is rejected
- Invalid DTOs are rejected by ValidationPipe
- Unauthenticated requests return 401

## Seeded Data

| User | Email | Role | Department |
|------|-------|------|-----------|
| Alice Employee | alice@acme.com | EMPLOYEE | — |
| Bob Agent | bob@acme.com | EMPLOYEE | IT (AGENT) |
| Admin User | admin@acme.com | SYSTEM_ADMIN | IT (MANAGER) |

| Request | Department | Status |
|---------|-----------|--------|
| Laptop Request (req-1) | IT | PENDING |
| VPN Access Request (req-2) | IT | IN_PROGRESS |
| Employment Letter (req-3) | HR | COMPLETED |
