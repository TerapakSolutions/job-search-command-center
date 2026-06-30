# Job Search Command Center

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

An open-source **TypeScript + React** app for managing your job search pipeline — track applications, communications, pipeline stages, and daily follow-up actions. Phase 1 adds **SQLite persistence** via a lightweight Express API (Drizzle ORM), with optional browser-only demo mode.

## Features

- **Application tracking** — company, role, URL, location/remote/hybrid, salary range, date applied, status, notes, interview dates
- **Pipeline dashboard** — kanban-style board with stages: Saved, Applied, Recruiter screen, Interviewing, Final round, Offer, Rejected, Ghosted/archived
- **Communication tracker** — recruiter/contact name, email, LinkedIn, last contact date, message notes, next action (linked to applications)
- **Follow-up reminders** (client-side rules):
  - Applied 7+ days with no contact → follow up
  - Recruiter screen, no reply in 3 business days → ping
  - Interview within 3 days → prep reminder
  - Stale saved/applied roles → review/archive
- **Daily action view** — "What should I do today?" with due reminders, upcoming interviews, and contact next actions
- **Settings** — export/import JSON backup, clear data, persistence mode info
- **SQLite backend** — applications, contacts, communications, follow-up tasks, interviews, documents (REST CRUD)
- **AI assist** — placeholder only (fit score, resume tailoring, etc. deferred)

## Tech stack

- [React 18](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/)
- [Vite](https://vitejs.dev/) for dev/build
- [Tailwind CSS](https://tailwindcss.com/) for styling
- [Zustand](https://github.com/pmndrs/zustand) for client state
- [Express](https://expressjs.com/) + [Drizzle ORM](https://orm.drizzle.team/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3)
- [React Router](https://reactrouter.com/) for navigation

## Getting started

### Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/) (recommended)

### Install

```bash
git clone <your-repo-url>
cd job-search-command-center
pnpm install
```

### Run locally (API + frontend)

Start both the SQLite API server and Vite dev server:

```bash
pnpm dev:all
```

- Frontend: [http://localhost:5173/](http://localhost:5173/)
- API: [http://localhost:3001/api/health](http://localhost:3001/api/health)
- SQLite file: `./data/jobsearch.sqlite` (created automatically on first request)

Or run separately:

```bash
pnpm dev:server   # API on :3001
pnpm dev          # Vite on :5173 (proxies /api → :3001)
```

### Database migrations

Migrations run automatically when the server starts. To regenerate schema migrations after changing `server/db/schema.ts`:

```bash
pnpm db:generate
pnpm db:push      # optional: push schema directly in dev
```

### Demo mode (localStorage only)

No backend required — useful for quick demos or offline use:

```bash
# .env
VITE_PERSISTENCE_MODE=demo
pnpm dev
```

Data is stored under the localStorage key `job-search-command-center`.

### Other commands

```bash
pnpm typecheck   # Frontend + server TypeScript
pnpm build       # Production frontend build
pnpm start       # Production server (serves dist/ + API)
pnpm lint        # ESLint
pnpm test        # Jest unit tests
```

With the safe-run wrapper:

```bash
scripts/safe-run.sh "pnpm typecheck"
scripts/safe-run.sh "pnpm lint"
scripts/safe-run.sh "pnpm test"
```

## Project structure

```
server/
  db/             # Drizzle schema, migrations, SQLite connection
  routes/         # CRUD route factories per entity
  lib/            # Shared server helpers
  index.ts        # Express entry (API + static SPA)
src/
  api/            # REST client + persistence mode helpers
  types/          # Domain types
  lib/            # dates, reminders logic, id helper
  store/          # useJobSearchStore (API or localStorage)
  components/     # Forms, pipeline board, modal, AI placeholder
  pages/          # Today, Pipeline, Applications, Contacts, Settings
```

## Persistence modes

| Mode | Env var | Storage |
|------|---------|---------|
| **API** (default) | `VITE_PERSISTENCE_MODE=api` | SQLite via Express REST API |
| **Demo** | `VITE_PERSISTENCE_MODE=demo` | Browser localStorage (Zustand persist) |

In API mode the frontend loads data on startup and syncs mutations optimistically. If the API is unreachable, a banner suggests switching to demo mode.

## REST API

Base path: `/api`

| Resource | Endpoints |
|----------|-----------|
| Health | `GET /api/health` |
| Applications | `GET/POST /api/applications`, `GET/PUT/DELETE /api/applications/:id` |
| Contacts | `GET/POST /api/contacts`, `GET/PUT/DELETE /api/contacts/:id` |
| Communications | `GET/POST /api/communications`, `GET/PUT/DELETE /api/communications/:id` |
| Follow-up tasks | `GET/POST /api/follow-up-tasks`, `GET/PUT/DELETE /api/follow-up-tasks/:id` |
| Interviews | `GET/POST /api/interviews`, `GET/PUT/DELETE /api/interviews/:id` |
| Documents | `GET/POST /api/documents`, `GET/PUT/DELETE /api/documents/:id` |

## SQLite on Fly.io (cost-conscious deployment)

This project uses **embedded SQLite** instead of a managed Postgres instance to keep hosting costs low for a single-user / small-team job search tool.

### Why SQLite on Fly?

- **No separate database bill** — one Fly machine + one persistent volume
- **Simple ops** — single file at `/data/jobsearch.sqlite`, WAL mode enabled
- **Enough for this workload** — low write volume, one app instance

### Trade-offs

- Single-machine writes (no horizontal scaling without replication)
- You manage backups (export JSON from Settings, or snapshot the volume)
- Not ideal for high-concurrency multi-tenant SaaS

### Deploy

```bash
# One-time: create persistent volume (1 GB is plenty)
fly volumes create jobsearch_data --region sjc --size 1

fly launch   # or fly deploy after configuring fly.toml
fly deploy
```

`fly.toml` mounts volume `jobsearch_data` at `/data`. Production DB path: `/data/jobsearch.sqlite`.

**Estimated cost:** shared-cpu-1x (~$2–5/mo) + 1 GB volume (~$0.15/mo) — far less than managed Postgres.

### Production env

```
NODE_ENV=production
DATABASE_PATH=/data/jobsearch.sqlite
PORT=8080
```

Build locally, then `pnpm build && pnpm start` — the server serves the Vite build and API on one port.

## Data & privacy

- **API mode:** data lives in your SQLite file on the server/volume you control
- **Demo mode:** data stays in the browser only
- Use **Settings → Export backup** for portable JSON backups in either mode

## Roadmap (not yet implemented)

- UI for communications, follow-up tasks, interviews, documents entities
- AI fit scoring and resume/cover letter assistance
- Drag-and-drop pipeline board
- Persistent reminder dismissals
- Updated E2E tests for new persistence layer

## License

MIT — see [LICENSE](LICENSE).
