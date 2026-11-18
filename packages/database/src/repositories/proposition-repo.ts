import { SupabaseClient } from "@supabase/supabase-js";
import { Proposition } from "@repo/types";
import { matchPropositions, SimilarProposition } from "../vector";

export class PropositionRepository {
  constructor(private client: SupabaseClient) {}

  async savePropositions(propositions: Proposition[]): Promise<void> {
    if (propositions.length === 0) return;
    const rows = propositions.map((p) => ({
      id: p.id,
      scout_id: p.scoutId,
      execution_id: p.executionId ?? null,
      content: p.content,
      source_url: p.sourceUrl,
      dom_selector: p.domSelector ?? null,
      confidence: typeof p.confidence === "number" ? p.confidence : 1.0,
      embedding: p.embedding ?? null,
      status: p.status || "active",
      created_at: p.createdAt || new Date().toISOString(),
    }));

    const { error } = await this.client.from("propositions").insert(rows);

    if (error) {
      throw new Error(`Failed to save propositions: ${error.message}`);
    }
  }

  async saveProposition(proposition: Proposition): Promise<void> {
    await this.savePropositions([proposition]);
  }

  async updatePropositionStatus(
    id: string,
    status: "active" | "deprecated" | "contradicted"
  ): Promise<void> {
    const { error } = await this.client
      .from("propositions")
      .update({ status })
      .eq("id", id);

    if (error) {
      throw new Error(`Failed to update proposition status: ${error.message}`);
    }
  }

  async findByScoutId(scoutId: string): Promise<Proposition[]> {
    const { data, error } = await this.client
      .from("propositions")
      .select("*")
      .eq("scout_id", scoutId)
      .eq("status", "active")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to fetch propositions for scout ${scoutId}: ${error.message}`);
    }

    return (data || []).map((row) => ({
      id: row.id,
      scoutId: row.scout_id,
      executionId: row.execution_id || undefined,
      content: row.content,
      sourceUrl: row.source_url,
      domSelector: row.dom_selector || undefined,
      confidence: typeof row.confidence === "number" ? row.confidence : 1.0,
      embedding: Array.isArray(row.embedding)
        ? row.embedding
        : typeof row.embedding === "string"
        ? JSON.parse(row.embedding)
        : undefined,
      status: (row.status as Proposition["status"]) || "active",
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
    }));
  }

  async matchSimilarPropositions(
    queryEmbedding: number[],
    options?: {
      matchThreshold?: number;
      matchCount?: number;
      scoutId?: string;
    }
  ): Promise<SimilarProposition[]> {
    return matchPropositions(
      this.client,
      queryEmbedding,
      options?.matchThreshold,
      options?.matchCount,
      options?.scoutId
    );
  }
}
