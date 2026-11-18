import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  server,
  setExecutionRepository,
  setTrajectoryRepository,
  setPropositionRepository,
  storeInMemoryPropositions,
  clearInMemoryPropositions,
} from "../src/index.ts";
import {
  setEmbeddingClient,
  clearEmbeddingCache,
  EXPECTED_EMBEDDING_DIM,
} from "../../../packages/agent-core/src/ohcache/vector.ts";
import { setCrawlerClient } from "../../../packages/agent-core/src/crawler.ts";
import { setLLMClient } from "../../../packages/agent-core/src/llm/client.ts";

function createMockVector(dim = EXPECTED_EMBEDDING_DIM, fillVal = 0.05) {
  return new Array(dim).fill(fillVal);
}

test.beforeEach(() => {
  setExecutionRepository(null);
  setTrajectoryRepository(null);
  setPropositionRepository(null);
  setEmbeddingClient(null);
  setCrawlerClient(null);
  setLLMClient(null);
  clearInMemoryPropositions();
  clearEmbeddingCache();
});

test.afterEach(() => {
  setExecutionRepository(null);
  setTrajectoryRepository(null);
  setPropositionRepository(null);
  setEmbeddingClient(null);
  setCrawlerClient(null);
  setLLMClient(null);
  clearInMemoryPropositions();
  clearEmbeddingCache();
});

test("1. propositions/search: Empty or invalid query returns 400 validation error", async () => {
  const res = await server.inject({
    method: "POST",
    url: "/api/v1/propositions/search",
    payload: {
      query: "   ",
    },
  });

  assert.equal(res.statusCode, 400);
  const body = JSON.parse(res.body);
  assert.equal(body.error, "Invalid proposition search payload");
});

