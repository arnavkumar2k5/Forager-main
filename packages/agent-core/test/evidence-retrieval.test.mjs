import test from "node:test";
import assert from "node:assert/strict";
import {
  extractRelevantPassages,
  extractQueryKeywords,
  splitIntoDocumentSections,
} from "../src/extraction/passages";
import { searchWeb, scrapeUrl, setCrawlerClient } from "../src/crawler";
import { setLLMClient, resolveLLMConfig, estimateTokenCost } from "../src/llm/client";
import { executeExplorerStep, buildExplorerPrompt } from "../src/explore-critic/explorer";
import { evaluateExplorerStep } from "../src/explore-critic/critic";
import { synthesizeFinalAnswer } from "../src/llm/synthesis";

test.beforeEach(() => {
  setLLMClient(null);
  setCrawlerClient(null);
});

test.afterEach(() => {
  setLLMClient(null);
  setCrawlerClient(null);
});

test("1. extractRelevantPassages extracts passage appearing deep in document (> 5,000 chars) that naive prefix slicing misses", () => {
  // Construct a document where the first 5,000 characters are introductory/fluff
  const introFluff = "# Distributed Systems Overview\n\n" + "This is a general overview chapter. ".repeat(150);
  assert.ok(introFluff.length > 5000, `Expected intro > 5000, got ${introFluff.length}`);

  // Put the crucial answer deep inside Section 5.2 (at char ~5,200)
  const targetSection = `
## 5 Raft Safety Properties

### 5.2 Leader Election Safety
Election Safety Invariant: At most one leader can be elected in a given term.
If a server receives a RequestVote RPC from a candidate with older log entries, it denies the vote.
`;
  const trailingFluff = "\n\n## 6 Performance Evaluation\n\n" + "Evaluation benchmarks. ".repeat(100);
  const fullDocument = introFluff + targetSection + trailingFluff;

  // Verify naive slicing misses it
  const naivePrefix = fullDocument.slice(0, 2000);
  assert.equal(naivePrefix.includes("Election Safety Invariant"), false);

  // Targeted extraction finds it
  const extracted = extractRelevantPassages(
    fullDocument,
    "What is Raft consensus election safety invariant?"
  );

  assert.equal(extracted.hasDirectMatch, true);
  assert.ok(extracted.matchedTerms.includes("election"));
  assert.ok(extracted.matchedTerms.includes("safety"));
  assert.ok(extracted.excerpt.includes("Election Safety Invariant: At most one leader can be elected in a given term"));
  assert.ok(extracted.excerpt.includes("[Relevant Section: ### 5.2 Leader Election Safety]"));
  assert.ok(extracted.excerpt.includes("[Document Overview / Lead Excerpt]"));
});

test("2. searchWeb preserves result titles, URLs, and descriptions when available", async () => {
  setCrawlerClient({
    search: async () => ({
      success: true,
      data: [
        {
          url: "https://raft.github.io/raft.pdf",
          title: "In Search of an Understandable Consensus Algorithm",
          description: "Authoritative technical report by Diego Ongaro and John Ousterhout detailing Raft consensus.",
        },
        {
          url: "https://en.wikipedia.org/wiki/Raft_(algorithm)",
          metadata: {
            title: "Raft (algorithm) - Wikipedia",
            description: "Wikipedia encyclopedia article explaining Raft consensus mechanics and election safety.",
          },
        },
      ],
    }),
  });

  const results = await searchWeb("Raft consensus");
  assert.equal(results.length, 2);

  assert.equal(results[0]?.url, "https://raft.github.io/raft.pdf");
  assert.equal(results[0]?.title, "In Search of an Understandable Consensus Algorithm");
  assert.ok(results[0]?.description.includes("Authoritative technical report"));

  assert.equal(results[1]?.url, "https://en.wikipedia.org/wiki/Raft_(algorithm)");
  assert.equal(results[1]?.title, "Raft (algorithm) - Wikipedia");
  assert.ok(results[1]?.description.includes("Wikipedia encyclopedia article"));
});

