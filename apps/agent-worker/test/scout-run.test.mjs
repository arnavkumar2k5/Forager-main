import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  server,
  setExecutionRepository,
  setTrajectoryRepository,
  setPropositionRepository,
  clearInMemoryPropositions,
} from "../src/index.ts";
import { setCrawlerClient } from "../../../packages/agent-core/src/crawler.ts";
import { setLLMClient } from "../../../packages/agent-core/src/llm/client.ts";

test.beforeEach(() => {
  setExecutionRepository(null);
  setTrajectoryRepository(null);
  setPropositionRepository(null);
  setCrawlerClient(null);
  setLLMClient(null);
  clearInMemoryPropositions();
});

test.afterEach(() => {
  setExecutionRepository(null);
  setTrajectoryRepository(null);
  setPropositionRepository(null);
  setCrawlerClient(null);
  setLLMClient(null);
  clearInMemoryPropositions();
});

test("1. scout/run: Valid query completes with a grounded answer, citations, and status completed", async () => {
  const scoutId = crypto.randomUUID();
  let createdExecution = null;
  let updatedExecution = null;
  const savedSteps = [];

  setExecutionRepository({
    findScoutById: async (id) => ({
      id,
      title: "Raft Consensus Monitor",
      goal: "Track Raft algorithm updates",
    }),
    createExecution: async (params) => {
      createdExecution = params;
    },
    updateExecution: async (id, params) => {
      updatedExecution = { id, ...params };
    },
    getExecutionById: async () => null,
  });

  setTrajectoryRepository({
    saveStep: async (executionId, step) => {
      savedSteps.push({ executionId, step });
    },
    saveSteps: async () => {},
    getStepsByExecutionId: async () => [],
  });

  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [
        {
          url: "https://raft.github.io/raft.pdf",
          title: "Raft Paper",
          description: "Authoritative paper on Raft consensus by Ongaro and Ousterhout.",
        },
      ],
    }),
    scrapeUrl: async () => ({
      success: true,
      markdown: "# Raft Consensus\n\nElection Safety: At most one leader can be elected in a given term (§5.2). State machines execute commands in identical order.",
      metadata: { title: "Raft Paper" },
    }),
  });

  let stepCallCount = 0;
  setLLMClient(async (messages) => {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    const sysMsg = messages.find((m) => m.role === "system")?.content || "";

    // Answer synthesis prompt
    if (sysMsg.includes("Lead Research Synthesizer")) {
      return {
        content: JSON.stringify({
          answer: "In Raft consensus, election safety invariant guarantees at most one leader per term.",
          citations: ["https://raft.github.io/raft.pdf"],
          isComplete: true,
        }),
        tokensUsed: 80,
      };
    }

    // Critic prompt
    if (userMsg.includes("Target Research Goal") || userMsg.includes("Step")) {
      return {
        content: JSON.stringify({
          score: 0.9,
          relevance: "high",
          feedback: "Found definitive election safety invariant definition.",
          goalSatisfied: true,
          suggestedNextSteps: [],
        }),
        tokensUsed: 40,
      };
    }

    // Explorer decisions
    stepCallCount++;
    if (stepCallCount === 1) {
      return {
        content: JSON.stringify({
          type: "navigate",
          url: "https://raft.github.io/raft.pdf",
          reasoning: "Navigate to official Raft technical specification.",
        }),
        tokensUsed: 35,
      };
    }

    return {
      content: JSON.stringify({
        type: "finish",
        reasoning: "Target invariant retrieved.",
      }),
      tokensUsed: 25,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "What is Raft election safety invariant?",
      maxSteps: 4,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.status, "completed");
  assert.equal(data.success, true);
  assert.equal(data.isComplete, true);
  assert.ok(data.answer.includes("at most one leader per term"));
  assert.deepEqual(data.citations, ["https://raft.github.io/raft.pdf"]);
  assert.ok(data.stepCount > 0);
  assert.ok(data.executionId);
  assert.equal(data.scoutId, scoutId);

  // Verifies database execution record creation and update
  assert.equal(createdExecution?.id, data.executionId);
  assert.equal(createdExecution?.status, "running");
  assert.equal(updatedExecution?.id, data.executionId);
  assert.equal(updatedExecution?.status, "completed");
  assert.equal(updatedExecution?.summaryText, data.answer);

  // Verifies trajectory steps were saved with the executionId
  assert.ok(savedSteps.length > 0);
  assert.equal(savedSteps[0].executionId, data.executionId);
});

