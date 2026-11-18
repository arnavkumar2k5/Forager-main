import test from "node:test";
import assert from "node:assert/strict";
import {
  setLLMClient,
  invokeLLM,
  resolveLLMConfig,
  estimateTokenCost,
} from "../src/llm/client.ts";
import {
  executeExplorerStep,
  buildExplorerPrompt,
} from "../src/explore-critic/explorer.ts";
import { evaluateExplorerStep } from "../src/explore-critic/critic.ts";

test.beforeEach(() => {
  setLLMClient(null);
});

test.afterEach(() => {
  setLLMClient(null);
});

test("explorer uses LLM to make dynamic action decision and records tokens", async () => {
  let promptReceived = "";

  setLLMClient(async (messages) => {
    promptReceived = messages.find((m) => m.role === "user")?.content || "";
    return {
      content: JSON.stringify({
        type: "search",
        query: "Raft consensus election safety",
        reasoning: "Search for authoritative Raft paper to verify election safety invariant.",
      }),
      tokensUsed: 142,
      promptTokens: 100,
      completionTokens: 42,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 85,
    };
  });

  const action = await executeExplorerStep({
    goal: "Verify Raft consensus election safety",
    trajectoryHistory: [],
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.equal(action.type, "search");
  assert.equal(action.query, "Raft consensus election safety");
  assert.equal(action.tokensUsed, 142);
  assert.ok(promptReceived.includes("Verify Raft consensus election safety"));
});

test("explorer incorporates critic feedback from prior steps into decision", async () => {
  let promptReceived = "";

  setLLMClient(async (messages) => {
    promptReceived = messages.find((m) => m.role === "user")?.content || "";
    return {
      content: JSON.stringify({
        type: "navigate",
        url: "https://raft.github.io/paper.pdf",
        reasoning: "Critic suggested inspecting the official paper PDF; navigating now.",
      }),
      tokensUsed: 165,
      promptTokens: 120,
      completionTokens: 45,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 90,
    };
  });

  const history = [
    {
      stepNumber: 1,
      timestamp: new Date().toISOString(),
      action: {
        type: "search",
        query: "Raft paper",
        reasoning: "Initial search",
      },
      evaluation: {
        score: 0.5,
        relevance: "medium",
        feedback: "Search found multiple candidate links. Focus on official author paper.",
        goalSatisfied: false,
        suggestedNextSteps: ["Navigate to https://raft.github.io/paper.pdf directly"],
      },
      observations: "Search results: 1. https://raft.github.io/paper.pdf 2. https://wikipedia.org",
      tokensUsed: 120,
    },
  ];

  const action = await executeExplorerStep({
    goal: "Verify Raft consensus election safety",
    trajectoryHistory: history,
    currentObservation: history[0]?.observations,
    stepNumber: 2,
    maxSteps: 5,
  });

  assert.equal(action.type, "navigate");
  assert.equal(action.url, "https://raft.github.io/paper.pdf");
  assert.equal(action.tokensUsed, 165);
  assert.ok(promptReceived.includes("Critic Feedback"));
  assert.ok(promptReceived.includes("Navigate to https://raft.github.io/paper.pdf directly"));
});

test("explorer handles invalid JSON from model and recovers safely via fallback", async () => {
  setLLMClient(async () => {
    return {
      content: "This is a non-JSON conversational refusal from the model.",
      tokensUsed: 35,
      promptTokens: 30,
      completionTokens: 5,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const action = await executeExplorerStep({
    goal: "Understand Paxos quorums",
    trajectoryHistory: [],
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.ok(action.type === "search");
  assert.ok(action.query?.toLowerCase().includes("paxos quorums"));
  assert.ok(action.reasoning.includes("fallback applied"));
});

test("explorer handles invalid Zod schema output and recovers safely", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        type: "unsupported_action_type",
        randomField: 12345,
      }),
      tokensUsed: 40,
      promptTokens: 30,
      completionTokens: 10,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 50,
    };
  });

  const action = await executeExplorerStep({
    goal: "Understand Paxos quorums",
    trajectoryHistory: [],
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.ok(action.type === "search");
  assert.ok(action.reasoning.includes("fallback applied"));
});

test("explorer handles API failure / timeout gracefully without throwing", async () => {
  setLLMClient(async () => {
    throw new Error("Request timed out after 30000ms");
  });

  const action = await executeExplorerStep({
    goal: "Understand Paxos quorums",
    trajectoryHistory: [],
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.ok(action.type === "search");
  assert.equal(action.tokensUsed, 0);
  assert.ok(action.reasoning.includes("LLM invocation failed"));
});

test("explorer terminates with finish when maximum step limit is reached", async () => {
  let llmCalled = false;
  setLLMClient(async () => {
    llmCalled = true;
    return {
      content: "{}",
      tokensUsed: 0,
      promptTokens: 0,
      completionTokens: 0,
      model: "test",
      provider: "groq",
      durationMs: 0,
    };
  });

  const action = await executeExplorerStep({
    goal: "Explore DeepSeek architecture",
    trajectoryHistory: [
      { stepNumber: 1, timestamp: "", action: { type: "search", reasoning: "" }, tokensUsed: 0 },
      { stepNumber: 2, timestamp: "", action: { type: "navigate", reasoning: "" }, tokensUsed: 0 },
      { stepNumber: 3, timestamp: "", action: { type: "extract", reasoning: "" }, tokensUsed: 0 },
    ],
    stepNumber: 3,
    maxSteps: 3,
  });

  assert.equal(action.type, "finish");
  assert.ok(action.reasoning.includes("depth"));
  assert.equal(llmCalled, false);
});

test("critic evaluates explorer step via LLM and computes relevance and suggestions", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        score: 0.85,
        relevance: "high",
        feedback: "The page provides key election safety invariants and log matching properties.",
        goalSatisfied: true,
        suggestedNextSteps: ["Extract final propositions and synthesize conclusion"],
      }),
      tokensUsed: 95,
      promptTokens: 60,
      completionTokens: 35,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 65,
    };
  });

  const evaluation = await evaluateExplorerStep({
    goal: "Explain Raft election safety",
    action: {
      type: "extract",
      url: "https://raft.github.io/",
      reasoning: "Extracting election safety proof",
      extractedContent: "An elected leader has all committed entries from prior terms.",
    },
    observations: "Full paper abstract and proofs.",
    stepNumber: 2,
    maxSteps: 5,
  });

  assert.equal(evaluation.score, 0.85);
  assert.equal(evaluation.relevance, "high");
  assert.equal(evaluation.goalSatisfied, true);
  assert.equal(evaluation.tokensUsed, 95);
  assert.ok(evaluation.suggestedNextSteps.length >= 1);
});