test("2. propositions/search: Returns 1024-dim semantic matches from in-memory fallback", async () => {
  const scoutId = crypto.randomUUID();
  const targetVector = createMockVector(1024, 0.1);

  // Store existing propositions in memory with embeddings
  storeInMemoryPropositions(scoutId, [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Raft consensus election safety invariant guarantees single leader per term.",
      sourceUrl: "https://raft.github.io/raft.pdf",
      confidence: 0.95,
      embedding: targetVector,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Unrelated proposition with low similarity.",
      sourceUrl: "https://example.com/unrelated",
      confidence: 0.95,
      // Orthogonal vector (low similarity)
      embedding: new Array(1024).fill(0).map((_, i) => (i < 512 ? 0 : 0.1)),
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ]);

  // Mock Gemini embedding client to return identical target vector
  setEmbeddingClient({
    generateEmbedding: async () => targetVector,
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/propositions/search",
    payload: {
      query: "Raft leader election safety",
      scoutId,
      matchThreshold: 0.8,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.query, "Raft leader election safety");
  assert.equal(data.dimensions, 1024);
  assert.equal(data.similarityMethod, "vector_cosine");
  assert.equal(data.source, "in_memory_fallback");
  assert.ok(data.matches.length >= 1);
  assert.equal(data.matches[0].similarityMethod, "vector_cosine");
  assert.ok(data.matches[0].content.includes("Raft consensus election safety"));
  assert.ok(data.matches[0].similarity > 0.95);
});

test("3. propositions/search: Empty match results report similarityMethod 'none'", async () => {
  const scoutId = crypto.randomUUID();
  const queryVec = createMockVector(1024, 0.05);

  setEmbeddingClient({
    generateEmbedding: async () => queryVec,
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/propositions/search",
    payload: {
      query: "Unmatched query topic",
      scoutId,
      matchThreshold: 0.9,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.matches.length, 0);
  assert.equal(data.similarityMethod, "none");
});

test("4. propositions/search: Lexical-only matches truthfully report similarityMethod 'lexical_jaccard'", async () => {
  const scoutId = crypto.randomUUID();
  const queryVec = createMockVector(1024, 0.05);

  // Store proposition without embedding (e.g. historical un-embedded proposition)
  storeInMemoryPropositions(scoutId, [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Byzantine fault tolerance requires quorum size over two thirds.",
      sourceUrl: "https://example.com/bft",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ]);

  setEmbeddingClient({
    generateEmbedding: async () => queryVec,
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/propositions/search",
    payload: {
      query: "Byzantine fault tolerance quorum",
      scoutId,
      matchThreshold: 0.4,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.ok(data.matches.length >= 1);
  assert.equal(data.similarityMethod, "lexical_jaccard");
  assert.equal(data.matches[0].similarityMethod, "lexical_jaccard");
});

test("5. propositions/search: Mixed vector and lexical matches truthfully report similarityMethod 'mixed'", async () => {
  const scoutId = crypto.randomUUID();
  const queryVec = createMockVector(1024, 0.05);

  storeInMemoryPropositions(scoutId, [
    // Vector match
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Vector matched proposition on consensus.",
      sourceUrl: "https://example.com/vector",
      confidence: 0.95,
      embedding: queryVec, // exact match
      status: "active",
      createdAt: new Date().toISOString(),
    },
    // Lexical match (no embedding)
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Consensus protocols require quorum intersection.",
      sourceUrl: "https://example.com/lexical",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ]);

  setEmbeddingClient({
    generateEmbedding: async () => queryVec,
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/propositions/search",
    payload: {
      query: "Consensus protocols quorum intersection",
      scoutId,
      matchThreshold: 0.3,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.matches.length, 2);
  assert.equal(data.similarityMethod, "mixed");
});

test("6. scout/run: Generates and attaches 1024-dim embeddings to novel propositions", async () => {
  const scoutId = crypto.randomUUID();
  let savedPropositions = [];

  setExecutionRepository({
    findScoutById: async (id) => ({ id, title: "Raft Monitor", goal: "Track Raft updates" }),
    createExecution: async () => {},
    updateExecution: async () => {},
    getExecutionById: async () => null,
  });

  setPropositionRepository({
    findByScoutId: async () => [],
    savePropositions: async (props) => {
      savedPropositions = props;
    },
    saveProposition: async () => {},
  });

  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [{ url: "https://raft.github.io/raft.pdf", title: "Raft Paper" }],
    }),
    scrapeUrl: async () => ({
      success: true,
      markdown: "# Raft\n\nElection Safety: At most one leader can be elected in a given term (§5.2).",
    }),
  });

  let stepCalls = 0;
  setLLMClient(async (messages) => {
    const sysMsg = messages.find((m) => m.role === "system")?.content || "";
    if (sysMsg.includes("Lead Research Synthesizer")) {
      return {
        content: JSON.stringify({
          answer: "In Raft consensus, at most one leader can be elected in a given term.",
          citations: ["https://raft.github.io/raft.pdf"],
          isComplete: true,
        }),
        tokensUsed: 60,
      };
    }
    stepCalls++;
    if (stepCalls === 1) {
      return {
        content: JSON.stringify({
          type: "navigate",
          url: "https://raft.github.io/raft.pdf",
          reasoning: "Read paper",
        }),
        tokensUsed: 25,
      };
    }
    return {
      content: JSON.stringify({ type: "finish", reasoning: "Done" }),
      tokensUsed: 20,
    };
  });

  const mockVector = createMockVector(1024, 0.07);
  let embeddingCalls = 0;
  setEmbeddingClient({
    generateEmbedding: async () => {
      embeddingCalls++;
      return mockVector;
    },
  });

  const res = await server.inject({
    method: "POST",
    url: "/api/v1/scout/run",
    payload: {
      scoutId,
      query: "What is Raft election safety?",
      maxSteps: 2,
    },
  });

  assert.equal(res.statusCode, 200);
  const data = JSON.parse(res.body);

  assert.equal(data.status, "completed");
  assert.ok(embeddingCalls > 0);
  assert.ok(savedPropositions.length > 0);
  // Verifies that saved propositions have genuine 1024-dim embedding arrays
  assert.equal(savedPropositions[0].embedding?.length, 1024);
  assert.equal(savedPropositions[0].embedding[0], 0.07);
});
