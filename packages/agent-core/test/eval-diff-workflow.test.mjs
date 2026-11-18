import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { extractAtomicPropositionsFromText } from "../src/ohcache/propositions.ts";
import { computePropositionDiff } from "../src/ohcache/diff.ts";

test("OHCache diffing correctly integrates repository output with candidates", async () => {
  const scoutId = crypto.randomUUID();
  const histPropId = crypto.randomUUID();

  // Simulating repository findByScoutId output
  const historicalPropositions = [
    {
      id: histPropId,
      scoutId,
      content: "Firecrawl converts websites into LLM-ready markdown format.",
      sourceUrl: "https://www.firecrawl.dev",
      confidence: 1.0,
      status: "active",
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Acme Corporation will acquire BetaLabs for five hundred million dollars.",
      sourceUrl: "https://news.example.com/item1",
      confidence: 0.95,
      status: "active",
      createdAt: new Date().toISOString(),
    },
  ];

  // Candidates extracted from newly scraped webpage
  const newRawText =
    "Firecrawl converts websites into LLM-ready markdown format. Acme Corporation cancelled acquisition of BetaLabs for five hundred million dollars. Novel research findings were unveiled today.";

  const candidates = extractAtomicPropositionsFromText(
    newRawText,
    "https://news.example.com/item2",
    scoutId
  );

  assert.equal(candidates.length, 3);

  const diffResult = await computePropositionDiff(
    candidates,
    historicalPropositions,
    0.85
  );

  assert.equal(diffResult.redundantCount, 1);
  assert.equal(diffResult.contradictionCount, 1);
  assert.equal(diffResult.novelCount, 1);

  // Redundant match links to historical ID
  const redundantItem = diffResult.items.find((i) => i.diffType === "redundant");
  assert.equal(redundantItem.nearestPropositionId, histPropId);

  // Contradiction match flags negation
  const contradictionItem = diffResult.items.find((i) => i.diffType === "contradiction");
  assert.ok(contradictionItem.explanation.includes("negation or alteration"));

  // Novel item
  const novelItem = diffResult.items.find((i) => i.diffType === "novel");
  assert.ok(novelItem.proposition.content.includes("Novel research findings"));
});
