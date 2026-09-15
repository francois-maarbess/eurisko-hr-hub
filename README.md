# Internal Operations Service Hub

An internal service hub for submitting, routing, tracking, and resolving employee requests.

## Quick Start

### Prerequisites

- Node.js 18+
- npm

### 1. Install dependencies

```bash
# Backend
cd eurisko-hr-hub-main
npm install

# Frontend
cd frontend
npm install
cd ..
```

### 2. Set up the database

```bash
npx prisma migrate dev --name init
npx tsx prisma/seed.ts
```

### 3. Start the backend (terminal 1)

```bash
npm run start:dev
```

Backend runs on `http://localhost:3000`.

### 4. Start the frontend (terminal 2)

```bash
cd frontend
npm run dev
```

Frontend runs on `http://localhost:5173`.

### 5. Use the app

1. Open `http://localhost:5173`
2. Log in as `alice@acme.com` (employee) or `bob@acme.com` (IT agent)
3. Create a request, claim it, resolve it

## Running Tests

```bash
npm test
```

This runs:
- **Unit test**: Status transition business rules (10 cases)
- **Integration test**: Prisma ↔ SQLite database lifecycle
- **E2E test**: Full HTTP flow with auth, create, claim, complete, authorization, validation, regression

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
│   └── integration.spec.ts # Integration tests
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
