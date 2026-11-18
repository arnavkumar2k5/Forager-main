import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { ScoutLockManager } from "../src/locks.ts";

test("1. ScoutLockManager acquires and releases distributed locks", async () => {
  const manager = new ScoutLockManager();
  const scoutId = crypto.randomUUID();

  assert.equal(await manager.isLocked(scoutId), false);
  assert.equal(await manager.acquire(scoutId, "manual"), true);
  assert.equal(await manager.isLocked(scoutId), true);

  assert.equal(await manager.acquire(scoutId, "scheduled"), false);

  const active = await manager.getActiveLocks();
  assert.equal(active.length, 1);
  assert.equal(active[0].scoutId, scoutId);
  assert.equal(active[0].source, "manual");

  await manager.release(scoutId);
  assert.equal(await manager.isLocked(scoutId), false);
  assert.equal((await manager.getActiveLocks()).length, 0);

  assert.equal(await manager.acquire(scoutId, "scheduled"), true);
  assert.equal(await manager.isLocked(scoutId), true);

  await manager.disconnect();
});

test("2. ScoutLockManager clear wipes all active locks", async () => {
  const manager = new ScoutLockManager();
  const id1 = crypto.randomUUID();
  const id2 = crypto.randomUUID();

  await manager.acquire(id1, "manual");
  await manager.acquire(id2, "scheduled");
  assert.equal((await manager.getActiveLocks()).length, 2);

  await manager.clear();
  assert.equal((await manager.getActiveLocks()).length, 0);
  assert.equal(await manager.isLocked(id1), false);
  assert.equal(await manager.isLocked(id2), false);

  await manager.disconnect();
});