test("2. scout/run: Insufficient evidence produces an incomplete result without claiming completion", async () => {
  const scoutId = crypto.randomUUID();
  let updatedExecution = null;

  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Test Scout" }),
    createExecution: async () => {},
    updateExecution: async (id, params) => {
      updatedExecution = { id, ...params };
    },
    getExecutionById: async () => null,
  });

  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [{ url: "https://unrelated.com/paxos", title: "Paxos Overview" }],
    }),
    scrapeUrl: async () => ({
      success: true,
      markdown: "This document describes basic Paxos historical backgrounds.",
      metadata: { title: "Paxos Overview" },
    }),
  });

  let stepCount = 0;
  setLLMClient(async (messages) => {
    const sysMsg = messages.find((m) => m.role === "system")?.content || "";
    if (sysMsg.includes("Lead Research Synthesizer")) {
      return {
        content: JSON.stringify({
          answer: "The retrieved source discusses Paxos but does not contain information on Raft election safety.",
          citations: ["https://unrelated.com/paxos"],
          isComplete: false,
          missingInformation: "Specific Raft leader election safety invariant not found in evidence.",
        }),
        tokensUsed: 60,
      };
    }

    stepCount++;
    if (stepCount === 1) {
      return {
        content: JSON.stringify({
          type: "navigate",
          url: "https://unrelated.com/paxos",
          reasoning: "Navigate to page",
        }),
        tokensUsed: 25,
      };
    }

    return {
      content: JSON.stringify({
        type: "finish",
        reasoning: "No further relevant links.",
      }),
      tokensUsed: 25,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "What is Raft election safety invariant?",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.status, "incomplete");
  assert.equal(data.success, false);
  assert.equal(data.isComplete, false);
  assert.ok(data.missingInformation?.includes("Raft"));
  // Incomplete run updates execution record with failed/incomplete status
  assert.equal(updatedExecution?.status, "failed");
  assert.ok(updatedExecution?.errorMessage?.includes("Raft"));
});

test("3. scout/run: Invalid request returns 400 validation error", async () => {
  // Empty query
  const resEmptyQuery = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      query: "   ",
    },
  });
  assert.equal(resEmptyQuery.statusCode, 400);
  const dataEmpty = JSON.parse(resEmptyQuery.body);
  assert.equal(dataEmpty.error, "Invalid request payload");

  // Invalid scoutId format (not a UUID)
  const resBadUuid = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId: "not-a-valid-uuid",
      query: "Valid query",
    },
  });
  assert.equal(resBadUuid.statusCode, 400);

  // maxSteps exceeds sensible cap
  const resBadSteps = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      query: "Valid query",
      maxSteps: 50, // cap is 15
    },
  });
  assert.equal(resBadSteps.statusCode, 400);
});

test("4. scout/run: Unknown scoutId returns 404 error", async () => {
  const nonExistentScoutId = crypto.randomUUID();

  setExecutionRepository({
    findScoutById: async () => null, // Scout not found
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId: nonExistentScoutId,
      query: "Research consensus",
    },
  });

  assert.equal(res.statusCode, 404);
  const data = JSON.parse(res.body);
  assert.ok(data.error.includes("Scout not found"));
  assert.ok(data.error.includes(nonExistentScoutId));
});

test("5. scout/run: Explorer or LLM failure records a failed execution without fabricating an answer", async () => {
  const scoutId = crypto.randomUUID();
  let updatedExecution = null;

  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Test Scout" }),
    createExecution: async () => {},
    updateExecution: async (id, params) => {
      updatedExecution = { id, ...params };
    },
    getExecutionById: async () => null,
  });

  // LLM throws an unhandled API error (simulating timeout or outage)
  setLLMClient(async () => {
    throw new Error("Provider rate limit or connection timeout: api_key_secret_1234567890abcdef");
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Explore quantum computing algorithms",
      maxSteps: 3,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.status, "failed");
  assert.equal(data.success, false);
  assert.ok(data.error);
  // Verifies secrets are redacted in error messages
  assert.ok(!data.error.includes("api_key_secret_1234567890abcdef"));
  assert.deepEqual(data.citations, []);

  // Database execution record is updated to failed, NOT left running
  assert.equal(updatedExecution?.status, "failed");
  assert.ok(!updatedExecution?.errorMessage?.includes("api_key_secret_1234567890abcdef"));
});

