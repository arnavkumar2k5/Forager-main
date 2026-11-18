import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import {
  EXPECTED_EMBEDDING_DIM,
  isValidEmbedding,
  validateEmbedding,
  cosineSimilarity,
  setEmbeddingClient,
  clearEmbeddingCache,
  generateGeminiEmbedding,
  generateEmbeddingSafe,
  attachPropositionEmbeddings,
  normalizeGeminiModel,
} from "../src/ohcache/vector.ts";
import { computePropositionDiff } from "../src/ohcache/diff.ts";

function createMockVector(dim = EXPECTED_EMBEDDING_DIM, fillValue = 0.05) {
  return new Array(dim).fill(fillValue);
}

test.beforeEach(() => {
  setEmbeddingClient(null);
  clearEmbeddingCache();
});

test.afterEach(() => {
  setEmbeddingClient(null);
  clearEmbeddingCache();
});

test("1. isValidEmbedding and validateEmbedding accept exact 1024 finite numbers", () => {
  const valid = createMockVector(1024, 0.1);
  assert.equal(isValidEmbedding(valid), true);
  assert.equal(validateEmbedding(valid), valid);
});

test("2. validateEmbedding rejects wrong vector dimensions (768, 512, 1536, 3072)", () => {
  const dim768 = createMockVector(768, 0.1);
  const dim1536 = createMockVector(1536, 0.1);
  const dim3072 = createMockVector(3072, 0.1);

  assert.equal(isValidEmbedding(dim768), false);
  assert.equal(isValidEmbedding(dim1536), false);
  assert.equal(isValidEmbedding(dim3072), false);

  assert.throws(
    () => validateEmbedding(dim768),
    /Embedding dimension mismatch for vector: expected 1024, got 768/
  );
  assert.throws(
    () => validateEmbedding(dim1536),
    /Embedding dimension mismatch for vector: expected 1024, got 1536/
  );
});

test("3. validateEmbedding rejects non-finite vector values (NaN, Infinity, strings)", () => {
  const withNaN = createMockVector(1024, 0.1);
  withNaN[10] = NaN;
  assert.equal(isValidEmbedding(withNaN), false);
  assert.throws(() => validateEmbedding(withNaN), /Invalid vector component at index 10/);

  const withInf = createMockVector(1024, 0.1);
  withInf[20] = Infinity;
  assert.equal(isValidEmbedding(withInf), false);
  assert.throws(() => validateEmbedding(withInf), /Invalid vector component at index 20/);

  const withStr = createMockVector(1024, 0.1);
  withStr[5] = "0.1";
  assert.equal(isValidEmbedding(withStr), false);
  assert.throws(() => validateEmbedding(withStr), /Invalid vector component at index 5/);
});

test("4. cosineSimilarity correctly calculates cosine angle for 1024-dim vectors", () => {
  const vecA = createMockVector(1024, 0.5);
  const vecB = createMockVector(1024, 0.5);
  const simIdentical = cosineSimilarity(vecA, vecB);
  assert.ok(Math.abs(simIdentical - 1.0) < 1e-6);

  const vecOrthA = new Array(1024).fill(0);
  const vecOrthB = new Array(1024).fill(0);
  for (let i = 0; i < 512; i++) vecOrthA[i] = 1;
  for (let i = 512; i < 1024; i++) vecOrthB[i] = 1;

  const simOrth = cosineSimilarity(vecOrthA, vecOrthB);
  assert.equal(simOrth, 0);
});

test("5. cosineSimilarity rejects incompatible vector dimensions", () => {
  const vecA = createMockVector(1024, 0.1);
  const vecB = createMockVector(768, 0.1);

  assert.throws(
    () => cosineSimilarity(vecA, vecB),
    /Embedding dimension mismatch for vector B: expected 1024, got 768/
  );
});

test("6. Mock embedding client successfully generates 1024-dim vectors without network calls", async () => {
  let callCount = 0;
  const mockVector = createMockVector(1024, 0.042);

  setEmbeddingClient({
    generateEmbedding: async (text) => {
      callCount++;
      return mockVector;
    },
  });

  const embedding = await generateGeminiEmbedding("Raft leader election");
  assert.equal(callCount, 1);
  assert.equal(embedding.length, 1024);
  assert.equal(embedding[0], 0.042);

  const cached = await generateGeminiEmbedding("Raft leader election");
  assert.equal(callCount, 1);
  assert.deepEqual(cached, mockVector);
});

