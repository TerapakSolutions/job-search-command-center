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
- **AI Daily Executive Brief** — personalized daily pipeline summary with AI recommendations, recruiter email activity, follow-ups, and historical briefings (API mode)
- **Inbound email viewer** — browse Postmark inbound recruiter emails, AI classification, suggested actions, filter, and mark as reviewed (API mode)
- **Settings** — export/import JSON backup, clear data, persistence mode info
- **SQLite backend** — applications, contacts, communications, follow-up tasks, interviews, documents (REST CRUD)
- **AI assist** — daily executive brief implemented; fit score, resume tailoring, etc. still deferred

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

Create a `.env` file in the project root (see [Authentication](#authentication) below), then start both the SQLite API server and Vite dev server:

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
  pages/          # Today, Pipeline, Applications, Contacts, Inbound Emails, Settings
```

## Persistence modes

| Mode | Env var | Storage |
|------|---------|---------|
| **API** (default) | `VITE_PERSISTENCE_MODE=api` | SQLite via Express REST API |
| **Demo** | `VITE_PERSISTENCE_MODE=demo` | Browser localStorage (Zustand persist) |

In API mode the frontend loads data on startup and syncs mutations optimistically. If the API is unreachable, a banner suggests switching to demo mode.

## Authentication

API mode requires **Google sign-in**. On first login a user row is created in SQLite; all applications, contacts, communications, follow-up tasks, interviews, and documents are scoped to that user.

### Required env vars (API mode)

```bash
# Server
GOOGLE_CLIENT_ID=your-google-oauth-client-id
GOOGLE_CLIENT_SECRET=your-google-oauth-client-secret
SESSION_SECRET=long-random-string-for-signing-session-cookies

# OAuth redirect (dev defaults shown)
APP_URL=http://localhost:3001
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
```

Register this redirect URI in Google Cloud Console:

`http://localhost:3001/auth/google/callback`

In production (single server serving API + SPA), set `APP_URL` and `FRONTEND_URL` to your public origin (e.g. `https://your-app.fly.dev`).

### Auth endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /auth/google` | Redirect to Google OAuth |
| `GET /auth/google/callback` | OAuth callback; sets HttpOnly session cookie |
| `GET /auth/me` | Current signed-in user (401 if not authenticated) |
| `POST /auth/logout` | Clears session cookie |

All `/api/*` routes (except `GET /api/health`) require a valid session cookie.

### Migrating existing SQLite data

Migration `0001_auth_users` adds a `users` table and `user_id` columns to all entity tables. **Existing rows without a `user_id` are orphaned** and will not appear after sign-in. Export JSON from Settings before upgrading, then re-import after logging in, or delete `./data/jobsearch.sqlite` for a fresh start.

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
| Daily briefings | `GET /api/daily-briefings/latest`, `GET /api/daily-briefings`, `GET /api/daily-briefings/:id`, `POST /api/daily-briefings/generate` |
| Inbound emails | `GET /api/inbound-emails`, `GET /api/inbound-emails/:id`, `PATCH /api/inbound-emails/:id`, `POST /api/inbound-emails/:id/classify`, `POST /api/inbound-emails/classify-unprocessed` |

### Inbound emails (Postmark)

Postmark inbound webhooks store emails in SQLite (`POST /webhooks/postmark/inbound`). The webhook path only persists the raw payload and returns quickly — **no AI runs on ingest**. Classification happens later via the API or the **Analyze** buttons in the UI.

The **Inbound Emails** page (`/inbound-emails`) lets authenticated users browse emails matched to their account — by their sign-in email address or sender addresses that match their contacts. Each email can be classified into types such as **Interview Request**, **Application Confirmation**, **Rejection**, and more, with extracted fields (company, role, recruiter), an AI summary, and a suggested next action.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/inbound-emails` | Session | Paginated list (newest first). Query: `limit`, `offset`, `processed`, `sender`, `subject`, `fromDate`, `toDate` |
| `GET /api/inbound-emails/:id` | Session | Full detail including plain text, HTML body, and classification fields |
| `PATCH /api/inbound-emails/:id` | Session | Mark reviewed/processed: `{ "processed": true }` |
| `POST /api/inbound-emails/:id/classify` | Session | Run AI/rule-based classification. Body: `{ "force": true }` to re-analyze |
| `POST /api/inbound-emails/classify-unprocessed` | Session | Classify up to `limit` (default 20, max 50) emails without `processed_at` |

List responses include classification summary fields (`classification`, `classificationConfidence`, `suggestedAction`, `requiresResponse`, `processedAt`). Detail responses add full extraction (`companyName`, `positionTitle`, `recruiterName`, `actionDueAt`, `interviewDetected`, `interviewDatetime`, `aiSummary`). Emails belonging to other users return `404`.

**Classification behavior:** When `OPENAI_API_KEY` is set, the app calls an OpenAI-compatible chat API with structured JSON output. If the LLM is unavailable or fails, a deterministic keyword-based fallback classifies common patterns (e.g. “thank you for applying” → Application Confirmation). Classification failures never block email ingestion.

Optional webhook auth env vars: `POSTMARK_WEBHOOK_USER`, `POSTMARK_WEBHOOK_PASSWORD`.

### Daily executive brief

Each authenticated user receives at most **one briefing per calendar day (UTC)**. Briefings aggregate pipeline stats, recruiter emails (communications + Postmark inbound), applications submitted, upcoming interviews, follow-ups, inactive applications, and rule-based + AI recommendations.

| Endpoint | Auth | Description |
|----------|------|-------------|
| `GET /api/daily-briefings/latest` | Session | Latest briefing for current user |
| `GET /api/daily-briefings?limit=30` | Session | Historical briefings (newest first) |
| `GET /api/daily-briefings/:id` | Session | Single briefing by ID (user-scoped) |
| `POST /api/daily-briefings/generate` | Session | Generate today's briefing (`{ "force": true }` to regenerate) |
| `POST /api/cron/daily-briefings` | `CRON_SECRET` | Batch-generate for all users (external cron) |

**Automated generation:** On server start, an hourly scheduler runs once per day after `DAILY_BRIEFING_HOUR_UTC` (default `6`). Set `DAILY_BRIEFING_AUTO_SCHEDULE=false` to disable. For production, prefer an external cron hitting `POST /api/cron/daily-briefings` with `Authorization: Bearer $CRON_SECRET`.

**Optional env vars:**

```bash
# AI summary (OpenAI-compatible API)
OPENAI_API_KEY=sk-...
OPENAI_MODEL=gpt-4o-mini          # optional
OPENAI_BASE_URL=https://api.openai.com/v1  # optional

# Scheduling
DAILY_BRIEFING_AUTO_SCHEDULE=true  # set false to disable in-process scheduler
DAILY_BRIEFING_HOUR_UTC=6
CRON_SECRET=long-random-string     # for POST /api/cron/daily-briefings

# Optional email delivery via Postmark
DAILY_BRIEFING_EMAIL_ENABLED=true
POSTMARK_SERVER_TOKEN=...
POSTMARK_FROM_EMAIL=briefings@yourdomain.com
```

Without `OPENAI_API_KEY`, briefings use a deterministic rule-based summary fallback. The Today page displays the latest briefing in API mode.

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
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
SESSION_SECRET=...
APP_URL=https://your-app.fly.dev
FRONTEND_URL=https://your-app.fly.dev
CORS_ORIGIN=https://your-app.fly.dev
```

Build locally, then `pnpm build && pnpm start` — the server serves the Vite build and API on one port.

## Data & privacy

- **API mode:** data lives in your SQLite file on the server/volume you control
- **Demo mode:** data stays in the browser only
- Use **Settings → Export backup** for portable JSON backups in either mode

## Roadmap (not yet implemented)

- UI for communications, follow-up tasks, interviews, documents entities
- AI fit scoring and resume/cover letter assistance (beyond daily brief)
- Drag-and-drop pipeline board
- Persistent reminder dismissals
- Updated E2E tests for new persistence layer

## License

MIT — see [LICENSE](LICENSE).
