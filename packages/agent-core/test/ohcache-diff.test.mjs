import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { extractAtomicPropositionsFromText } from "../src/ohcache/propositions.ts";
import { computePropositionDiff } from "../src/ohcache/diff.ts";

test("extractAtomicPropositionsFromText generates valid unique UUIDs", () => {
  const text = "DeepSeek-V3 is an open source MoE model. It was trained on 14.8 trillion tokens.";
  const scoutId = crypto.randomUUID();
  const propositions = extractAtomicPropositionsFromText(text, "https://example.com", scoutId);

  assert.equal(propositions.length, 2);
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  assert.match(propositions[0].id, uuidRegex);
  assert.match(propositions[1].id, uuidRegex);
  assert.notEqual(propositions[0].id, propositions[1].id);
});

test("extractAtomicPropositionsFromText preserves concise facts between 20 and 400 characters", () => {
  const text = "Hi. Menu. Q3 revenue grew 42%. CEO John Doe resigned. This is a standard longer research proposition about the architecture of large language models.";
  const scoutId = crypto.randomUUID();
  const propositions = extractAtomicPropositionsFromText(text, "https://example.com", scoutId);

  // "Hi." (3) and "Menu." (5) must be discarded (< 20)
  // "Q3 revenue grew 42%." (20) and "CEO John Doe resigned." (22) must be preserved
  const contents = propositions.map((p) => p.content);
  assert.ok(contents.includes("Q3 revenue grew 42%."), "Should preserve concise 20-char fact");
  assert.ok(contents.includes("CEO John Doe resigned."), "Should preserve concise 22-char fact");
  assert.ok(!contents.includes("Hi."));
  assert.ok(!contents.includes("Menu."));
});

