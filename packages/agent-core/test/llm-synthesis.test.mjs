import test from "node:test";
import assert from "node:assert/strict";
import { setLLMClient } from "../src/llm/client";
import { synthesizeFinalAnswer, normalizeCitationUrl } from "../src/llm/synthesis";

test.beforeEach(() => {
  setLLMClient(null);
});

test.afterEach(() => {
  setLLMClient(null);
});

test("synthesizes direct factual answer with valid citations from evidence", async () => {
  setLLMClient(async (messages) => {
    return {
      content: JSON.stringify({
        answer: "Raft's Election Safety invariant guarantees that at most one leader can be elected in any given term.",
        citations: ["https://raft.github.io/raft.pdf"],
        isComplete: true,
      }),
      tokensUsed: 110,
      promptTokens: 75,
      completionTokens: 35,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 45,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://raft.github.io/raft.pdf",
        title: "In Search of an Understandable Consensus Algorithm",
        content: "Election Safety: at most one leader can be elected in a given term (§5.2).",
      },
    ],
  });

  assert.equal(res.isComplete, true);
  assert.ok(res.answer.includes("at most one leader"));
  assert.deepEqual(res.citations, ["https://raft.github.io/raft.pdf"]);
  assert.equal(res.tokensUsed, 110);
});

test("returns honest incomplete answer when evidence is insufficient", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "The provided source discusses Paxos history but does not contain details about Raft election safety.",
        citations: ["https://example.com/paxos"],
        isComplete: false,
        missingInformation: "Specific Raft election safety invariant definition.",
      }),
      tokensUsed: 85,
      promptTokens: 60,
      completionTokens: 25,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 30,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://example.com/paxos",
        title: "Paxos History",
        content: "Leslie Lamport published Paxos in 1998.",
      },
    ],
  });

  assert.equal(res.isComplete, false);
  assert.ok(res.answer.includes("does not contain"));
  assert.ok(res.missingInformation?.includes("Raft"));
  assert.equal(res.tokensUsed, 85);
});

test("filters out fabricated citation URLs not present in retrieved evidence", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Multi-head Latent Attention compresses KV cache into low-dimensional latent vectors.",
        citations: [
          "https://arxiv.org/abs/2412.19437",
          "https://hallucinated-fake-source.com/random",
          "https://another-fake.org",
        ],
        isComplete: true,
      }),
      tokensUsed: 120,
      promptTokens: 80,
      completionTokens: 40,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 50,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "How does MLA compress KV cache?",
    evidence: [
      {
        url: "https://arxiv.org/abs/2412.19437",
        title: "DeepSeek-V3",
        content: "MLA low-rank key-value joint compression saves memory.",
      },
    ],
  });

  // Only the genuine retrieved URL is kept
  assert.deepEqual(res.citations, ["https://arxiv.org/abs/2412.19437"]);
  assert.ok(!res.citations.includes("https://hallucinated-fake-source.com/random"));
  assert.equal(res.isComplete, true);
});

test("handles empty evidence without calling LLM and returns incomplete status", async () => {
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

  const res = await synthesizeFinalAnswer({
    query: "What is Byzantine fault tolerance?",
    evidence: [],
  });

  assert.equal(res.isComplete, false);
  assert.equal(res.tokensUsed, 0);
  assert.deepEqual(res.citations, []);
  assert.ok(res.answer.includes("No primary source documents were successfully retrieved"));
  assert.equal(llmCalled, false);
});

test("handles synthesis API errors gracefully without throwing", async () => {
  setLLMClient(async () => {
    throw new Error("Rate limit exceeded on Groq API");
  });

  const res = await synthesizeFinalAnswer({
    query: "What is 2PC?",
    evidence: [
      {
        url: "https://example.com/2pc",
        title: "Two Phase Commit",
        content: "2PC consists of prepare and commit phases.",
      },
    ],
  });

  assert.equal(res.isComplete, false);
  assert.equal(res.tokensUsed, 0);
  assert.ok(res.answer.includes("Rate limit exceeded"));
  assert.deepEqual(res.citations, ["https://example.com/2pc"]);
});

test("handles invalid JSON from model safely and returns fallback", async () => {
  setLLMClient(async () => {
    return {
      content: "Sorry, I cannot format this response as JSON.",
      tokensUsed: 40,
      promptTokens: 30,
      completionTokens: 10,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 25,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft?",
    evidence: [
      {
        url: "https://example.com/raft",
        title: "Raft",
        content: "Raft consensus details.",
      },
    ],
  });

  assert.equal(res.isComplete, false);
  assert.equal(res.tokensUsed, 40);
  assert.ok(res.answer.includes("Sorry, I cannot format this response as JSON.") || res.answer.includes("was not valid JSON"));
});

test("normalizeCitationUrl helper handles protocol, casing, trailing slashes, fragments, and rejects invalid URLs", () => {
  // Hostname casing
  assert.equal(
    normalizeCitationUrl("HTTPS://Raft.GitHub.IO/raft.pdf"),
    "https://raft.github.io/raft.pdf"
  );

  // Trailing slashes
  assert.equal(
    normalizeCitationUrl("https://example.com/docs/raft/"),
    "https://example.com/docs/raft"
  );
  assert.equal(
    normalizeCitationUrl("https://example.com/"),
    "https://example.com"
  );
  assert.equal(
    normalizeCitationUrl("https://example.com"),
    "https://example.com"
  );

  // URL fragments
  assert.equal(
    normalizeCitationUrl("https://example.com/paper.pdf#section2"),
    "https://example.com/paper.pdf"
  );
  assert.equal(
    normalizeCitationUrl("https://example.com/docs/#overview"),
    "https://example.com/docs"
  );

  // Query parameters are preserved
  assert.equal(
    normalizeCitationUrl("https://example.com/search?q=raft#results"),
    "https://example.com/search?q=raft"
  );

  // Malformed and non-http URLs are rejected
  assert.equal(normalizeCitationUrl("not-a-valid-url"), null);
  assert.equal(normalizeCitationUrl("ftp://example.com/file.txt"), null);
  assert.equal(normalizeCitationUrl("javascript:void(0)"), null);
  assert.equal(normalizeCitationUrl(""), null);
  assert.equal(normalizeCitationUrl("   "), null);
});

test("synthesizeFinalAnswer handles trailing slash differences while preserving canonical retrieved URL", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Raft leader election safety guarantees one leader per term.",
        citations: ["https://example.com/docs/raft"], // No trailing slash from LLM
        isComplete: true,
      }),
      tokensUsed: 100,
      promptTokens: 70,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://example.com/docs/raft/", // Trailing slash in retrieved URL
        title: "Raft Documentation",
        content: "Election Safety Invariant: At most one leader can be elected in a given term.",
      },
    ],
  });

  assert.equal(res.isComplete, true);
  // Preserves original retrieved canonical URL
  assert.deepEqual(res.citations, ["https://example.com/docs/raft/"]);
});

