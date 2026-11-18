import test from "node:test";
import assert from "node:assert/strict";
import { canonicalizeUrl, extractDirectUrls } from "../src/normalization/url.ts";
import { classifyScoutIntent } from "../src/explore-critic/intent.ts";
import { detectBotChallenge } from "../src/explore-critic/anti-bot.ts";
import { evaluateExplorerStep } from "../src/explore-critic/critic.ts";
import { executeExplorerStep } from "../src/explore-critic/explorer.ts";

test("canonicalizeUrl strips tracking query params and fragments", () => {
  const dirty = "https://example.com/blog/article/?utm_source=twitter&utm_medium=social&fbclid=123#comments";
  const clean = canonicalizeUrl(dirty);
  assert.equal(clean, "https://example.com/blog/article");
});

test("canonicalizeUrl canonicalizes dirty Amazon product URLs to canonical /dp/ASIN", () => {
  const dirtyAmazon1 = "https://www.amazon.in/gp/aw/d/B09G9FPHY6?ref_=Oct_DLandingS_D_12345&pd_rd_w=xyz&utm_source=google";
  assert.equal(canonicalizeUrl(dirtyAmazon1), "https://www.amazon.in/dp/B09G9FPHY6");

  const dirtyAmazon2 = "https://www.amazon.com/Apple-iPhone-13-128GB-Blue/dp/B09G9FPHY6/ref=sr_1_1?qid=123&sr=8-1";
  assert.equal(canonicalizeUrl(dirtyAmazon2), "https://www.amazon.com/dp/B09G9FPHY6");

  const dirtyAmazon3 = "https://amazon.co.uk/gp/product/B09G9FPHY6";
  assert.equal(canonicalizeUrl(dirtyAmazon3), "https://www.amazon.co.uk/dp/B09G9FPHY6");
});

test("canonicalizeUrl canonicalizes Flipkart product URLs", () => {
  const dirtyFlipkart = "https://www.flipkart.com/apple-iphone-15/p/itm12345?pid=MOB123&marketplace=FLIPKART&lid=LST123";
  assert.equal(canonicalizeUrl(dirtyFlipkart), "https://www.flipkart.com/apple-iphone-15/p/itm12345");
});

test("extractDirectUrls extracts and canonicalizes links from conversational text", () => {
  const prompt = "Please track https://www.amazon.in/gp/aw/d/B09G9FPHY6?ref_=123 and also check https://example.com/site/?utm_source=test.";
  const urls = extractDirectUrls(prompt);
  assert.equal(urls.length, 2);
  assert.equal(urls[0], "https://www.amazon.in/dp/B09G9FPHY6");
  assert.equal(urls[1], "https://example.com/site");
});

test("classifyScoutIntent correctly identifies missionMode and baseline status", () => {
  const landscapeIntent = classifyScoutIntent({
    query: "upcoming AI developer hackathons 2026",
    historicalCount: 0,
  });
  assert.equal(landscapeIntent.missionMode, "landscape_discovery");
  assert.equal(landscapeIntent.isBaseline, true);

  const deltaIntent = classifyScoutIntent({
    query: "upcoming AI developer hackathons 2026",
    historicalCount: 8,
  });
  assert.equal(deltaIntent.missionMode, "landscape_discovery");
  assert.equal(deltaIntent.isBaseline, false);

  const priceIntent = classifyScoutIntent({
    query: "monitor price drop of Sony WH-1000XM5 on Amazon",
    historicalCount: 0,
  });
  assert.equal(priceIntent.missionMode, "metric_delta");
  assert.equal(priceIntent.isMetricTracking, true);
  assert.equal(priceIntent.isBaseline, true);
});

test("detectBotChallenge catches Amazon robot check, Cloudflare, and 403 blocks", () => {
  const amazonCheck = detectBotChallenge({
    title: "Amazon.com",
    content: "To discuss automated access to Amazon data please contact api-services-support@amazon.com",
  });
  assert.equal(amazonCheck.isBlocked, true);
  assert.equal(amazonCheck.provider, "amazon");

  const cloudflareCheck = detectBotChallenge({
    title: "Just a moment...",
    content: "Attention Required! | Cloudflare. Please complete the security check to access the website.",
  });
  assert.equal(cloudflareCheck.isBlocked, true);
  assert.equal(cloudflareCheck.provider, "cloudflare");

  const genericCheck = detectBotChallenge({
    title: "403 Forbidden",
    content: "Access Denied: You do not have permission to access this server.",
  });
  assert.equal(genericCheck.isBlocked, true);
  assert.equal(genericCheck.provider, "generic");

  const normalCheck = detectBotChallenge({
    title: "Tech Conferences 2026",
    content: "Welcome to the 2026 Developer Summit schedule. Keynotes and registration open now.",
  });
  assert.equal(normalCheck.isBlocked, false);
});

test("Critic evaluateExplorerStep penalizes bot challenge and suggests search pivot", async () => {
  const evaluation = await evaluateExplorerStep({
    goal: "Find price of Sony headphones",
    action: {
      type: "navigate",
      url: "https://www.amazon.com/dp/B09XS7JWHH",
      reasoning: "Inspect product page",
    },
    observations: "Robot Check: Enter the characters you see below. To discuss automated access to Amazon data please contact api-services-support@amazon.com",
    stepNumber: 1,
    maxSteps: 5,
  });

  assert.equal(evaluation.goalSatisfied, false);
  assert.ok(evaluation.score <= 0.2);
  assert.equal(evaluation.relevance, "low");
  assert.ok(
    evaluation.suggestedNextSteps.some((step) => step.toLowerCase().includes("anti-bot")),
    "Should suggest pivoting away from anti-bot blocked domain"
  );
});

test("Explorer executeExplorerStep intercepts blocked domain and pivots to search", async () => {
  const blockedDomain = "amazon.com";
  const action = await executeExplorerStep({
    goal: "Find price of Sony headphones",
    trajectoryHistory: [
      {
        stepNumber: 1,
        timestamp: new Date().toISOString(),
        action: {
          type: "navigate",
          url: "https://www.amazon.com/dp/B09XS7JWHH",
          reasoning: "Navigate to product",
        },
        observations: "Robot Check: Enter characters below. Automated access restricted.",
        evaluation: {
          score: 0.1,
          relevance: "low",
          feedback: "Target domain blocked by anti-bot challenge",
          goalSatisfied: false,
          suggestedNextSteps: ["Domain blocked by anti-bot challenge. Do not retry this domain."],
        },
      },
    ],
    currentObservation: "Robot Check: Automated access restricted.",
    currentUrl: "https://www.amazon.com/dp/B09XS7JWHH",
    blockedDomains: [blockedDomain],
    maxSteps: 5,
  });

  assert.equal(action.type, "search");
  assert.ok(action.query && action.query.length > 0);
  assert.ok(
    action.reasoning.toLowerCase().includes("anti-bot") ||
      action.reasoning.toLowerCase().includes("blocked") ||
      action.reasoning.toLowerCase().includes("pivot")
  );
});