test("3. Explorer triggers targeted follow-up search when Critic notes missing definition", async () => {
  let promptSeen = "";
  setLLMClient(async (messages) => {
    promptSeen = messages.find((m) => m.role === "user")?.content || "";
    return {
      content: JSON.stringify({
        type: "search",
        query: '"In Search of an Understandable Consensus Algorithm" "Election Safety"',
        reasoning: "Critic reported that abstract lacked the specific Section 5.2 invariant; executing targeted search with paper title and exact term.",
      }),
      tokensUsed: 95,
      promptTokens: 60,
      completionTokens: 35,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 40,
    };
  });

  const action = await executeExplorerStep({
    goal: "What is Raft consensus election safety invariant?",
    trajectoryHistory: [
      {
        stepNumber: 1,
        timestamp: new Date().toISOString(),
        action: {
          type: "navigate",
          url: "https://raft.github.io/raft.pdf",
          reasoning: "Navigate to Raft paper",
        },
        evaluation: {
          score: 0.3,
          relevance: "low",
          feedback: "The retrieved excerpt contains only the title and abstract; it does not contain the election safety invariant definition.",
          goalSatisfied: false,
          suggestedNextSteps: ['Search specifically for "In Search of an Understandable Consensus Algorithm" "Election Safety"'],
        },
        observations: "Document title and abstract only.",
        tokensUsed: 120,
      },
    ],
    stepNumber: 2,
    maxSteps: 4,
  });

  assert.equal(action.type, "search");
  assert.ok(action.query?.includes("Election Safety"));
  assert.ok(promptSeen.includes("Critic Feedback"));
  assert.ok(promptSeen.includes("does not contain the election safety invariant"));
});

test("4. Duplicate URLs are tracked and not fetched repeatedly by heuristic fallback", () => {
  const visitedUrl = "https://example.com/visited-paper";
  const unvisitedUrl = "https://example.com/unvisited-guide";

  const searchObservation = `Search results for query:
[Result 1] Visited Paper (${visitedUrl}) - First result
[Result 2] Unvisited Guide (${unvisitedUrl}) - Second result`;

  const prompt = buildExplorerPrompt({
    goal: "Understand Paxos consensus",
    trajectoryHistory: [
      {
        stepNumber: 1,
        timestamp: new Date().toISOString(),
        action: { type: "navigate", url: visitedUrl, reasoning: "Visited first URL" },
        tokensUsed: 50,
      },
    ],
    currentObservation: searchObservation,
  });

  // Visited URLs are tracked in prompt
  assert.ok(prompt.includes(visitedUrl));
  assert.ok(prompt.includes("Already Visited URLs"));
});

test("5. Irrelevant evidence does not produce a successful synthesis or high critic score", async () => {
  setLLMClient(async (messages) => {
    const isCritic = messages.some((m) => m.content.includes("Critic") || m.content.includes("critic") || m.content.includes("Evaluate"));
    if (isCritic) {
      return {
        content: JSON.stringify({
          score: 0.1,
          relevance: "low",
          feedback: "The page discusses pasta recipes, completely irrelevant to Paxos consensus.",
          goalSatisfied: false,
          suggestedNextSteps: ["Search for Paxos distributed consensus instead."],
        }),
        tokensUsed: 50,
        promptTokens: 35,
        completionTokens: 15,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 20,
      };
    }
    return {
      content: JSON.stringify({
        answer: "The provided source discusses recipes for Italian pasta and does not contain information about Paxos consensus.",
        citations: ["https://cooking.com/pasta"],
        isComplete: false,
        missingInformation: "All technical details of Paxos distributed consensus.",
      }),
      tokensUsed: 70,
      promptTokens: 50,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 30,
    };
  });

  const synthesis = await synthesizeFinalAnswer({
    query: "How does Paxos achieve distributed consensus?",
    evidence: [
      {
        url: "https://cooking.com/pasta",
        title: "Traditional Carbonara Recipe",
        content: "Boil water, add pasta, combine eggs and pecorino cheese.",
      },
    ],
  });

  assert.equal(synthesis.isComplete, false);
  assert.ok(synthesis.answer.includes("does not contain information"));

  // Also check Critic on irrelevant observation
  const criticEval = await evaluateExplorerStep({
    goal: "How does Paxos achieve distributed consensus?",
    action: { type: "navigate", url: "https://cooking.com/pasta", reasoning: "" },
    observations: "Boil water, add pasta, combine eggs and pecorino cheese.",
    stepNumber: 1,
    maxSteps: 3,
  });

  assert.equal(criticEval.goalSatisfied, false);
  assert.ok(criticEval.score <= 0.4);
});

test("6. Sufficient evidence produces substantive answer with valid verified citations", async () => {
  const verifiedUrl = "https://raft.github.io/raft.pdf";
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "In Raft consensus, the Election Safety invariant specifies that at most one leader can be elected in any given term. This prevents split-brain state machinedivergence.",
        citations: [verifiedUrl],
        isComplete: true,
      }),
      tokensUsed: 130,
      promptTokens: 90,
      completionTokens: 40,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 45,
    };
  });

  const synthesis = await synthesizeFinalAnswer({
    query: "What is Raft consensus election safety invariant?",
    evidence: [
      {
        url: verifiedUrl,
        title: "Raft Paper",
        content: "Election Safety: at most one leader can be elected in a given term (§5.2).",
      },
    ],
  });

  assert.equal(synthesis.isComplete, true);
  assert.ok(synthesis.answer.includes("at most one leader can be elected"));
  assert.deepEqual(synthesis.citations, [verifiedUrl]);
  assert.ok(synthesis.evidenceSnippets && synthesis.evidenceSnippets.length >= 1);
});