test("synthesizeFinalAnswer handles URL fragments while preserving canonical retrieved URL", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Election safety ensures at most one leader per term.",
        citations: ["https://example.com/raft.pdf#section-5.2"], // Added fragment
        isComplete: true,
      }),
      tokensUsed: 100,
      promptTokens: 70,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://example.com/raft.pdf", // Canonical URL without fragment
        title: "Raft Paper",
        content: "Election Safety Invariant: At most one leader can be elected in a given term (§5.2).",
      },
    ],
  });

  assert.equal(res.isComplete, true);
  assert.deepEqual(res.citations, ["https://example.com/raft.pdf"]);
});

test("synthesizeFinalAnswer handles hostname casing while preserving canonical retrieved URL", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Election safety is verified.",
        citations: ["HTTPS://RAFT.GITHUB.IO/raft.pdf"], // Uppercase hostname and protocol
        isComplete: true,
      }),
      tokensUsed: 100,
      promptTokens: 70,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://raft.github.io/raft.pdf",
        title: "Raft Technical Report",
        content: "Election Safety Invariant: At most one leader can be elected in a given term.",
      },
    ],
  });

  assert.equal(res.isComplete, true);
  assert.deepEqual(res.citations, ["https://raft.github.io/raft.pdf"]);
});

test("synthesizeFinalAnswer rejects malformed URLs and does not broaden allowed sources", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Election safety is documented.",
        citations: [
          "not a valid url",
          "javascript:alert(1)",
          "https://valid-format-but-never-retrieved.com/paper.pdf",
          "https://example.com/raft.pdf",
        ],
        isComplete: true,
      }),
      tokensUsed: 100,
      promptTokens: 70,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety?",
    evidence: [
      {
        url: "https://example.com/raft.pdf",
        title: "Raft Paper",
        content: "Election Safety Invariant: At most one leader can be elected in a given term.",
      },
    ],
  });

  assert.equal(res.isComplete, true);
  // Rejects malformed and unretrieved URLs; keeps ONLY the retrieved canonical URL
  assert.deepEqual(res.citations, ["https://example.com/raft.pdf"]);
});

test("synthesizeFinalAnswer rejects empty or whitespace-only queries immediately", async () => {
  let llmCalled = false;
  setLLMClient(async () => {
    llmCalled = true;
    return { content: "{}" };
  });

  const resEmpty = await synthesizeFinalAnswer({
    query: "",
    evidence: [{ url: "https://example.com", content: "Some content" }],
  });
  assert.equal(resEmpty.isComplete, false);
  assert.equal(llmCalled, false);
  assert.ok(resEmpty.missingInformation?.includes("empty"));

  const resWhitespace = await synthesizeFinalAnswer({
    query: "   \t\n  ",
    evidence: [{ url: "https://example.com", content: "Some content" }],
  });
  assert.equal(resWhitespace.isComplete, false);
  assert.equal(llmCalled, false);
});

test("synthesizeFinalAnswer marks incomplete for query with no meaningful terms such as 'how it is'", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "This is how things are.",
        citations: ["https://example.com/info"],
        isComplete: true, // LLM mistakenly claimed complete
      }),
      tokensUsed: 60,
      promptTokens: 40,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 20,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "how it is",
    evidence: [
      {
        url: "https://example.com/info",
        title: "General Info",
        content: "General information content.",
      },
    ],
  });

  // Query had no meaningful terms: must be marked incomplete
  assert.equal(res.isComplete, false);
  assert.ok(res.missingInformation?.includes("no specific search terms"));
});

test("synthesizeFinalAnswer does not mark complete when all evidence is unranked fallback excerpts", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "The document overview mentions general distributed systems.",
        citations: ["https://example.com/unmatched"],
        isComplete: true, // LLM claimed complete on fallback
      }),
      tokensUsed: 80,
      promptTokens: 50,
      completionTokens: 30,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 25,
    };
  });

  const res = await synthesizeFinalAnswer({
    query: "What is Raft election safety invariant?",
    evidence: [
      {
        url: "https://example.com/unmatched",
        title: "Overview",
        content:
          "[Document Overview / Lead Excerpt]\nGeneral introduction.\n\n---\n\n[Retrieval Note: Keyword search across the full document did not locate sections matching query terms [raft, election, safety, invariant]. Showing document lead only.]",
      },
    ],
  });

  // Fallback evidence cannot produce a complete answer
  assert.equal(res.isComplete, false);
  assert.ok(res.missingInformation?.includes("unverified lead excerpts"));
});
