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
2. Log in as `alice@acme.com` (employee) or `bob@acme.com` (IT agent)
3. Create a request, claim it, resolve it

## Running Tests

```bash
npm test      # 33 tests (all deterministic, SQLite)
npm run eval:ai  # 6 AI eval cases (offline, no key, no DB)
```

33 tests covering:
- **Unit**: Status transition business rules (10 cases) + AI extractor/validation/fallback (8 cases)
- **Integration**: Prisma ↔ SQLite database lifecycle
- **E2E**: Full HTTP flow with auth, create, claim, complete, authorization, validation, regression + AI draft endpoint

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
| `POST` | `/auth/login` | No | Login, returns JWT |
| `GET` | `/auth/me` | Yes | Get current user profile |
| `GET` | `/requests` | Yes | List all requests |
| `GET` | `/requests/:id` | Yes | Get single request |
| `POST` | `/requests` | Yes | Create a new request |
| `POST` | `/requests/ai-draft` | Yes | Draft a ticket from free text (advisory, creates nothing) |
| `PATCH` | `/requests/:id/claim` | Yes | Claim a pending request (dept members only) |
| `PATCH` | `/requests/:id/status` | Yes | Update request status |

## Project Structure

```
├── src/
│   ├── ai/                # Week 4: intake providers, validation, draft endpoint
│   ├── auth/              # JWT auth (strategy, guard, controller, module)
│   ├── dto/               # Request validation DTOs
│   ├── prisma.service.ts  # Prisma client factory
│   ├── prisma.module.ts   # Global Prisma module
│   ├── requests.controller.ts
│   ├── requests.service.ts
│   └── main.ts
├── scripts/
│   └── eval-ai.ts         # 6 AI eval cases (`npm run eval:ai`)
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
    ├── week3-full-stack-delivery.md
    └── week4-production-ai.md
```

## Documentation

- `docs/product-spec.md` — Product scope and requirements
- `docs/data-model.md` — Entities, constraints, and state machine
- `docs/architecture.md` — Components and flows
- `docs/week3-full-stack-delivery.md` — Week 3 delivery details
- `docs/week4-production-ai.md` — Week 4 AI intake details + eval guide
