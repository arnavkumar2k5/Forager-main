import { Proposition } from "@repo/types";
import { env } from "@repo/config-env";
import { getServiceClient, PropositionRepository } from "@repo/database";
import { server } from "../server";
import { getPropositionRepoOverride } from "./overrides";
import {
  inMemoryPropositionStore,
  storeInMemoryPropositions,
} from "./memory-stores";

export async function getHistoricalPropositions(
  scoutId: string
): Promise<{ propositions: Proposition[]; source: "database" | "in_memory_fallback"; warning?: string }> {
  const repoOverride = getPropositionRepoOverride();
  if (repoOverride) {
    try {
      const records = await repoOverride.findByScoutId(scoutId);
      return { propositions: records, source: "database" };
    } catch (err) {
      server.log.warn({ err, scoutId }, "Overridden repository findByScoutId failed; using in-memory fallback");
      return {
        propositions: inMemoryPropositionStore.get(scoutId) || [],
        source: "in_memory_fallback",
        warning: `Database unavailable (${(err as Error).message}); operated with in-memory historical state.`,
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      propositions: inMemoryPropositionStore.get(scoutId) || [],
      source: "in_memory_fallback",
      warning: "Database credentials unconfigured; operated with in-memory historical state.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new PropositionRepository(client);
    const records = await repo.findByScoutId(scoutId);
    return { propositions: records, source: "database" };
  } catch (err) {
    server.log.warn({ err, scoutId }, "Database query failed; falling back to in-memory historical state");
    return {
      propositions: inMemoryPropositionStore.get(scoutId) || [],
      source: "in_memory_fallback",
      warning: `Database unavailable (${(err as Error).message}); operated with in-memory historical state.`,
    };
  }
}

export async function savePropositionsSafe(
  scoutId: string,
  propositions: Proposition[]
): Promise<{ persistedCount: number; warning?: string }> {
  const seenIds = new Set<string>();
  const seenContents = new Set<string>();
  const uniquePropositions: Proposition[] = [];
  for (const p of propositions) {
    const norm = p.content.trim().toLowerCase();
    if (!seenIds.has(p.id) && !seenContents.has(norm)) {
      seenIds.add(p.id);
      seenContents.add(norm);
      uniquePropositions.push(p);
    }
  }

  storeInMemoryPropositions(scoutId, uniquePropositions);

  if (uniquePropositions.length === 0) {
    return { persistedCount: 0 };
  }

  const repoOverride = getPropositionRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.savePropositions(uniquePropositions);
      return { persistedCount: uniquePropositions.length };
    } catch (err) {
      server.log.warn({ err, scoutId }, "Overridden proposition repository savePropositions failed");
      return {
        persistedCount: 0,
        warning: `Database persistence failed (${(err as Error).message}); propositions saved to in-memory store only.`,
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      persistedCount: 0,
      warning: "Database unconfigured; propositions retained in in-memory store.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new PropositionRepository(client);
    await repo.savePropositions(uniquePropositions);
    return { persistedCount: uniquePropositions.length };
  } catch (err) {
    server.log.warn({ err, scoutId }, "Proposition repository savePropositions failed; failing open");
    return {
      persistedCount: 0,
      warning: `Database persistence failed (${(err as Error).message}); propositions saved to in-memory store only.`,
    };
  }
}

export async function updatePropositionStatusSafe(
  id: string,
  status: "active" | "deprecated" | "contradicted"
): Promise<{ success: boolean; warning?: string }> {
  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return { success: false, warning: "Database unconfigured" };
  }

  try {
    const client = getServiceClient();
    const repo = new PropositionRepository(client);
    await repo.updatePropositionStatus(id, status);
    return { success: true };
  } catch (err) {
    server.log.warn({ err, id }, "Proposition repository updatePropositionStatus failed; failing open");
    return { success: false, warning: (err as Error).message };
  }
}


