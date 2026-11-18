import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  server,
  lockManager,
  scentScheduler,
  setScentRepository,
  clearInMemoryScentMetrics,
  getInMemoryScentMetrics,
  detectPersistenceMode,
  setExecutionRepository,
  setPropositionRepository,
  setTrajectoryRepository,
  clearInMemoryPropositions,
} from "../src/index.ts";
import { setCrawlerClient } from "../../../packages/agent-core/src/crawler.ts";
import { setLLMClient } from "../../../packages/agent-core/src/llm/client.ts";

test.beforeEach(() => {
  lockManager.clear();
  setScentRepository(null);
  clearInMemoryScentMetrics();
  setExecutionRepository(null);
  setPropositionRepository(null);
  setTrajectoryRepository(null);
  clearInMemoryPropositions();
  setCrawlerClient(null);
  setLLMClient(null);
});

test.afterEach(() => {
  lockManager.clear();
  setScentRepository(null);
  clearInMemoryScentMetrics();
  setExecutionRepository(null);
  setPropositionRepository(null);
  setTrajectoryRepository(null);
  clearInMemoryPropositions();
  setCrawlerClient(null);
  setLLMClient(null);
});

test("1. GET /api/v1/scheduler/status reports transient in-memory mode and restart limitation warning", async () => {
  const res = await server.inject({
    method: "GET",
    url: "/api/v1/scheduler/status",
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.payload);
  assert.equal(data.persistenceMode, "in_memory_transient");
  assert.ok(data.warning.includes("Schedules will not survive worker restart until remote scent_metrics table is migrated"));
  assert.ok(data.concurrencyNotice.includes("Single-worker in-process locking only"));
  assert.ok(Array.isArray(data.activeLocks));
  assert.ok(Array.isArray(data.schedules));
});

test("2. detectPersistenceMode reports database_durable only upon verified schema access", async () => {
  setScentRepository({
    verifySchemaAccess: async () => true,
    recordMetric: async () => {},
    getLatestMetric: async () => null,
    getActiveScouts: async () => [],
    updateScoutSchedule: async () => {},
  });

  const durable = await detectPersistenceMode();
  assert.equal(durable.mode, "database_durable");
  assert.equal(durable.warning, undefined);

  setScentRepository({
    verifySchemaAccess: async () => false,
    recordMetric: async () => {},
    getLatestMetric: async () => null,
    getActiveScouts: async () => [],
    updateScoutSchedule: async () => {},
  });

  const transient = await detectPersistenceMode();
  assert.equal(transient.mode, "in_memory_transient");
  assert.ok(transient.warning?.includes("Schedules will not survive worker restart"));
});

test("3. POST /api/v1/scout/run rejects concurrent run of the same scout with 409 Conflict", async () => {
  const scoutId = crypto.randomUUID();

  // Simulate ongoing active run
  const acquired = lockManager.acquire(scoutId, "manual");
  assert.equal(acquired, true);

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Check latest LLM benchmarks",
    },
  });

  assert.equal(res.statusCode, 409);
  const data = JSON.parse(res.payload);
  assert.equal(data.error, "Scout execution conflict");
  assert.ok(data.message.includes("currently executing"));

  // Release lock and ensure subsequent request is accepted past conflict check
  lockManager.release(scoutId);
  assert.equal(lockManager.isLocked(scoutId), false);
});

test("4. POST /api/v1/eval/scent evaluates scent intervals with bounds and precedence", async () => {
  const scoutId = crypto.randomUUID();

  // Test baseline daily
  const res1 = await server.inject({
    method: "POST",
    url: "/api/v1/eval/scent",
    payload: {
      scoutId,
      baseIntervalMinutes: 1440,
      driftScore: 0,
      volatilityFactor: 1.0,
      consecutiveFailures: 0,
      stagnantCycles: 0,
    },
  });

  assert.equal(res1.statusCode, 200);
  const data1 = JSON.parse(res1.payload);
  assert.equal(data1.computedIntervalMinutes, 1440);
  assert.equal(data1.calculationReason, "stagnant_backoff");

  // Test failure backoff anti-storm shield
  const resFail = await server.inject({
    method: "POST",
    url: "/api/v1/eval/scent",
    payload: {
      scoutId,
      baseIntervalMinutes: 1440,
      driftScore: 0.8,
      volatilityFactor: 1.0,
      consecutiveFailures: 2,
    },
  });

  assert.equal(resFail.statusCode, 200);
  const dataFail = JSON.parse(resFail.payload);
  assert.equal(dataFail.computedIntervalMinutes, 5760);
  assert.equal(dataFail.calculationReason, "failure_backoff");

  // Test scent acceleration
  const resAccel = await server.inject({
    method: "POST",
    url: "/api/v1/eval/scent",
    payload: {
      scoutId,
      baseIntervalMinutes: 1440,
      driftScore: 0.6,
      volatilityFactor: 1.0,
      consecutiveFailures: 0,
      stagnantCycles: 0,
    },
  });

  assert.equal(resAccel.statusCode, 200);
  const dataAccel = JSON.parse(resAccel.payload);
  assert.ok(dataAccel.computedIntervalMinutes < 1440);
  assert.equal(dataAccel.calculationReason, "scent_acceleration");
});

