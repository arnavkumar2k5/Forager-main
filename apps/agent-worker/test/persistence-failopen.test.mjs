import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  server,
  setPropositionRepository,
  setTrajectoryRepository,
  clearInMemoryPropositions,
  getInMemoryPropositions,
} from "../src/index.ts";
import { setCrawlerClient } from "../../../packages/agent-core/src/crawler.ts";
import { setLLMClient } from "../../../packages/agent-core/src/llm/client.ts";

test.beforeEach(() => {
  setPropositionRepository(null);
  setTrajectoryRepository(null);
  clearInMemoryPropositions();
});

test("eval/traverse proceeds fail-open and completes when trajectory persistence fails", async () => {
  setLLMClient(async (messages) => {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    if (userMsg.includes("Target Research Goal") || userMsg.includes("Step")) {
      return {
        content: JSON.stringify({
          score: 0.6,
          relevance: "medium",
          feedback: "Candidate step evaluated",
          goalSatisfied: false,
          suggestedNextSteps: [],
        }),
        tokensUsed: 40,
        promptTokens: 25,
        completionTokens: 15,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    return {
      content: JSON.stringify({
        type: "search",
        query: "Analyze Paxos consensus",
        reasoning: "Initial search",
      }),
      tokensUsed: 40,
      promptTokens: 25,
      completionTokens: 15,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 5,
    };
  });
  const failingTrajectoryRepo = {
    saveStep: async () => {
      throw new Error("Foreign key constraint violation: execution_id does not exist");
    },
    saveSteps: async () => {
      throw new Error("Foreign key constraint violation: execution_id does not exist");
    },
    getStepsByExecutionId: async () => [],
  };

  setTrajectoryRepository(failingTrajectoryRepo);

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/eval/traverse",
    payload: {
      goal: "Analyze Paxos consensus",
      history: [],
      maxDepth: 3,
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.step.stepNumber, 1);
  assert.ok(typeof json.heuristicScore === "number");
  assert.equal(typeof json.isFinished, "boolean");
});

test("eval/diff proceeds fail-open and saves to in-memory store when database throws", async () => {
  const scoutId = crypto.randomUUID();

  const failingRepo = {
    findByScoutId: async () => [],
    savePropositions: async () => {
      throw new Error("Database timeout or network partition");
    },
    saveProposition: async () => {
      throw new Error("Database timeout or network partition");
    },
  };

  setPropositionRepository(failingRepo);

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/eval/diff",
    payload: {
      scoutId,
      rawPayload:
        "The Raft consensus algorithm establishes strong leader election with randomized election timeouts.",
      sourceUrl: "https://raft.github.io/consensus",
      similarityThreshold: 0.85,
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.historicalSource, "database");
  assert.ok(json.warning.includes("Database persistence failed"));
  assert.ok(json.diffResult.novelCount >= 1);

  // In-memory fallback retained the extracted propositions
  const inMemory = getInMemoryPropositions(scoutId);
  assert.ok(inMemory.length >= 1);
  assert.ok(inMemory.some((p) => p.content.includes("Raft consensus algorithm")));
});

test("eval/diff deduplicates identical propositions before persisting and storing in-memory", async () => {
  const scoutId = crypto.randomUUID();
  const savedBatches = [];

  const mockRepo = {
    findByScoutId: async () => [],
    savePropositions: async (props) => {
      savedBatches.push(props);
    },
    saveProposition: async (p) => {
      savedBatches.push([p]);
    },
  };

  setPropositionRepository(mockRepo);

  const text =
    "Raft algorithm uses randomized election timeouts. Raft algorithm uses randomized election timeouts.";

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/eval/diff",
    payload: {
      scoutId,
      rawPayload: text,
      sourceUrl: "https://raft.github.io/paper.pdf",
    },
  });

  assert.equal(res.statusCode, 200);
  const inMemory = getInMemoryPropositions(scoutId);

  // Ensure no duplicate propositions in memory
  const contents = inMemory.map((p) => p.content.trim().toLowerCase());
  const uniqueContents = new Set(contents);
  assert.equal(contents.length, uniqueContents.size);
});

test("benchmark/run traces trajectory steps into repository and completes fail-open on step error", async () => {
  let stepCount = 0;
  setLLMClient(async (messages) => {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    if (userMsg.includes("User Research Query")) {
      // Synthesis
      return {
        content: JSON.stringify({
          answer: "Paxos achieves distributed consensus through proposer-acceptor quorums.",
          citations: ["https://example.com/paxos"],
          isComplete: true,
        }),
        tokensUsed: 80,
        promptTokens: 50,
        completionTokens: 30,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    if (userMsg.includes("Explorer Action Evaluated")) {
      // Critic
      const isSecondStep = userMsg.includes("Step 2");
      return {
        content: JSON.stringify({
          score: isSecondStep ? 0.9 : 0.5,
          relevance: isSecondStep ? "high" : "medium",
          feedback: isSecondStep ? "Found full explanation" : "Found links",
          goalSatisfied: isSecondStep,
          suggestedNextSteps: isSecondStep ? [] : ["Navigate to https://example.com/paxos"],
        }),
        tokensUsed: 50,
        promptTokens: 30,
        completionTokens: 20,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    // Explorer
    stepCount++;
    if (stepCount === 1) {
      return {
        content: JSON.stringify({
          type: "search",
          query: "How does Paxos achieve distributed consensus?",
          reasoning: "Search for Paxos papers",
        }),
        tokensUsed: 60,
        promptTokens: 40,
        completionTokens: 20,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    return {
      content: JSON.stringify({
        type: "navigate",
        url: "https://example.com/paxos",
        reasoning: "Navigate to Paxos Made Simple",
      }),
      tokensUsed: 60,
      promptTokens: 40,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 5,
    };
  });
  const stepsSaved = [];

  const mockTrajectoryRepo = {
    saveStep: async (executionId, step) => {
      stepsSaved.push({ executionId, stepNumber: step.stepNumber });
    },
    saveSteps: async (executionId, steps) => {
      for (const s of steps) {
        stepsSaved.push({ executionId, stepNumber: s.stepNumber });
      }
    },
    getStepsByExecutionId: async () => [],
  };

  setTrajectoryRepository(mockTrajectoryRepo);

  // Mock search/scrape crawler responses
  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [{ url: "https://example.com/paxos", title: "Paxos Made Simple", description: "Consensus overview" }],
    }),
    scrapeUrl: async () => ({
      success: true,
      markdown: "# Paxos Made Simple\nLeslie Lamport presents Paxos for fault-tolerant state machine replication.",
      metadata: { title: "Paxos Made Simple" },
    }),
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/benchmark/run",
    payload: {
      query: "How does Paxos achieve distributed consensus?",
      maxSteps: 2,
      metadata: {
        executionId: "00000000-0000-4000-8000-000000000001",
      },
    },
  });

  assert.equal(res.statusCode, 200);
  const json = JSON.parse(res.body);
  assert.equal(json.success, true);
  assert.ok(json.stepCount >= 1);
  assert.ok(stepsSaved.length >= 1);
  assert.equal(stepsSaved[0].executionId, "00000000-0000-4000-8000-000000000001");
});
