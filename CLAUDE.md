# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An open-source, AI-assisted personal CRM for a job search. A user connects their inbox via Postmark inbound email; the system classifies recruiter emails, matches them to applications, advances the pipeline, queues human approvals for uncertain actions, tracks goals/activity, and emails a daily brief. It is a single full-stack TypeScript app: a React SPA plus an Express server that **also serves the built SPA from the same process** in production.

## Commands

```bash
pnpm install          # pnpm is the package manager (see packageManager pin)

pnpm dev:all          # run API (:3001) + Vite (:5173) together — normal dev loop
pnpm dev:server       # API only (tsx watch), :3001
pnpm dev              # Vite only, :5173, proxies /api → :3001

pnpm typecheck        # tsc for BOTH configs: frontend + tsconfig.server.json
pnpm lint             # ESLint (src only — server code is not linted)
pnpm test             # Jest, all *.test.ts(x), with coverage
pnpm build            # runs typecheck, then vite build → dist/
pnpm start            # production: single server serving dist/ + API

# Database (Drizzle + SQLite)
pnpm db:generate      # generate a migration from schema.ts changes
pnpm db:push          # push schema directly (dev convenience)
pnpm db:studio        # Drizzle Studio

# Cypress e2e
pnpm cypress:open / pnpm cypress:run
```

**Run a single test:** `pnpm jest path/to/file.test.ts` (or `pnpm jest -t "test name"`). `pnpm test` always collects coverage; call `jest` directly to skip it.

**`scripts/verify.sh`** runs lint + test + build — the pre-commit gate. `scripts/safe-run.sh` only allows an allowlist of commands (test/lint/typecheck/build/prettier/node/tsx).

## Critical gotchas

- **Two TypeScript projects.** `tsconfig.json` covers `src/` (frontend); `tsconfig.server.json` covers `server/`. `pnpm typecheck` runs both — always check both when changing shared-looking types. Server is ESM (`NodeNext`) and **imports must use `.js` extensions** (e.g. `import { createDb } from './db/index.js'`) even though the files are `.ts`.
- **Migrations are maintained in two places.** `server/db/schema.ts` (Drizzle) and the raw SQL in `server/db/migrations/`. Both must be kept in sync by hand. `migrate()` runs on every server boot (`server/db/index.ts`), applying anything in the migrations folder. Read the numbered migrations in order — they are effectively the product's changelog.
- **`server/lib/` is not linted.** ESLint is scoped to `src`. Don't assume lint will catch server issues; rely on typecheck + tests.

## Architecture

### Backend (`server/`)
Function modules, not classes/DI. Wiring lives in `server/app.ts`.

- **Auth boundary:** `app.use('/api', requireAuth)` gates all `/api/*` routes. `/auth/*`, `/webhooks/postmark/*`, and `/api/cron/*` are outside it. Sessions are **stateless HMAC-signed cookies** (`server/lib/session.ts`) — there is no server-side session store or revocation. Login is Google OAuth (`server/routes/auth.ts`).
- **Generic CRUD:** `server/lib/crudRouter.ts` is a factory that generates a full REST router for a table. Applications, contacts, communications, interviews, follow-up tasks, and documents all use it (`server/routes/index.ts`). Every query is scoped by `userId` via `byIdAndUser` — this is the central authorization pattern; preserve it on any new table.
- **Persistence:** SQLite (better-sqlite3) through Drizzle ORM, single file. `getDbPath()` resolves to `/data/jobsearch.sqlite` in production, `./data/` in dev. Single-instance only (no horizontal scaling). All timestamps are ISO **text** columns; booleans are integer columns.

### The inbound email pipeline (the core of the product)
Most complexity lives here. Follow one email in execution order:

