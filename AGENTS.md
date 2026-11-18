# Forager: Agent Operational Directives & System Ledger

You are operating on **Forager**, an autonomous, trajectory-aware research agent and targeted web-monitoring platform built for Tier-1 academic publication (ACL, WWW, SIGIR) and high-throughput production deployment.

This document contains non-negotiable operational rules, boundary constraints, and architectural invariants that all coding agents MUST follow.

---

## 1. Core Research Invariants & Algorithms

All agent logic lives in `@repo/agent-core` and adheres to four foundational research contributions:

1. **Explore-Critic Traversal Loop (Inspired by WebWalker)**:
   - **Explorer**: Generates Thought-Action-Observation trajectories across DOM hierarchies (`navigate`, `search`, `extract`, `finish`).
   - **Critic**: Heuristically scores steps against target goals $\in [0, 1]$, prunes unpromising links before costly fetches, and assesses completion.
2. **Atomic Proposition Diffing & OHCache (Inspired by AutoData)**:
   - **Never inject raw scraped web pages into primary LLM reasoning contexts**.
   - Raw payloads are stored out-of-band in Supabase storage/database.
   - Distill content into discrete atomic propositions ($\mathcal{P}$); compare against existing knowledge via `pgvector` cosine similarity.
   - Pass only compact UUID pointers and synthesized factual claims through agent context.
3. **Adaptive Scent-Driven Polling Engine**:
   - Replaces static cron intervals with an information-foraging volatility decay model:
     $$\Delta t_{next} = \Delta t_{base} \cdot \exp(-\lambda \cdot \mathcal{D}_{\text{semantic}} \cdot \mathcal{V}_{volatility})$$
   - Polling accelerates during high volatility and factual drift; exponentially relaxes during stagnant periods.
4. **Veracity Auditing & Multi-Source Triangulation**:
   - Requires independent root domain corroboration ($N \ge 2$) before asserting conclusions.
   - Ground citations directly against DOM leaf nodes and text anchors to prevent hallucinations.

---

## 2. Strict Architectural Boundaries

Preserve strict package isolation and separation of concerns:

### A. `apps/web` (Next.js 15 App Router, React 19)
- **Role**: Presentation, authentication (`@supabase/ssr`), scout configuration dashboard, and real-time trajectory visualization.
- **Constraints**:
  - **DO NOT** execute scraping, long-running agent loops, or Firecrawl SDK calls directly within Next.js API routes or Server Actions.
  - **DO NOT** import or use `SUPABASE_SERVICE_ROLE_KEY` inside `apps/web`. Use only authenticated user sessions.
  - Agent tasks are dispatched to `agent-worker` REST API (`http://localhost:4000/api/v1/scout/run`).
  - Trajectory updates are consumed reactively via Supabase Realtime subscriptions on `scout_execution_steps`.

### B. `apps/agent-worker` (Node.js / Fastify Daemon, Port 4000)
- **Role**: Autonomous execution engine, continuous background poller, and REST evaluation server.
- **Endpoints**:
  - `GET /health`: Health status & uptime.
  - `POST /api/v1/scout/run`: Triggers or queues scout trajectories.
  - `POST /api/v1/eval/traverse`: Executes single-step Explore-Critic traversal for benchmarks.
  - `POST /api/v1/eval/diff`: Runs OHCache proposition extraction and semantic diffing.
  - `POST /api/v1/eval/verify`: Audits claim veracity across multi-domain citations.
  - `POST /api/v1/benchmark/run`: End-to-end benchmark evaluation query returning steps, tokens, duration, and evidence.
  - `POST /api/v1/benchmark/batch`: Concurrently schedules batch benchmark evaluations.
- **Constraints**:
  - Uses `SUPABASE_SERVICE_ROLE_KEY` securely for vector operations and backend management.
  - Imports algorithms exclusively from `@repo/agent-core` and contracts from `@repo/types`.

### C. `packages/database` (Drizzle ORM & Unified Data Layer)
- **Role**: Single source of truth for database schemas, pgvector operations, and typed query helpers.
- **Constraints**:
  - Drizzle ORM is the exclusive schema and migration definition layer (`src/schema/*`, `drizzle.config.ts`).
  - Generate migrations with `pnpm --filter @repo/database db:generate`.
  - Push schema changes with `pnpm --filter @repo/database db:push` or apply migrations via `db:migrate`.
  - **DO NOT** write raw SQL strings across application packages; import typed Drizzle tables and `getDb()` from `@repo/database`.

### D. `packages/types` (Universal Contracts)
- **Role**: Universal TypeScript models, Zod validation schemas, and execution status enums.
- **Constraints**:
  - Every shared data shape between `web`, `agent-worker`, and `benchmarks` must be declared here.
  - Pair TypeScript types with runtime Zod schemas.

### E. `benchmarks/` (Python 3.11+ Academic Harness)
- **Role**: Offline academic evaluation harness.
- **Constraints**:
  - Completely isolated from Turborepo build cycle.
  - Interacts strictly over HTTP with `http://localhost:4000/api/v1/*`.
  - Ingests WebWalkerQA and Instruct2DS; computes Exact Match (EM), Key Point Recall, Citation F1, Action Count, latency, and cost.
  - Generates publication-ready LaTeX tables for conference papers.

---

## 3. Engineering & Code Standards for AI Agents

- **Zero Redundant Comments**: Do not write obvious comments (e.g. `// fetch user`, `// export function`, `// interface for props`). Code must be self-explanatory through expressive naming and clean typing.
- **Meaningful Comments Only**: Restrict comments strictly to mathematical formulations (e.g., information scent decay math) or complex algorithmic invariants. Don't write this kind of comments:```
  /**
   * Batch Benchmark Run Endpoint: /api/v1/benchmark/batch
   */
  ```
- **Strict Type Safety**: No `any`. Use discriminated unions, strict Zod validation at network/database boundaries, and explicit return types on public interfaces.
- **Error Handling**: Never swallow errors with empty catch blocks. Log structured errors with context across agent trajectories.
- **No Direct process.env Access**: Always access validated environment variables via `@repo/config-env`.
- **Guardrail**: Always run build command for frontend and typecheck for server apps at the end of changes.

---

## 4. Agent Skills & Tooling

Agent skills are located in `.agents/skills/`:
- **`find-skills`**: Discover new agent skills via `npx skills find <keyword>`.
- **`turborepo`**: Monorepo task pipeline management, caching, and package boundaries.
- **`nextjs-app-router-patterns`**: Next.js 15 Server Components, streaming, and client boundary patterns.
- **`vercel-react-best-practices`**: React 19 optimized rendering and layout patterns.

---

## 5. Development Workflow Commands

- Package Manager: `pnpm@9.x` exclusively.
- Build monorepo: `pnpm build`
- Type-check all packages: `pnpm type-check`
- Start dev server: `pnpm dev`
- Run Agent Worker: `pnpm --filter @repo/agent-worker dev`
- Drizzle migrations: `pnpm --filter @repo/database db:generate`
- Run Academic Benchmarks: `cd benchmarks && python -m src.runner --dataset webwalkerqa --limit 5`