test("6. scout/run: Trajectory steps use the correct execution ID", async () => {
  const scoutId = crypto.randomUUID();
  const savedStepExecutionIds = [];

  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Test Scout" }),
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  setTrajectoryRepository({
    saveStep: async (executionId) => {
      savedStepExecutionIds.push(executionId);
    },
    saveSteps: async () => {},
    getStepsByExecutionId: async () => [],
  });

  setCrawlerClient({
    search: async () => ({ success: true, data: [] }),
    scrapeUrl: async () => ({ success: true, markdown: "Content" }),
  });

  setLLMClient(async () => {
    return {
      content: JSON.stringify({ type: "finish", reasoning: "Done" }),
      tokensUsed: 20,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Query for trajectory ID check",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.ok(data.executionId);
  assert.ok(savedStepExecutionIds.length > 0);
  // Every saved trajectory step has the exact executionId returned in the response
  for (const stepExecId of savedStepExecutionIds) {
    assert.equal(stepExecId, data.executionId);
  }
});

test("7. scout/run: Persistence failure follows fail-open policy and reports warning", async () => {
  const scoutId = crypto.randomUUID();

  // Repositories fail (simulating remote DB unreachable)
  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Test Scout" }),
    createExecution: async () => {
      throw new Error("Supabase connection timeout");
    },
    updateExecution: async () => {
      throw new Error("Supabase connection timeout");
    },
    getExecutionById: async () => null,
  });

  setTrajectoryRepository({
    saveStep: async () => {
      throw new Error("Supabase socket hangup");
    },
    saveSteps: async () => {},
    getStepsByExecutionId: async () => [],
  });

  setPropositionRepository({
    savePropositions: async () => {
      throw new Error("Supabase database timeout");
    },
    saveProposition: async () => {},
    findByScoutId: async () => [],
  });

  setCrawlerClient({
    search: async () => ({ success: true, data: [] }),
    scrapeUrl: async () => ({ success: true, markdown: "" }),
  });

  setLLMClient(async (messages) => {
    const sys = messages.find((m) => m.role === "system")?.content || "";
    if (sys.includes("Lead Research Synthesizer")) {
      return {
        content: JSON.stringify({
          answer: "Answer synthesized despite database offline.",
          citations: ["https://example.com/source"],
          isComplete: true,
        }),
        tokensUsed: 50,
      };
    }
    return {
      content: JSON.stringify({ type: "finish", reasoning: "Done" }),
      tokensUsed: 20,
    };
  });

  // Must not throw 500 due to DB failures; must proceed fail-open
  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "Testing fail-open persistence",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);
  assert.ok(data.executionId);
  // Warning is reported honestly; does not falsely claim remote DB succeeded
  assert.ok(data.propositions?.warning?.includes("Database persistence failed") || data.propositions?.persistedCount === 0);
});

test("8. scout/run: Maximum step limits are strictly enforced", async () => {
  let stepsExecuted = 0;

  setCrawlerClient({
    search: async () => ({ success: true, data: [] }),
    scrapeUrl: async () => ({ success: true, markdown: "" }),
  });

  // LLM continuously returns search, attempting an infinite loop
  setLLMClient(async () => {
    stepsExecuted++;
    return {
      content: JSON.stringify({
        type: "search",
        query: `Keep searching step ${stepsExecuted}`,
        reasoning: "Endless search",
      }),
      tokensUsed: 15,
    };
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      query: "Test step ceiling",
      maxSteps: 3, // Capped at exactly 3
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  // Exactly 3 steps executed, bounded by maxSteps
  assert.equal(data.stepCount, 3);
  assert.equal(data.steps.length, 3);
});
