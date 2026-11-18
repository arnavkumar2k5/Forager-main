import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { sendNotification } from "../src/services/notifications.ts";
import {
  getNotificationsSafe,
  markNotificationReadSafe,
} from "../src/persistence/notifications.ts";
import { computePropositionDiff } from "../../../packages/agent-core/src/ohcache/diff.ts";

test("sendNotification creates, logs, and retrieves scout notifications", async () => {
  const scoutId = crypto.randomUUID();
  const executionId = crypto.randomUUID();

  const notif = await sendNotification({
    scoutId,
    executionId,
    title: "Price Drop Alert",
    message: "Sony WH-1000XM5 price dropped from $398 to $298.",
    urgency: "high",
  });

  assert.equal(notif.scoutId, scoutId);
  assert.equal(notif.executionId, executionId);
  assert.equal(notif.urgency, "high");
  assert.equal(notif.read, false);

  const { notifications } = await getNotificationsSafe(scoutId);
  assert.ok(notifications.length >= 1);
  const matched = notifications.find((n) => n.id === notif.id);
  assert.ok(matched);
  assert.equal(matched?.title, "Price Drop Alert");

  await markNotificationReadSafe(notif.id);
  const { notifications: updatedNotifs } = await getNotificationsSafe(scoutId);
  const updatedMatched = updatedNotifs.find((n) => n.id === notif.id);
  assert.equal(updatedMatched?.read, true);
});

test("computePropositionDiff categorizes novel vs updated vs redundant propositions", async () => {
  const scoutId = crypto.randomUUID();
  const baselineProps = [
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "The Global AI Hackathon takes place on October 12, 2026 in San Francisco.",
      sourceUrl: "https://example.com/ai-hack",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    },
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Registration fee for Developer Summit is $199 with early bird discounts.",
      sourceUrl: "https://example.com/dev-summit",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    },
  ];

  const run2Props = [
    // Corroborated redundant
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "The Global AI Hackathon takes place on October 12, 2026 in San Francisco.",
      sourceUrl: "https://example.com/ai-hack",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    },
    // Contradiction / status update (negation/cancellation)
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "Registration fee for Developer Summit is cancelled and no longer active.",
      sourceUrl: "https://example.com/dev-summit",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    },
    // Novel new event
    {
      id: crypto.randomUUID(),
      scoutId,
      content: "NeurIPS 2026 call for papers deadline is set for May 15, 2026.",
      sourceUrl: "https://neurips.cc/2026",
      confidence: 1.0,
      createdAt: new Date().toISOString(),
    },
  ];

  const diff = await computePropositionDiff(run2Props, baselineProps);

  assert.equal(diff.redundantCount, 1);
  assert.equal(diff.contradictionCount, 1);
  assert.equal(diff.novelCount, 1);
  assert.ok(diff.driftScore > 0);

  const novelItem = diff.items.find((i) => i.diffType === "novel");
  assert.ok(novelItem);
  assert.ok(novelItem.proposition.content.includes("NeurIPS 2026"));

  const contradictionItem = diff.items.find((i) => i.diffType === "contradiction");
  assert.ok(contradictionItem);
  assert.ok(contradictionItem.proposition.content.includes("cancelled"));
});
