# Internal Operations Service Hub

An internal service hub for submitting, routing, tracking, and resolving employee requests.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### 1. Clone and install

```bash
git clone https://github.com/francois-maarbess/eurisko-hr-hub.git
cd eurisko-hr-hub
cp .env.example .env   # Windows CMD: copy .env.example .env
npm install
cd frontend && npm install && cd ..
```

Need a pristine demo database any time (tests and experiments pollute
`dev.db`, which is local-only and gitignored):

```bash
npm run db:reset
```

> The real `.env` is gitignored and never committed — only `.env.example`
> is in the repo. Optional: set `GROQ_API_KEY` in `.env` (free key from
> https://console.groq.com) to enable the LLM provider for AI intake.
> Without it, the built-in offline extractor handles everything.

### 2. Set up the database

```bash
npx prisma generate
npx prisma migrate dev
npx tsx prisma/seed.ts
```

### 3. Start the app

```bash
# Terminal 1 — Backend (port 3000)
npm run start:dev

# Terminal 2 — Frontend (port 5173)
cd frontend && npm run dev
```

### 4. Use the app

1. Open `http://localhost:5173`
2. Log in with email + password (demo password for all seeded accounts: `Password123!`):
   - `alice@acme.com` — Employee (creates requests)
   - `bob@acme.com` — IT + HR Agent (claims & resolves)
   - `carol@acme.com` — Finance Agent
   - `admin@acme.com` — System Admin (manages users in the Administration panel)
3. Create a request (or draft one with ✨ AI), claim it as an agent, resolve it

## Running Tests

```bash
npm test      # 62 tests (all deterministic, SQLite)
npm run eval:ai  # 8 AI eval cases (offline, no key, no DB)
```

62 tests covering:
- **Unit**: Status transitions (10) + AI extractor/validation/fallback/sensitive/off-topic (10) + password accounts (6) + purge & duplicate scoring (3)
- **Integration**: Prisma ↔ SQLite database lifecycle (3)
- **E2E (30)**: Full HTTP flow with auth, scoped views, create, claim, complete, documents lifecycle, notifications, duplicates, report, manager memberships, owner-cancel/admin-claim rules, validation, regression + AI draft endpoint + catalog + admin user lifecycle

## AI-Assisted Intake (Week 4)

Type rough words in the **✨ Draft with AI** box and the backend returns a
structured draft candidate (department, type, title, description, priority,
confidence). You review it, then Submit creates the request through the
normal validated flow — the AI never creates anything.

- Default provider is a built-in offline extractor (no key, no network).
- Set `GROQ_API_KEY` to use an LLM provider instead (any failure falls back
  to the offline extractor).
- Details: `docs/week4-production-ai.md`

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/login` | No | Login with email + password, returns JWT |
| `GET` | `/auth/me` | Yes | Get current user profile |
| `GET` | `/auth/users` | Admin | List all users (no password hashes) |
| `POST` | `/auth/users` | Admin | Create a user with password + optional department |
| `PATCH` | `/auth/users/:id` | Admin | Activate/deactivate a user |
| `PATCH` | `/auth/users/:id/role` | Admin | Change platform role (EMPLOYEE/SYSTEM_ADMIN) |
| `POST` | `/auth/users/:id/memberships` | Admin | Add/update a department membership |
| `DELETE` | `/auth/users/:id/memberships/:departmentId` | Admin | Remove a department membership |
| `GET` | `/auth/memberships` | Yes | My active department memberships |
| `GET` | `/catalog/departments` | Yes | List active departments |
| `GET` | `/catalog/request-types` | Yes | List active request types (filterable by department) |
| `POST` | `/departments` | Admin | Create a department |
| `PATCH` | `/departments/:id` | Admin | Edit a department (name, description, active) |
| `POST` | `/departments/:id/request-types` | Admin | Create a request type in a department |
| `PATCH` | `/departments/:deptId/request-types/:typeId` | Admin | Edit a request type (incl. active flag) |
| `GET` | `/departments/:id/members` | Manager | List department members |
| `POST` | `/departments/:id/members` | Manager | Add/update a member (AGENT/MANAGER) |
| `DELETE` | `/departments/:id/members/:userId` | Manager | Remove a member |
| `POST` | `/requests/:id/documents` | Staff | Upload PDF/PNG/JPEG (max 5MB, content-verified) |
| `GET` | `/requests/:id/documents` | Staff/owner* | List attachments (*owner only when terminal) |
| `GET` | `/requests/:id/documents/:docId/download` | Staff/owner* | Download brokered by the API, never public |
| `DELETE` | `/requests/:id/documents/:docId` | Staff | Delete (payload purged, audit kept) |
| `POST` | `/requests/check-duplicates` | Yes | Warn about similar open tickets (advisory) |
| `GET` | `/requests/report` | Admin | Counts by status + per-department open/total |
| `GET` | `/notifications` | Yes | My inbox (newest first) |
| `GET` | `/notifications/unread-count` | Yes | Unread badge number |
| `PATCH` | `/notifications/:id/read` | Yes | Mark one read |
| `PATCH` | `/notifications/read-all` | Yes | Mark all read |
| `GET` | `/requests` | Yes | My requests (default); `?view=queue` (dept staff) or `?view=claimed` |
| `GET` | `/requests/:id` | Yes | Get single request |
| `POST` | `/requests` | Yes | Create a new request |
| `POST` | `/requests/ai-draft` | Yes | Draft a ticket from free text (advisory, creates nothing) |
| `PATCH` | `/requests/:id/claim` | Yes | Claim a pending request (dept members only) |
| `PATCH` | `/requests/:id/status` | Yes | Update request status |
| `PATCH` | `/requests/:id/reroute` | Manager | Re-route ticket to another department |
| `GET` | `/requests/:id/activity` | Staff/owner | Chronological labeled activity timeline |
| `GET` | `/requests/:id/notes` | Staff | View private internal staff notes |
| `POST` | `/requests/:id/notes` | Staff | Post private internal staff note |
| `POST` | `/requests/:id/feedback` | Owner | Rate resolution (1-5 stars) and optional feedback |
| `GET` | `/requests/export` | Admin | Export all requests to CSV |
| `PATCH` | `/auth/password` | Yes | Change user password |
| `GET` | `/health` | No | API and database health check |

## Accounts & Authorization

- Passwords are bcrypt-hashed (pure-JS `bcryptjs`, no native toolchain).
- Login rejects unknown users, wrong passwords, inactive and passwordless
  accounts with the same 401 (no account enumeration).
- `SYSTEM_ADMIN` (via `@Roles`) manages users; department membership
  (`AGENT`/`MANAGER`) gates claiming; owners can never resolve their own
  requests. One person may serve several departments.
- Owners can never claim their own requests (409, no exceptions).
- Only the owner can cancel, and only while `PENDING` (others get 403).
- Reading a ticket requires ownership, department membership, or admin
  role (strangers get 403, existence never confirmed).
- System admins operate every department (claim/resolve) without needing
  membership; department managers run their own members and catalog.

## Project Structure

```
├── src/
│   ├── ai/                # Week 4: intake providers, validation, draft endpoint
│   ├── auth/              # Password accounts, JWT, roles guard
│   ├── catalog.controller.ts  # Departments + request types (form pickers)
│   ├── dto/               # Request validation DTOs
│   ├── prisma.service.ts  # Prisma client factory
│   ├── prisma.module.ts   # Global Prisma module
│   ├── requests.controller.ts
│   ├── requests.service.ts
│   └── main.ts
├── scripts/
│   └── eval-ai.ts         # 8 AI eval cases (`npm run eval:ai`)
├── prisma/
│   ├── schema.prisma      # Database schema
│   ├── seed.ts            # Seed data
│   └── migrations/
├── test/
│   ├── app.e2e-spec.ts    # E2E tests
│   └── integration.spec.ts
├── frontend/
│   └── src/
│       ├── App.tsx
│       ├── LoginPage.tsx          # Email + password login
│       ├── CreateRequestForm.tsx  # Catalog pickers + ✨ AI draft box
│       ├── TicketStatusManager.tsx
│       └── AdminPanel.tsx         # Admin-only user management
└── docs/
    ├── week3-full-stack-delivery.md
    └── week4-production-ai.md
```

## Documentation

- `docs/product-spec.md` — Product scope and requirements
- `docs/data-model.md` — Entities, constraints, and state machine
- `docs/architecture.md` — Components and flows
- `docs/week3-full-stack-delivery.md` — Week 3 delivery details
- `docs/week4-production-ai.md` — Week 4 AI intake details + eval guide
- `docs/decisions/ADR-002.md` — Password auth + single-company scope (SSO deferred)
- `docs/decisions/ADR-003.md` — Document storage backend (DB bytea on localhost, S3 seam)