1. **Ingest** — `POST /webhooks/postmark/inbound` (`server/routes/postmarkInbound.ts`) → optional basic auth (`postmarkWebhookAuth.ts`, open if creds unset) → `saveInboundEmail` stores the raw payload as JSON. Ingestion never fails the request even on error.
2. **Schedule** — `inboundEmailProcessingQueue.ts` fires processing via **in-process `setImmediate`** (fire-and-forget; no durable queue, retries, or backoff).
3. **Orchestrate** — `inboundEmailProcessingService.ts::processInboundEmail` is the spine: resolve owning user → classify → analyze → apply safe rules → audit. It writes a step-by-step **processing timeline** onto the row as it goes.
4. **Classify** — `emailClassificationService.ts` → `emailClassificationEngine.ts`. **LLM-first with rule-based fallback**: if `OPENAI_API_KEY` is set it calls an OpenAI-compatible chat API; otherwise (or on failure) deterministic keyword rules classify. Forwarded emails are unwrapped by `emailForwardedParser.ts` / `emailContentExtraction.ts`, and the "original" sender/subject/company fields drive downstream matching.
5. **Analyze & apply** — `emailAutomationService.ts` (large, ~1300 LOC — read it by function, not top to bottom): `analyzeEmailAutomation` matches the email to an application (`emailApplicationMatcher.ts`) and proposes a pipeline change (`emailPipelineAutomation.ts`); `emailProcessingAutomation.ts` is the "safe rules" gate.

### Human-in-the-loop (the product's core philosophy)
Automation is **confidence-gated**. High-confidence actions apply automatically; low-confidence ones become **pending approvals** with explainable reasons (`approvalReason.ts`, `automationOutcomeMessages.ts`) rather than silent mutations. Every automated decision is written to an **audit log**. `resolvePendingApproval` executes or discards a queued action on user decision. When changing automation behavior, keep this gate intact and update the audit trail. The epic-level tests (`explainableApprovalEpic.test.ts`, `pipelineAccuracyEpic.test.ts`, `pathstreamInterviewEmail.test.ts`) are the clearest behavioral spec — treat them as documentation.

### Periphery (independent subsystems)
- **Daily briefings:** `dailyBriefingScheduler.ts` (a `setInterval` that runs once/day after a configured UTC hour) → `briefingGenerator.ts` → `briefingAggregator.ts` → `briefingEmail.ts`. Rule-based summary fallback when no LLM.
- **Metrics/goals:** `activityMetricsCore.ts`, streaks and funnel metrics; `jobSearchGoals`.

### Frontend (`src/`)
React 18 + Vite + Zustand + React Router 7 + Tailwind. `App.tsx` composes `AuthGate` (skipped in demo mode) → `AppBootstrap` → routed pages. State lives in `src/store/useJobSearchStore.ts` (the domain data store) and `useAuthStore.ts`; stores do **optimistic updates** then reconcile with the API. Typed API clients live in `src/api/*Client.ts` and talk to the Express backend. Persistence mode (`api` vs `demo`/localStorage) is chosen by `VITE_PERSISTENCE_MODE` via `src/api/persistence.ts`.

There is **one** persistence architecture: Express + SQLite + Drizzle, reached through `src/api/jobSearchClient.ts`. (An earlier Supabase/Prisma "job queue" prototype was removed; do not reintroduce a second data layer.) Note: `docs/` is a committed built demo bundle, not source.

## Testing notes
Tests are co-located (`*.test.ts(x)`) and coverage is unusually good — read a module's test first when unsure of intent. Jest maps `src/lib/env` → `src/lib/env.jest.ts` and stubs CSS/image imports (see `jest.config.js`). The email-processing scheduler has test hooks (`setInboundEmailProcessingScheduler` / `resetInboundEmailProcessingScheduler`) so processing can be driven synchronously in tests.

## Environment
Server requires `SESSION_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. Also uses `APP_URL`, `FRONTEND_URL`, `CORS_ORIGIN` (set all three to the public origin in production), `DATABASE_PATH`, `PORT`. LLM: `OPENAI_API_KEY` (+ optional `OPENAI_MODEL`, `OPENAI_BASE_URL`). Postmark: `POSTMARK_SERVER_TOKEN`, `POSTMARK_FROM_EMAIL`, and optional webhook auth `POSTMARK_WEBHOOK_USER` / `POSTMARK_WEBHOOK_PASSWORD`. Briefing schedule: `DAILY_BRIEFING_HOUR_UTC`, `DAILY_BRIEFING_AUTO_SCHEDULE`. Frontend: `VITE_PERSISTENCE_MODE`, optional `VITE_API_BASE_URL`. See `.env.example` and README for the full list. Deploys to Fly.io (Docker) with SQLite on a mounted `/data` volume.