test("7. generateEmbeddingSafe catches client errors and returns safe failure without fake vectors", async () => {
  setEmbeddingClient({
    generateEmbedding: async () => {
      throw new Error("Gemini quota exceeded or rate limit (HTTP 429)");
    },
  });

  const result = await generateEmbeddingSafe("Quantum computing state");
  assert.equal(result.success, false);
  assert.equal(result.embedding, undefined);
  assert.ok(result.error?.includes("quota exceeded"));
});

test("8. attachPropositionEmbeddings attaches genuine 1024-dim vectors to propositions", async () => {
  const mockVector = createMockVector(1024, 0.08);
  setEmbeddingClient({
    generateEmbedding: async () => mockVector,
  });

  const props = [
    {
      id: crypto.randomUUID(),
      scoutId: crypto.randomUUID(),
      content: "At most one leader can be elected in a given term in Raft consensus.",
      sourceUrl: "https://raft.github.io/raft.pdf",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId: crypto.randomUUID(),
      content: "Log entries flow in only one direction from leader to followers.",
      sourceUrl: "https://raft.github.io/raft.pdf",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const attachResult = await attachPropositionEmbeddings(props);
  assert.equal(attachResult.count, 2);
  assert.equal(attachResult.failed, 0);

  assert.equal(props[0].embedding?.length, 1024);
  assert.equal(props[1].embedding?.length, 1024);
});

test("9. computePropositionDiff uses vector_cosine when propositions have 1024-dim embeddings", async () => {
  const candidateVec = createMockVector(1024, 0.2);
  const historicalVec = createMockVector(1024, 0.2);

  const candidate = {
    id: crypto.randomUUID(),
    scoutId: crypto.randomUUID(),
    content: "Raft leader election invariant holds across all terms.",
    sourceUrl: "https://raft.github.io/raft.pdf",
    confidence: 0.95,
    embedding: candidateVec,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  const historical = {
    id: crypto.randomUUID(),
    scoutId: candidate.scoutId,
    content: "Different words describing same concept.",
    sourceUrl: "https://raft.github.io/raft.pdf",
    confidence: 0.95,
    embedding: historicalVec,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  const diff = await computePropositionDiff([candidate], [historical], 0.85);

  assert.equal(diff.redundantCount, 1);
  assert.equal(diff.items[0].diffType, "redundant");
  assert.equal(diff.items[0].similarityMethod, "vector_cosine");
  assert.ok(diff.items[0].explanation?.includes("1024-dim embedding cosine similarity"));
});

test("10. computePropositionDiff falls back to lexical_jaccard when propositions lack embeddings", async () => {
  const candidate = {
    id: crypto.randomUUID(),
    scoutId: crypto.randomUUID(),
    content: "Raft consensus election safety invariant.",
    sourceUrl: "https://raft.github.io/raft.pdf",
    confidence: 0.95,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  const historical = {
    id: crypto.randomUUID(),
    scoutId: candidate.scoutId,
    content: "Raft consensus election safety invariant verified.",
    sourceUrl: "https://raft.github.io/raft.pdf",
    confidence: 0.95,
    status: "active",
    createdAt: new Date().toISOString(),
  };

  const diff = await computePropositionDiff([candidate], [historical], 0.70);

  assert.equal(diff.redundantCount, 1);
  assert.equal(diff.items[0].diffType, "redundant");
  assert.equal(diff.items[0].similarityMethod, "lexical_jaccard");
  assert.ok(diff.items[0].explanation?.includes("lexical word overlap fallback"));
});

test("11. normalizeGeminiModel removes leading models/ prefix consistently", () => {
  assert.equal(normalizeGeminiModel("gemini-embedding-2"), "gemini-embedding-2");
  assert.equal(normalizeGeminiModel("models/gemini-embedding-2"), "gemini-embedding-2");
  assert.equal(normalizeGeminiModel("MODELS/gemini-embedding-2"), "gemini-embedding-2");
  assert.equal(normalizeGeminiModel("  models/custom-embed  "), "custom-embed");
});
