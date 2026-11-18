import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { PropositionRepository } from "../src/repositories/proposition-repo.ts";
import { PropositionSchema } from "../../types/src/proposition.ts";

test("PropositionRepository.findByScoutId maps nullable database fields to valid Proposition shape", async () => {
  const scoutId = crypto.randomUUID();
  const propId = crypto.randomUUID();

  // Mock Supabase client returning raw postgres row with nulls and Date object
  const mockClient = {
    from: (table) => {
      assert.equal(table, "propositions");
      return {
        select: (cols) => ({
          eq: (col1, val1) => ({
            eq: async (col2, val2) => {
              assert.equal(col1, "scout_id");
              assert.equal(val1, scoutId);
              assert.equal(col2, "status");
              assert.equal(val2, "active");
              return {
                data: [
                  {
                    id: propId,
                    scout_id: scoutId,
                    execution_id: null, // Null in DB
                    content: "PostgreSQL handles ACID compliant transactions.",
                    source_url: "https://www.postgresql.org/about/",
                    dom_selector: null, // Null in DB
                    confidence: 0.95,
                    embedding: "[0.12, 0.34, 0.56]", // JSON string from vector driver
                    status: "active",
                    created_at: new Date("2026-10-22T10:00:00.000Z"), // Date object from driver
                  },
                ],
                error: null,
              };
            },
          }),
        }),
      };
    },
  };

  const repo = new PropositionRepository(mockClient);
  const propositions = await repo.findByScoutId(scoutId);

  assert.equal(propositions.length, 1);
  const p = propositions[0];

  assert.equal(p.id, propId);
  assert.equal(p.scoutId, scoutId);
  assert.equal(p.executionId, undefined);
  assert.equal(p.domSelector, undefined);
  assert.equal(p.content, "PostgreSQL handles ACID compliant transactions.");
  assert.equal(p.sourceUrl, "https://www.postgresql.org/about/");
  assert.equal(p.confidence, 0.95);
  assert.deepEqual(p.embedding, [0.12, 0.34, 0.56]);
  assert.equal(p.status, "active");
  assert.equal(p.createdAt, "2026-10-22T10:00:00.000Z");

  // Verify that the mapped proposition strictly parses through the universal Zod contract
  const validated = PropositionSchema.parse(p);
  assert.equal(validated.id, propId);
});

test("PropositionRepository.findByScoutId throws descriptive error on database failure", async () => {
  const scoutId = crypto.randomUUID();

  const failingClient = {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: async () => ({
            data: null,
            error: { message: "Connection terminated unexpectedly" },
          }),
        }),
      }),
    }),
  };

  const repo = new PropositionRepository(failingClient);
  await assert.rejects(
    async () => {
      await repo.findByScoutId(scoutId);
    },
    /Failed to fetch propositions for scout.*Connection terminated/
  );
});


test("PropositionRepository.savePropositions maps Proposition shape with null normalization", async () => {
  const scoutId = crypto.randomUUID();
  const propId = crypto.randomUUID();
  let insertedRows = null;

  const mockClient = {
    from: (table) => {
      assert.equal(table, "propositions");
      return {
        insert: async (rows) => {
          insertedRows = rows;
          return { error: null };
        },
      };
    },
  };

  const repo = new PropositionRepository(mockClient);
  const prop = {
    id: propId,
    scoutId,
    content: "Raft leader election is randomized.",
    sourceUrl: "https://raft.github.io/",
    confidence: 0.92,
    status: "active",
    createdAt: "2026-10-22T10:00:00.000Z",
  };

  await repo.savePropositions([prop]);

  assert.ok(Array.isArray(insertedRows));
  assert.equal(insertedRows.length, 1);
  const row = insertedRows[0];
  assert.equal(row.id, propId);
  assert.equal(row.scout_id, scoutId);
  assert.equal(row.execution_id, null);
  assert.equal(row.dom_selector, null);
  assert.equal(row.embedding, null);
  assert.equal(row.content, "Raft leader election is randomized.");
  assert.equal(row.source_url, "https://raft.github.io/");
  assert.equal(row.confidence, 0.92);
  assert.equal(row.status, "active");
});

test("PropositionRepository.saveProposition propagates error on insert failure", async () => {
  const failingClient = {
    from: () => ({
      insert: async () => ({
        error: { message: "violates foreign key constraint propositions_scout_id_scouts_id_fk" },
      }),
    }),
  };

  const repo = new PropositionRepository(failingClient);
  await assert.rejects(
    async () => {
      await repo.saveProposition({
        id: crypto.randomUUID(),
        scoutId: crypto.randomUUID(),
        content: "Test proposition",
        sourceUrl: "https://example.com",
        confidence: 0.9,
        status: "active",
        createdAt: new Date().toISOString(),
      });
    },
    /Failed to save propositions:.*violates foreign key constraint/
  );
});