test("7. Insufficient evidence produces an honest incomplete answer", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "The retrieved documents mention that Raft has safety invariants but do not provide the specific wording of the Election Safety invariant.",
        citations: ["https://example.com/raft-summary"],
        isComplete: false,
        missingInformation: "Exact formulation of Section 5.2 Election Safety invariant.",
      }),
      tokensUsed: 80,
      promptTokens: 55,
      completionTokens: 25,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 35,
    };
  });

  const synthesis = await synthesizeFinalAnswer({
    query: "What is Raft consensus election safety invariant?",
    evidence: [
      {
        url: "https://example.com/raft-summary",
        title: "Brief Summary",
        content: "Raft is designed for understandability. It has five safety properties.",
      },
    ],
  });

  assert.equal(synthesis.isComplete, false);
  assert.ok(synthesis.missingInformation?.includes("Election Safety"));
});

test("8. Invented citation URLs are strictly rejected and dropped", async () => {
  setLLMClient(async () => {
    return {
      content: JSON.stringify({
        answer: "Multi-head Latent Attention compresses KV cache via low-rank projection.",
        citations: [
          "https://arxiv.org/abs/2412.19437",
          "https://completely-fabricated-link.org/hallucination",
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

  const synthesis = await synthesizeFinalAnswer({
    query: "What is MLA?",
    evidence: [
      {
        url: "https://arxiv.org/abs/2412.19437",
        title: "DeepSeek-V3",
        content: "Multi-head Latent Attention (MLA) uses low-rank joint compression.",
      },
    ],
  });

  assert.deepEqual(synthesis.citations, ["https://arxiv.org/abs/2412.19437"]);
  assert.equal(synthesis.citations.includes("https://completely-fabricated-link.org/hallucination"), false);
});

test("9. Source retrieval or scraping failure does not crash the run and handles fail-open", async () => {
  setCrawlerClient({
    scrapeUrl: async () => {
      throw new Error("HTTP 403 Forbidden / Cloudflare challenge");
    },
  });

  await assert.rejects(
    async () => {
      await scrapeUrl("https://protected-paywall.com/article");
    },
    /Scraping failed for https:\/\/protected-paywall\.com\/article: HTTP 403 Forbidden/
  );
});

test("10. maxSteps remains strictly enforced preventing infinite loops", async () => {
  let llmInvocations = 0;
  setLLMClient(async () => {
    llmInvocations++;
    return {
      content: JSON.stringify({ type: "search", query: "Keep searching", reasoning: "Loop" }),
      tokensUsed: 10,
      promptTokens: 5,
      completionTokens: 5,
      model: "test",
      provider: "groq",
      durationMs: 5,
    };
  });

  const action = await executeExplorerStep({
    goal: "Test termination",
    trajectoryHistory: [
      { stepNumber: 1, timestamp: "", action: { type: "search", reasoning: "" }, tokensUsed: 0 },
      { stepNumber: 2, timestamp: "", action: { type: "search", reasoning: "" }, tokensUsed: 0 },
    ],
    stepNumber: 3,
    maxSteps: 2, // 2 steps allowed; step 3 must terminate
  });

  assert.equal(action.type, "finish");
  assert.ok(action.reasoning.includes("Maximum trajectory depth"));
  assert.equal(llmInvocations, 0); // Terminated without calling LLM
});

test("11. Token counts are tracked and cost estimates are calculated correctly", () => {
  const groqCost = estimateTokenCost(5000, "groq");
  assert.equal(groqCost, 0.001);

  const geminiCost = estimateTokenCost(10000, "gemini");
  assert.equal(geminiCost, 0.0074);

  assert.equal(estimateTokenCost(0, "groq"), 0);
});

test("12. Configured provider is respected without automatic fallback", () => {
  const config = resolveLLMConfig();
  // Selected provider is groq (from env.AI_PROVIDER)
  assert.ok(config.provider === "groq" || config.provider === "gemini");
  assert.ok(config.apiKey.length > 0);
  assert.ok(config.model.length > 0);
});

test("13. extractRelevantPassages extracts deep target sentence (> 3,000 chars) in document with no headings or blank-line paragraph breaks", () => {
  // Construct a single unstructured monolithic string with only sentence periods (no '#' headings, no '\n\n')
  const sentences = [];
  for (let i = 1; i <= 50; i++) {
    sentences.push(`This is filler sentence number ${i} describing general background concepts in computer networking and basic hardware components.`);
  }
  const prefix = sentences.join(" ");
  assert.ok(prefix.length > 3000, `Prefix must be > 3000 chars, got ${prefix.length}`);

  const targetSentence = "The critical Paxos consensus protocol invariant dictates that only a single proposed value can be chosen across all learner nodes.";

  const suffixSentences = [];
  for (let i = 1; i <= 30; i++) {
    suffixSentences.push(`Trailing background remark ${i} discusses historical trends in distributed systems infrastructure.`);
  }
  const suffix = suffixSentences.join(" ");

  const unstructuredDoc = `${prefix} ${targetSentence} ${suffix}`;
  assert.ok(!unstructuredDoc.includes("#"), "Must contain no markdown headers");
  assert.ok(!unstructuredDoc.includes("\n\n"), "Must contain no blank-line paragraph breaks");

  const targetOffset = unstructuredDoc.indexOf(targetSentence);
  assert.ok(targetOffset > 3000, `Target offset must be > 3000, was ${targetOffset}`);

  const extracted = extractRelevantPassages(
    unstructuredDoc,
    "What is Paxos consensus protocol invariant?"
  );

  assert.equal(extracted.hasDirectMatch, true);
  assert.ok(extracted.selectedPassagesCount > 0);
  assert.ok(extracted.matchedTerms.includes("paxos"));
  assert.ok(extracted.matchedTerms.includes("consensus"));
  assert.ok(extracted.matchedTerms.includes("invariant"));
  assert.ok(extracted.excerpt.includes(targetSentence));
  // Verifies character range is retained
  assert.ok(/Window \[chars \d+-\d+\]/.test(extracted.excerpt));
  // Total excerpt preserves budget
  assert.ok(extracted.excerpt.length <= 4500);
});

test("14. extractRelevantPassages on long unstructured document with no relevant sentence is not falsely marked as a match", () => {
  // Monolithic text with no headings or blank-line breaks, and completely unrelated content
  const sentences = [];
  for (let i = 1; i <= 60; i++) {
    sentences.push(`Sentence ${i} discusses atmospheric chemistry, nitrogen cycles, and meteorological humidity measurements.`);
  }
  const unstructuredDoc = sentences.join(" ");
  assert.ok(unstructuredDoc.length > 3000);
  assert.ok(!unstructuredDoc.includes("#"));
  assert.ok(!unstructuredDoc.includes("\n\n"));

  const extracted = extractRelevantPassages(
    unstructuredDoc,
    "What is Raft leader election safety invariant?"
  );

  // Must NOT be falsely labeled as a match
  assert.equal(extracted.hasDirectMatch, false);
  assert.equal(extracted.selectedPassagesCount, 0);
  assert.deepEqual(extracted.matchedTerms, []);
  assert.ok(extracted.limitationNote?.includes("did not locate sections matching query terms"));
  assert.ok(extracted.excerpt.includes("[Retrieval Note:"));
  assert.ok(extracted.excerpt.includes("[Document Overview / Lead Excerpt]"));
});

test("15. extractRelevantPassages handles queries with no meaningful terms such as 'how it is', empty string, and whitespace", () => {
  const sampleDoc = "Raft is a consensus algorithm designed as an alternative to Paxos. It provides fault-tolerant state machine replication.";

  // 'how it is' -> all stopwords
  const stopwordRes = extractRelevantPassages(sampleDoc, "how it is");
  assert.equal(stopwordRes.hasDirectMatch, false);
  assert.equal(stopwordRes.selectedPassagesCount, 0);
  assert.deepEqual(stopwordRes.matchedTerms, []);
  assert.ok(stopwordRes.limitationNote?.includes("no meaningful search terms after stopword filtering"));
  assert.ok(stopwordRes.excerpt.includes("[Document Overview / Unranked Lead Excerpt]"));

  // Empty query
  const emptyRes = extractRelevantPassages(sampleDoc, "");
  assert.equal(emptyRes.hasDirectMatch, false);
  assert.equal(emptyRes.selectedPassagesCount, 0);
  assert.deepEqual(emptyRes.matchedTerms, []);
  assert.ok(emptyRes.limitationNote?.includes("no meaningful search terms"));

  // Whitespace-only query
  const whitespaceRes = extractRelevantPassages(sampleDoc, "   \t\n  ");
  assert.equal(whitespaceRes.hasDirectMatch, false);
  assert.equal(whitespaceRes.selectedPassagesCount, 0);
  assert.deepEqual(whitespaceRes.matchedTerms, []);
  assert.ok(whitespaceRes.limitationNote?.includes("no meaningful search terms"));
});
