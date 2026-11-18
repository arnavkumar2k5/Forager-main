import test from "node:test";
import assert from "node:assert/strict";
import { searchWeb, scrapeUrl, setCrawlerClient } from "../src/crawler.ts";
import { evaluateExplorerStep } from "../src/explore-critic/critic.ts";
import { executeExplorerStep } from "../src/explore-critic/explorer.ts";
import { setLLMClient } from "../src/llm/client.ts";

test("searchWeb normalizes Firecrawl response into typed objects", async () => {
  const mockCrawler = {
    search: async (query, params) => ({
      success: true,
      data: [
        {
          url: "https://example.com/article",
          metadata: {
            title: "Example Title",
            description: "Example Description",
          },
          markdown: "# Example Article",
        },
        {
          metadata: {
            sourceURL: "https://example.org/source",
            ogTitle: "OG Title",
            ogDescription: "OG Description",
          },
        },
        {
          metadata: {
            title: "Invalid - No URL",
          },
        },
      ],
    }),
  };

  setCrawlerClient(mockCrawler);

  const results = await searchWeb("test query", { limit: 5 });
  assert.equal(results.length, 2);

  assert.deepEqual(results[0], {
    url: "https://example.com/article",
    title: "Example Title",
    description: "Example Description",
    markdown: "# Example Article",
    favicon: null,
  });

  assert.deepEqual(results[1], {
    url: "https://example.org/source",
    title: "OG Title",
    description: "OG Description",
    markdown: undefined,
    favicon: null,
  });

  setCrawlerClient(null);
});

test("searchWeb handles empty search results and API errors gracefully", async () => {
  const emptyCrawler = {
    search: async () => ({
      success: true,
      data: [],
    }),
  };

  setCrawlerClient(emptyCrawler);
  const emptyResults = await searchWeb("nonexistent topic");
  assert.equal(emptyResults.length, 0);

  const failingCrawler = {
    search: async () => ({
      success: false,
      error: "Rate limit exceeded (429)",
    }),
  };

  setCrawlerClient(failingCrawler);
  await assert.rejects(
    async () => {
      await searchWeb("rate limited query");
    },
    /Rate limit exceeded/
  );

  setCrawlerClient(null);
});

test("scrapeUrl returns markdown content and handles failures", async () => {
  const mockCrawler = {
    scrapeUrl: async (url) => {
      if (url === "https://failing.com") {
        return { success: false, error: "404 Not Found" };
      }
      return {
        success: true,
        markdown: "# Live Page Content",
        metadata: { title: "Live Page", statusCode: 200 },
      };
    },
  };

  setCrawlerClient(mockCrawler);

  const res = await scrapeUrl("https://success.com");
  assert.equal(res.markdown, "# Live Page Content");
  assert.equal(res.metadata.title, "Live Page");

  await assert.rejects(
    async () => {
      await scrapeUrl("https://failing.com");
    },
    /404 Not Found/
  );

  setCrawlerClient(null);
});

