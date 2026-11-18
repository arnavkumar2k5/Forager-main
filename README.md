# Forager: Autonomous Trajectory-Aware Research Agent

[![Turborepo](https://img.shields.io/badge/Monorepo-Turborepo-ef4444.svg)](https://turbo.build/)
[![Next.js 15](https://img.shields.io/badge/Frontend-Next.js%2015-black.svg)](https://nextjs.org/)
[![Drizzle ORM](https://img.shields.io/badge/ORM-Drizzle-C5F74F.svg)](https://orm.drizzle.team/)
[![Fastify](https://img.shields.io/badge/Daemon-Fastify%20Port%204000-000000.svg)](https://fastify.dev/)
[![Python 3.11+](https://img.shields.io/badge/Evaluation-Python%203.11%2B-blue.svg)](https://www.python.org/)

**Forager** is an autonomous, trajectory-aware research agent and targeted web-monitoring platform built for Tier-1 academic publication (ACL, WWW, SIGIR) and high-throughput production deployment.

Unlike single-turn search scrapers or rigid cron-based pollers, Forager models the web as an information-foraging landscape. It navigates complex DOM hierarchies through a decoupled Explore-Critic state machine, prevents context inflation using atomic proposition diffing (OHCache), dynamically accelerates and relaxes polling intervals via environmental scent decay, and triangulates claims across independent root domains with leaf-node DOM grounding.

---

## 1. Core Research Contributions

Forager is engineered around four primary scientific innovations implemented in `@repo/agent-core`:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        FORAGER AGENT PIPELINE                          │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   1. EXPLORE-CRITIC LOOP (Inspired by WebWalker)                       │
│      Explorer: Thought -> Action (Search/Navigate/Extract) -> Obs      │
│      Critic: Scores relevance ∈ [0, 1] & prunes unpromising links      │
│                                                                        │
│   2. ATOMIC PROPOSITION DIFFING & OHCACHE (Inspired by AutoData)       │
│      • Never passes raw, massive HTML pages into primary LLM context.  │
│      • Raw payloads archived out-of-band in Supabase / Storage.        │
│      • Distills text into discrete atomic claims: P = {p1, p2, ...}    │
│      • Compares pgvector cosine similarities against historical state. │
│                                                                        │
│   3. ADAPTIVE SCENT-DRIVEN POLLING ENGINE                              │
│      Replaces fixed cron with information scent decay:                 │
│      Δt_next = Δt_base · exp(-λ · D_semantic · V_volatility)           │
│      (Accelerates during high drift; relaxes during stagnant periods)  │
│                                                                        │
│   4. VERACITY AUDITING & MULTI-SOURCE TRIANGULATION                    │
│      • Requires N ≥ 2 independent root domains for high confidence.    │
│      • Validates citation offsets directly against DOM leaf nodes.     │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Monorepo Topology & Boundaries

The codebase is organized as a Turborepo monorepo managed with `pnpm@9.x`:

- **`apps/web`**: Next.js 15 (App Router, React 19) presentation layer. Handles authentication (`@supabase/ssr`), scout creation, and real-time trajectory visualization (`Supabase Realtime`).
  - *Constraint*: Does NOT perform scraping, heavy agent loops, or import `SUPABASE_SERVICE_ROLE_KEY`.
- **`apps/agent-worker`**: Dedicated Node.js (Fastify) daemon running on port 4000. Houses the execution loop, background scheduler, and REST evaluation server.
  - *Evaluation Endpoints*: Dedicated REST endpoints under `/api/v1/eval/*` (`/traverse`, `/diff`, `/verify`) and `/api/v1/benchmark/*` (`/run`, `/batch`).
- **`packages/database`**: Unified data layer powered by **Drizzle ORM** and PostgreSQL (`pgvector`). Single source of truth for schemas, migrations, and typed queries.
- **`packages/agent-core`**: Pure, headless algorithmic engine implementing the Explore-Critic loop, OHCache extraction, scent math, and Firecrawl client orchestration.
- **`packages/types`**: Shared TypeScript models, contracts, and Zod validation schemas.
- **`packages/config`**: Monorepo configurations (TSConfig, ESLint, validated environment variables via `@repo/config-env`).
- **`benchmarks/`**: Python 3.11+ academic evaluation harness. Ingests academic datasets (WebWalkerQA, Instruct2DS) and drives the worker API offline, formatting publication-ready LaTeX tables.

---

## 3. Prerequisites & Environment Setup

### Prerequisites
- **Node.js**: `v20.x` or `v22.x`
- **Package Manager**: `pnpm@9.x` (`corepack enable pnpm`)
- **Python**: `3.11+` (for `benchmarks/`)
- **Supabase / PostgreSQL**: Supabase project with `vector` extension enabled

### Environment Configuration
Copy `.env.example` in the root directory (or in individual application folders):

```bash
# In monorepo root:
cp .env.example .env

# In web app:
cp apps/web/.env.example apps/web/.env

# In agent worker:
cp apps/agent-worker/.env.example apps/agent-worker/.env

# In benchmarks harness:
cp benchmarks/.env.example benchmarks/.env
```

Key environment variables:
- `NEXT_PUBLIC_SUPABASE_URL` & `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Public client credentials.
- `SUPABASE_SERVICE_ROLE_KEY`: Service key (used **exclusively** by `apps/agent-worker`).
- `DATABASE_URL`: Direct PostgreSQL connection string for Drizzle ORM and migrations.
- `AGENT_WORKER_URL`: Base URL for the agent worker daemon (default: `http://localhost:4000`).
- `FIRECRAWL_API_KEY`: API key for web scraping and search traversal.
- `OPENAI_API_KEY` / `GROQ_API_KEY` / `GEMINI_API_KEY`: Model provider keys.

---

## 4. Quickstart Guide

### 1. Install Dependencies
```bash
pnpm install
```

### 2. Database Setup (Drizzle ORM)
Run database migrations using Drizzle:

```bash
# Generate SQL migrations from Drizzle schemas:
pnpm --filter @repo/database db:generate

# Push schema directly to the database:
pnpm --filter @repo/database db:push

# Open Drizzle Studio visual inspector:
pnpm --filter @repo/database db:studio
```

### 3. Run Development Servers
Start both the Next.js web application and the Agent Worker daemon concurrently:

```bash
# Start all workspace services:
pnpm dev

# Or start services individually:
# Terminal 1: Agent Worker (Port 4000)
pnpm --filter @repo/agent-worker dev

# Terminal 2: Web App (Port 3000)
pnpm --filter @repo/web dev
```

Visit the dashboard at `http://localhost:3000`.

---

## 5. Academic Evaluation & Benchmarks

The `benchmarks/` suite evaluates Forager offline against standard information retrieval and multi-turn web navigation datasets:

### Setup Python Environment
```bash
cd benchmarks
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate
pip install -r requirements.txt
```

### Run Benchmark Suite
Ensure the Agent Worker is running on `http://localhost:4000`, then execute:

```bash
# Run evaluation on WebWalkerQA:
python -m src.runner --dataset webwalkerqa --limit 5 --url http://localhost:4000
```

### Metrics Computed
- **Exact Match (EM)** & **Key Point Recall (KPR)**
- **Citation F1**: Precision and recall of grounded leaf evidence URLs
- **Action Efficiency**: Trajectory steps per resolved research goal
- **Cost & Token Economics**: Mean tokens and USD cost per query
- **LaTeX Generation**: Automatically emits publication-ready tables for ACL/WWW/SIGIR papers

---

## 6. Monorepo Scripts & Commands

| Command | Description |
| :--- | :--- |
| `pnpm build` | Compiles all packages and apps via Turborepo |
| `pnpm type-check` | Runs `tsc --noEmit` across all workspace packages |
| `pnpm lint` | Runs ESLint across the monorepo |
| `pnpm --filter @repo/database db:generate` | Generates Drizzle migrations |
| `pnpm --filter @repo/database db:push` | Pushes Drizzle schemas to PostgreSQL |
| `pnpm --filter @repo/agent-worker dev` | Starts the Fastify agent daemon on port 4000 |
| `pnpm --filter @repo/web dev` | Starts the Next.js 15 frontend on port 3000 |

---

## 7. Strict Coding Directives for AI Agents

All AI agents contributing to this monorepo must read and follow [AGENTS.md](AGENTS.md):
- **Zero Redundant Comments**: Do not write superficial comments (`// fetch user`, `// export interface`).
- **Meaningful Comments Only**: Limit comments to mathematical formulations (e.g. scent decay math) and complex invariants. No block headers like `/*-------*/`.
- **Strict Type Safety**: No `any`. Use discriminated unions, strict Zod schemas, and explicit return types.
- **Zero Raw SQL in Apps**: All database access goes through `@repo/database` and Drizzle ORM.