test("computePropositionDiff handles empty-history case", async () => {
  const scoutId = crypto.randomUUID();
  const candidates = [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Firecrawl extracts markdown from dynamic web pages.",
      sourceUrl: "https://example.com",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const result = await computePropositionDiff(candidates, []);
  assert.equal(result.novelCount, 1);
  assert.equal(result.redundantCount, 0);
  assert.equal(result.contradictionCount, 0);
  assert.equal(result.items[0].diffType, "novel");
  assert.equal(result.driftScore, 1.0);
});

test("computePropositionDiff detects redundant factual claims", async () => {
  const scoutId = crypto.randomUUID();
  const histId = crypto.randomUUID();
  const historical = [
    {
      id: histId,
      scoutId,
      content: "DeepSeek-V3 architecture utilizes Multi-head Latent Attention with 671B parameters.",
      sourceUrl: "https://example.com/v1",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const candidates = [
    {
      id: crypto.randomUUID(),
      scoutId,
      // Identical or near-identical wording
      content: "DeepSeek-V3 architecture utilizes Multi-head Latent Attention with 671B parameters.",
      sourceUrl: "https://example.com/v2",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const result = await computePropositionDiff(candidates, historical);
  assert.equal(result.redundantCount, 1);
  assert.equal(result.novelCount, 0);
  assert.equal(result.contradictionCount, 0);
  assert.equal(result.items[0].diffType, "redundant");
  assert.equal(result.items[0].nearestPropositionId, histId);
  assert.ok(result.items[0].similarityToNearest >= 0.85);
  assert.equal(result.driftScore, 0);
});

test("computePropositionDiff detects contradiction signals with negations", async () => {
  const scoutId = crypto.randomUUID();
  const histId = crypto.randomUUID();
  const historical = [
    {
      id: histId,
      scoutId,
      content: "Acme Corporation will acquire WidgetTech for ten billion dollars.",
      sourceUrl: "https://example.com/news1",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const candidates = [
    {
      id: crypto.randomUUID(),
      scoutId,
      // High word overlap + negation word ("cancelled")
      content: "Acme Corporation cancelled acquisition of WidgetTech for ten billion dollars.",
      sourceUrl: "https://example.com/news2",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const result = await computePropositionDiff(candidates, historical);
  assert.equal(result.contradictionCount, 1);
  assert.equal(result.items[0].diffType, "contradiction");
  assert.equal(result.items[0].nearestPropositionId, histId);
  assert.ok(result.driftScore > 0);
});

test("computePropositionDiff classifies distinct new claim as novel", async () => {
  const scoutId = crypto.randomUUID();
  const historical = [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "The weather in Seattle is rainy in November.",
      sourceUrl: "https://example.com/weather",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const candidates = [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Quantum computing utilizes superposition and entanglement for computation.",
      sourceUrl: "https://example.com/quantum",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const result = await computePropositionDiff(candidates, historical);
  assert.equal(result.novelCount, 1);
  assert.equal(result.redundantCount, 0);
  assert.equal(result.contradictionCount, 0);
  assert.equal(result.items[0].diffType, "novel");
  assert.equal(result.driftScore, 1.0);
});

test("extractAtomicPropositionsFromText extracts unpunctuated markdown lists and deduplicates identically", async () => {
  const markdownText = `Series C & Venture Rounds
LangChain: Nov 13, 2026 | $300M · Series C
Lead Investor: CapitalG
Nooks: Nov 4, 2026 | $500M · Venture
Lead Investor: General Catalyst
Seed Rounds
Machenta: Oct 27, 2026 | $40M · Seed
Lead Investor: Creandum`;

  const scoutId = crypto.randomUUID();
  const run1Props = extractAtomicPropositionsFromText(markdownText, "https://startups.gallery", scoutId, "exec-1");
  assert.equal(run1Props.length, 3);
  assert.ok(run1Props[0].content.includes("LangChain"));
  assert.ok(run1Props[0].content.includes("CapitalG"));

  const run2Props = extractAtomicPropositionsFromText(markdownText, "https://startups.gallery", scoutId, "exec-2");
  const diffResult = await computePropositionDiff(run2Props, run1Props);
  assert.equal(diffResult.novelCount, 0);
  assert.equal(diffResult.redundantCount, 3);
  assert.equal(diffResult.driftScore, 0);
});

test("computePropositionDiff correctly recognizes existing models as unchanged or status shifts, not novel", async () => {
  const scoutId = crypto.randomUUID();

  // Baseline from Run 1
  const historical = [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Google Veo 3.1 Lite: Starting from $0.05 per second at 720p with audio support.",
      sourceUrl: "https://openrouter.ai",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Seedance 2.5: Priced per video token; featured for clips up to 30 seconds.",
      sourceUrl: "https://openrouter.ai",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Vidu: Standard plan is $10/month with 800 credits.",
      sourceUrl: "https://camclo3d.com",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  // Candidates from Run 2
  const candidates = [
    // 1. Google Veo with exact same price ($0.05/sec) -> must be redundant/corroborated
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Google Veo 3.1 Lite: Starts at $0.05 per second at 720p.",
      sourceUrl: "https://another-source.com",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    // 2. Seedance with a new variant/rate ($0.031/video) -> must be status shift/update, NOT novel
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Seedance 1.0 Pro Fast: $0.031 per video for 5s clips.",
      sourceUrl: "https://runware.ai",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    // 3. Vidu with a new API rate ($0.138/video) -> must be status shift/update, NOT novel
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Vidu Q2 Turbo: $0.138 per video at 720p.",
      sourceUrl: "https://runware.ai",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    // 4. PixVerse is genuinely new -> must be novel
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "PixVerse V5.6: $0.354 per video at 1080p.",
      sourceUrl: "https://runware.ai",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  const diffResult = await computePropositionDiff(candidates, historical);

  // Assertions:
  // Google Veo is redundant (corroborated)
  assert.equal(diffResult.items[0].diffType, "redundant", "Google Veo should be redundant/corroborated");

  // Seedance & Vidu variants are updates/shifts, NOT novel
  assert.equal(diffResult.items[1].diffType, "contradiction", "Seedance variant should be classified as updated/status shift");
  assert.equal(diffResult.items[2].diffType, "contradiction", "Vidu variant should be classified as updated/status shift");

  // PixVerse is genuinely novel
  assert.equal(diffResult.items[3].diffType, "novel", "PixVerse should be classified as novel discovery");

  assert.equal(diffResult.novelCount, 1, "Only 1 genuinely new model should be novel");
  assert.equal(diffResult.redundantCount, 1, "1 model should be corroborated");
  assert.equal(diffResult.contradictionCount, 2, "2 models should be status shifts/updates");
});