test("evaluateExplorerStep prevents search action from prematurely declaring goal satisfied", async () => {
  setLLMClient(async (messages) => {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    if (userMsg.includes("Type: search")) {
      return {
        content: JSON.stringify({
          score: 0.95,
          relevance: "high",
          feedback: "Found relevant search links",
          goalSatisfied: true,
          suggestedNextSteps: ["Navigate to top link"],
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
        score: 0.85,
        relevance: "high",
        feedback: "High relevance content matches goal completely",
        goalSatisfied: true,
        suggestedNextSteps: [],
      }),
      tokensUsed: 60,
      promptTokens: 40,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 5,
    };
  });
  const searchEvaluation = await evaluateExplorerStep({
    goal: "Information foraging theory and cognitive scent",
    action: {
      type: "search",
      query: "Information foraging theory",
      reasoning: "Search for primary seeds",
    },
    observations: "Search results for query:\n[Result 1] https://example.com | Information foraging theory cognitive scent",
    stepNumber: 1,
    maxSteps: 5,
  });

  // A search result must NOT conclude goal is satisfied
  assert.equal(searchEvaluation.goalSatisfied, false);
  assert.ok(searchEvaluation.score <= 0.6);

  const navigateEvaluation = await evaluateExplorerStep({
    goal: "Information foraging theory and cognitive scent",
    action: {
      type: "navigate",
      url: "https://example.com",
      reasoning: "Inspect page content",
    },
    observations: "Document content from https://example.com: Information foraging theory explains how users seek information cues using cognitive scent gradients.",
    stepNumber: 2,
    maxSteps: 5,
  });

  // Navigating to relevant content CAN satisfy the goal
  assert.equal(navigateEvaluation.goalSatisfied, true);
  assert.ok(navigateEvaluation.score >= 0.7);

  const stepLimitEvaluation = await evaluateExplorerStep({
    goal: "Complex goal",
    action: {
      type: "search",
      query: "Complex goal",
      reasoning: "Searching",
    },
    observations: "None",
    stepNumber: 5,
    maxSteps: 5,
  });

  // Reaching maxSteps must NOT falsely force goalSatisfied: true when evidence is missing
  assert.equal(stepLimitEvaluation.goalSatisfied, false);
});

test("end-to-end mock trajectory transitions sequentially and collects evidence", async () => {
  setLLMClient(async (messages) => {
    const userMsg = messages.find((m) => m.role === "user")?.content || "";
    if (userMsg.includes("Target Research Goal") && userMsg.includes("Step 1 of maximum 4")) {
      return {
        content: JSON.stringify({
          score: 0.5,
          relevance: "medium",
          feedback: "Found candidate paper links",
          goalSatisfied: false,
          suggestedNextSteps: ["Navigate to https://arxiv.org/abs/2412.19437"],
        }),
        tokensUsed: 60,
        promptTokens: 40,
        completionTokens: 20,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    if (userMsg.includes("Target Research Goal") && userMsg.includes("Step 2 of maximum 4")) {
      return {
        content: JSON.stringify({
          score: 0.9,
          relevance: "high",
          feedback: "Technical report provides complete MLA architecture details",
          goalSatisfied: true,
          suggestedNextSteps: [],
        }),
        tokensUsed: 60,
        promptTokens: 40,
        completionTokens: 20,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    if (
      userMsg.includes("This is Step 1") ||
      userMsg.includes("Step 1.") ||
      userMsg.includes("Iteration: 1 of") ||
      userMsg.includes("Iteration 1.")
    ) {
      return {
        content: JSON.stringify({
          type: "search",
          query: "DeepSeek-V3 Multi-head Latent Attention architecture",
          reasoning: "Search for official technical report",
        }),
        tokensUsed: 70,
        promptTokens: 50,
        completionTokens: 20,
        model: "openai/gpt-oss-20b",
        provider: "groq",
        durationMs: 5,
      };
    }
    return {
      content: JSON.stringify({
        type: "navigate",
        url: "https://arxiv.org/abs/2412.19437",
        reasoning: "Navigate to technical report",
      }),
      tokensUsed: 70,
      promptTokens: 50,
      completionTokens: 20,
      model: "openai/gpt-oss-20b",
      provider: "groq",
      durationMs: 5,
    };
  });
  const mockCrawler = {
    search: async (query) => ({
      success: true,
      data: [
        {
          url: "https://arxiv.org/abs/2412.19437",
          metadata: {
            title: "DeepSeek-V3 Technical Report",
            description: "DeepSeek-V3 architecture with Multi-head Latent Attention",
          },
        },
      ],
    }),
    scrapeUrl: async (url) => ({
      success: true,
      markdown: "DeepSeek-V3 is an open-source MoE model utilizing Multi-head Latent Attention (MLA).",
      metadata: {
        title: "DeepSeek-V3 Technical Report",
        statusCode: 200,
      },
    }),
  };

  setCrawlerClient(mockCrawler);

  const goal = "DeepSeek-V3 Multi-head Latent Attention architecture";
  const steps = [];
  const retrievedSources = new Set();
  const maxSteps = 4;
  let isFinished = false;
  let currentUrl;

  for (let i = 1; i <= maxSteps && !isFinished; i++) {
    const lastObs = steps.length > 0 ? steps[steps.length - 1]?.observations : undefined;

    const action = await executeExplorerStep({
      goal,
      trajectoryHistory: steps,
      currentObservation: lastObs,
      currentUrl,
    });

    if (action.url) {
      currentUrl = action.url;
    }

    let obs = "";
    if (action.type === "search") {
      const results = await searchWeb(action.query || goal);
      obs = results.map((r, idx) => `[Result ${idx + 1}] ${r.url} | ${r.title}: ${r.description}`).join("\n");
    } else if (action.type === "navigate") {
      const res = await scrapeUrl(action.url);
      if (res.markdown) {
        retrievedSources.add(action.url);
        obs = `Document content: ${res.markdown}`;
      }
    } else if (action.type === "extract") {
      obs = `Extracted claim: ${action.extractedContent}`;
    } else {
      obs = "Traversal complete.";
    }

    const evaluation = await evaluateExplorerStep({
      goal,
      action,
      observations: obs,
      stepNumber: i,
      maxSteps,
    });

    steps.push({
      stepNumber: i,
      timestamp: new Date().toISOString(),
      action,
      evaluation,
      observations: obs,
      tokensUsed: 0,
    });

    if (action.type === "finish" || evaluation.goalSatisfied) {
      isFinished = true;
    }
  }

  // Must have taken 2 or 3 steps (search -> navigate -> extract/finish)
  assert.ok(steps.length >= 2, `Expected steps >= 2, got ${steps.length}`);
  assert.equal(steps[0].action.type, "search");
  assert.equal(steps[1].action.type, "navigate");
  assert.equal(steps[1].action.url, "https://arxiv.org/abs/2412.19437");
  assert.deepEqual(Array.from(retrievedSources), ["https://arxiv.org/abs/2412.19437"]);

  setCrawlerClient(null);
});