test("5. POST /api/v1/scout/run computes and stores scent metric for tracked scout", async () => {
  const scoutId = crypto.randomUUID();
  let recordedMetric = null;

  setExecutionRepository({
    findScoutById: async (id) => ({
      id,
      title: "AI Security Scout",
      goal: "Track prompt injection attacks",
      frequency: "daily",
    }),
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  setScentRepository({
    verifySchemaAccess: async () => true,
    recordMetric: async (m) => {
      recordedMetric = m;
    },
    getLatestMetric: async () => null,
    getActiveScouts: async () => [],
    updateScoutSchedule: async () => {},
  });

  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [{ url: "https://aisecurity.org/papers", title: "AI Security", description: "Prompt injection analysis" }],
    }),
    scrapeUrl: async () => ({
      success: true,
      data: { markdown: "Prompt injection defenses require strict input sanitization.", title: "AI Security" },
    }),
  });

  setLLMClient(async (messages) => {
    const prompt = messages[messages.length - 1]?.content || "";
    let content = "";
    if (prompt.includes("trajectory action")) {
      content = JSON.stringify({
        thought: "We have collected sufficient security analysis to finish.",
        action: { type: "finish" },
      });
    } else if (prompt.includes("evaluate whether the research goal has been satisfied")) {
      content = JSON.stringify({
        score: 0.95,
        goalSatisfied: true,
        critique: "Target evidence collected.",
        suggestedNextStep: "Synthesize report.",
      });
    } else {
      content = JSON.stringify({
        answer: "Prompt injection defenses require strict input sanitization [1].",
        citations: ["https://aisecurity.org/papers"],
        isComplete: true,
      });
    }
    return {
      content,
      tokensUsed: 10,
      promptTokens: 5,
      completionTokens: 5,
      model: "mock",
      provider: "groq",
      durationMs: 5,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Prompt injection defenses",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.ok(recordedMetric);
  assert.equal(recordedMetric.scoutId, scoutId);
  assert.equal(recordedMetric.baseIntervalMinutes, 1440);
  assert.ok(recordedMetric.computedIntervalMinutes >= 15);
  assert.ok(recordedMetric.computedIntervalMinutes <= 10080);

  const inMemMetrics = getInMemoryScentMetrics(scoutId);
  assert.equal(inMemMetrics.length, 1);
  assert.equal(inMemMetrics[0].scoutId, scoutId);
});

test("6. Scheduler ticks skip locked scout during ongoing manual run", async () => {
  const scoutId = crypto.randomUUID();
  let scheduledExecuted = false;

  scentScheduler.registerScout({
    id: scoutId,
    goal: "Ongoing research",
    frequency: "daily",
    nextRunAt: new Date(Date.now() - 1000), // Due right now
  });

  // Lock scout as if manual run is currently underway
  lockManager.acquire(scoutId, "manual");

  const executed = await scentScheduler.tick();
  assert.deepEqual(executed, []);
  assert.equal(scheduledExecuted, false);

  // Release lock and ensure subsequent tick can run
  lockManager.release(scoutId);
  scentScheduler.unregisterScout(scoutId);
});

test("7. Contradiction-driven drift from diffResult is directly reflected in recorded scent metric", async () => {
  const scoutId = crypto.randomUUID();
  let recordedMetric = null;

  setExecutionRepository({
    findScoutById: async (id) => ({
      id,
      title: "Contradiction Monitor",
      goal: "Track AI safety claims",
      frequency: "daily",
    }),
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  setScentRepository({
    verifySchemaAccess: async () => true,
    recordMetric: async (m) => {
      recordedMetric = m;
    },
    getLatestMetric: async () => null,
    getActiveScouts: async () => [],
    updateScoutSchedule: async () => {},
  });

  // Pre-seed historical proposition that asserts affirmative
  setPropositionRepository({
    findByScoutId: async () => [
      {
        id: crypto.randomUUID(),
        scoutId,
        content: "Autonomous agent deployment is safe in production environments.",
        sourceUrl: "https://safety.ai/prior",
        confidence: 0.95,
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
    savePropositions: async () => {},
  });

  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [{ url: "https://safety.ai/update", title: "Safety Update", description: "Production risks" }],
    }),
    scrapeUrl: async () => ({
      success: true,
      data: { markdown: "Autonomous agent deployment is not safe in production environments.", title: "Safety Update" },
    }),
  });

  setLLMClient(async (messages) => {
    const prompt = messages[messages.length - 1]?.content || "";
    let content = "";
    if (prompt.includes("trajectory action")) {
      content = JSON.stringify({
        thought: "Collected contradiction evidence.",
        action: { type: "finish" },
      });
    } else if (prompt.includes("evaluate whether the research goal has been satisfied")) {
      content = JSON.stringify({
        score: 0.9,
        goalSatisfied: true,
        critique: "Evidence collected.",
        suggestedNextStep: "Synthesize.",
      });
    } else {
      content = JSON.stringify({
        answer: "Autonomous agent deployment is not safe in production environments [1].",
        citations: ["https://safety.ai/update"],
        isComplete: true,
      });
    }
    return {
      content,
      tokensUsed: 10,
      promptTokens: 5,
      completionTokens: 5,
      model: "mock",
      provider: "groq",
      durationMs: 5,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Autonomous agent deployment safety",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  assert.ok(recordedMetric);
  // Contradiction-driven drift must be reflected (> 0) and accelerate polling
  assert.ok(recordedMetric.driftScore > 0);
  assert.equal(recordedMetric.calculationReason, "scent_acceleration");
  assert.ok(recordedMetric.computedIntervalMinutes < 1440);
});

test("8. Execution outcomes: completed, incomplete, and failed manage stagnant/failure counters honestly", async () => {
  const scoutId = crypto.randomUUID();

  scentScheduler.registerScout({
    id: scoutId,
    goal: "Outcome state tracking",
    frequency: "daily",
    nextRunAt: new Date(),
  });

  const schedState = scentScheduler.getScoutState(scoutId);
  assert.ok(schedState);
  assert.equal(schedState.stagnantCycles, 0);
  assert.equal(schedState.consecutiveFailures, 0);

  // 1. Incomplete execution: must NOT increment stagnant cycles, and must NOT trigger failure backoff
  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Test", goal: "Test", frequency: "daily" }),
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  setCrawlerClient({
    search: async () => ({ success: true, data: [] }),
    scrapeUrl: async () => ({ success: true, data: { markdown: "", title: "" } }),
  });

  // LLM returns incomplete answer
  setLLMClient(async () => ({
    content: JSON.stringify({
      answer: "Insufficient evidence to answer query.",
      citations: [],
      isComplete: false,
    }),
    tokensUsed: 10,
    promptTokens: 5,
    completionTokens: 5,
    model: "mock",
    provider: "groq",
    durationMs: 5,
  }));

  await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: { scoutId, query: "Unknown query" },
  });

  // Stagnant cycles must remain 0 after incomplete run!
  assert.equal(schedState.stagnantCycles, 0);
  assert.equal(schedState.consecutiveFailures, 0);

  // 2. Completed execution with zero drift: must increment stagnantCycles
  setCrawlerClient({
    search: async () => ({ success: true, data: [{ url: "https://valid.com", title: "Valid", description: "Known query content" }] }),
    scrapeUrl: async () => ({ success: true, markdown: "Known query definition: Grounded answer with long enough sentence for proposition extraction.", metadata: { title: "Valid" } }),
  });

  let navigated = false;
  setLLMClient(async (messages) => {
    const prompt = messages[messages.length - 1]?.content || "";
    let content = "";
    if (prompt.includes("trajectory action")) {
      if (!navigated) {
        navigated = true;
        content = JSON.stringify({ thought: "Navigate to valid source", action: { type: "navigate", url: "https://valid.com" } });
      } else {
        content = JSON.stringify({ thought: "Done", action: { type: "finish" } });
      }
    } else if (prompt.includes("evaluate whether the research goal")) {
      content = JSON.stringify({ score: 0.95, goalSatisfied: true });
    } else {
      content = JSON.stringify({
        answer: "Known query definition: Grounded answer with long enough sentence for proposition extraction [1].",
        citations: ["https://valid.com"],
        isComplete: true,
      });
    }
    return {
      content,
      tokensUsed: 10,
      promptTokens: 5,
      completionTokens: 5,
      model: "mock",
      provider: "groq",
      durationMs: 5,
    };
  });

  // Simulate existing proposition identical to candidate to yield drift = 0
  setPropositionRepository({
    findByScoutId: async () => [
      {
        id: crypto.randomUUID(),
        scoutId,
        content: "Known query definition: Grounded answer with long enough sentence for proposition extraction [1].",
        sourceUrl: "https://valid.com",
        confidence: 1.0,
        status: "active",
        createdAt: new Date().toISOString(),
      },
    ],
    savePropositions: async () => {},
  });

  const res2 = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: { scoutId, query: "Known query", maxSteps: 3 },
  });

  assert.equal(res2.statusCode, 200);
  assert.equal(schedState.stagnantCycles, 1);
  assert.equal(schedState.consecutiveFailures, 0);

  // 3. Failed execution: must reset stagnant cycles and increment consecutiveFailures
  setLLMClient(async () => {
    throw new Error("API rate limit exceeded");
  });

  await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: { scoutId, query: "Failing query" },
  });

  assert.equal(schedState.consecutiveFailures, 1);
  assert.equal(schedState.stagnantCycles, 0);
  assert.equal(schedState.computedIntervalMinutes, 2880);

  scentScheduler.unregisterScout(scoutId);
});

test("9. Fastify onClose hook safely stops scentScheduler and leaves no recurring timer", async () => {
  scentScheduler.start();
  assert.equal(scentScheduler.getStatus().isRunning, true);

  // Closing server triggers onClose hook
  await server.close();

  assert.equal(scentScheduler.getStatus().isRunning, false);
});
