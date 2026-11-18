import { SupabaseClient } from "@supabase/supabase-js";

export const EXPECTED_VECTOR_DIM = 1024;

export interface SimilarProposition {
  id: string;
  scoutId: string;
  content: string;
  similarity: number;
}

export function validateVector(vec: unknown, expectedDim = EXPECTED_VECTOR_DIM): number[] {
  if (!Array.isArray(vec)) {
    throw new Error(`Invalid query vector: expected array, got ${typeof vec}`);
  }
  if (vec.length !== expectedDim) {
    throw new Error(
      `Query vector dimension mismatch: expected ${expectedDim}, got ${vec.length}`
    );
  }
  for (let i = 0; i < vec.length; i++) {
    const val = vec[i];
    if (typeof val !== "number" || !Number.isFinite(val)) {
      throw new Error(`Invalid vector value at index ${i}: expected finite number, got ${val}`);
    }
  }
  return vec;
}

export async function matchPropositions(
  client: SupabaseClient,
  queryEmbedding: number[],
  matchThreshold = 0.78,
  matchCount = 10,
  scoutId?: string
): Promise<SimilarProposition[]> {
  validateVector(queryEmbedding, EXPECTED_VECTOR_DIM);

  const rpcParams: Record<string, unknown> = {
    query_embedding: queryEmbedding,
    match_threshold: matchThreshold,
    match_count: matchCount,
  };

  if (scoutId) {
    rpcParams.filter_scout_id = scoutId;
  }

  const { data, error } = await client.rpc("match_propositions", rpcParams);

  if (error) {
    throw new Error(`Failed to match propositions via RPC: ${error.message}`);
  }

  return (data as SimilarProposition[]) || [];
}