test("critic prevents search action from declaring goal satisfied prematurely", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        score: 0.95,
        relevance: "high",
        feedback: "Found relevant search results.",
        goalSatisfied: true, // Erroneously true for a search action
        suggestedNextSteps: [],
      }),
      tokensUsed: 80,
      promptTokens: 50,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 50,
    };
  });

  const evaluation = await evaluateExplorerStep({
    goal: "Explain Raft election safety",
    action: {
      type: "search",
      query: "Raft consensus",
      reasoning: "Searching for sources",
    },
    observations: "Search results: 5 links",
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.equal(evaluation.goalSatisfied, false);
  assert.ok(evaluation.score <= 0.6);
});

test("critic does not falsely mark research as satisfied when maxSteps is reached", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        score: 0.4,
        relevance: "low",
        feedback: "Incomplete evidence.",
        goalSatisfied: false,
        suggestedNextSteps: ["Keep exploring"],
      }),
      tokensUsed: 60,
      promptTokens: 40,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const evaluation = await evaluateExplorerStep({
    goal: "Complex multi-hop question",
    action: { type: "navigate", url: "https://example.com", reasoning: "" },
    observations: "Partial text",
    stepNumber: 5,
    maxSteps: 5,
  });

  assert.equal(evaluation.goalSatisfied, false);
});

test("critic overrides goalSatisfied to false when score is low or relevance is low", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        score: 0.35,
        relevance: "low",
        feedback: "Superficial landing page with no technical depth.",
        goalSatisfied: true, // Erroneously claims satisfied
        suggestedNextSteps: [],
      }),
      tokensUsed: 60,
      promptTokens: 40,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 30,
    };
  });

  const evaluation = await evaluateExplorerStep({
    goal: "Raft consensus election safety",
    action: { type: "navigate", url: "https://example.com", reasoning: "" },
    observations: "Welcome to our cloud platform.",
    stepNumber: 2,
    maxSteps: 5,
  });

  assert.equal(evaluation.goalSatisfied, false);
});

test("critic overrides goalSatisfied to false when feedback explicitly indicates missing evidence", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        score: 0.75,
        relevance: "high",
        feedback: "The page discusses Raft but does not contain the election safety invariant definition.",
        goalSatisfied: true, // Erroneously true despite feedback stating it's missing
        suggestedNextSteps: ["Search specifically for election safety proof"],
      }),
      tokensUsed: 70,
      promptTokens: 45,
      completionTokens: 25,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 35,
    };
  });

  const evaluation = await evaluateExplorerStep({
    goal: "What is Raft consensus election safety invariant?",
    action: { type: "navigate", url: "https://example.com/raft", reasoning: "" },
    observations: "Raft has leaders and followers.",
    stepNumber: 2,
    maxSteps: 5,
  });

  assert.equal(evaluation.goalSatisfied, false);
});

test("estimateTokenCost calculates accurate cost for Groq and Gemini", () => {
  const groqCost = estimateTokenCost(10000, "groq");
  assert.equal(groqCost, 0.002);

  const geminiCost = estimateTokenCost(10000, "gemini");
  assert.equal(geminiCost, 0.0074);

  assert.equal(estimateTokenCost(0, "groq"), 0);
});
