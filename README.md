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
npm install
cd frontend && npm install && cd ..
```

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
2. Log in as `alice@acme.com` (employee) or `bob@acme.com` (IT agent)
3. Create a request, claim it, resolve it

## Running Tests

```bash
npm test
```

23 tests covering:
- **Unit**: Status transition business rules (10 cases)
- **Integration**: Prisma ↔ SQLite database lifecycle
- **E2E**: Full HTTP flow with auth, create, claim, complete, authorization, validation, regression

## API Endpoints

| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| `POST` | `/auth/login` | No | Login, returns JWT |
| `GET` | `/auth/me` | Yes | Get current user profile |
| `GET` | `/requests` | Yes | List all requests |
| `GET` | `/requests/:id` | Yes | Get single request |
| `POST` | `/requests` | Yes | Create a new request |
| `PATCH` | `/requests/:id/claim` | Yes | Claim a pending request (dept members only) |
| `PATCH` | `/requests/:id/status` | Yes | Update request status |

## Project Structure

```
├── src/
│   ├── auth/              # JWT auth (strategy, guard, controller, module)
│   ├── dto/               # Request validation DTOs
│   ├── prisma.service.ts  # Prisma client factory
│   ├── prisma.module.ts   # Global Prisma module
│   ├── requests.controller.ts
│   ├── requests.service.ts
│   └── main.ts
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
│       ├── LoginPage.tsx
│       ├── CreateRequestForm.tsx
│       └── TicketStatusManager.tsx
└── docs/
    └── week3-full-stack-delivery.md
```

## Documentation

- `docs/product-spec.md` — Product scope and requirements
- `docs/data-model.md` — Entities, constraints, and state machine
- `docs/architecture.md` — Components and flows
- `docs/week3-full-stack-delivery.md` — Week 3 delivery details
