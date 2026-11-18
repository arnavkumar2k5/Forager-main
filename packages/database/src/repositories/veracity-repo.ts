import { SupabaseClient } from "@supabase/supabase-js";

export interface InsertVeracityAuditParams {
  id?: string;
  scoutId?: string | null;
  executionId?: string | null;
  claim: string;
  overallConfidence: number;
  independentSourcesCount: number;
  citations: Array<{
    url?: string;
    domain?: string;
    anchorSnippet?: string;
    domMatched?: boolean;
    veracityScore?: number;
    notes?: string;
  }>;
  hasContradiction?: boolean;
  contradictionDetails?: string | null;
  auditPassed: boolean;
  createdAt?: string;
}

export class VeracityRepository {
  constructor(private client: SupabaseClient) {}

  async saveAudits(audits: InsertVeracityAuditParams[]): Promise<void> {
    if (audits.length === 0) return;

    const rows = audits.map((a) => ({
      id: a.id,
      scout_id: a.scoutId ?? null,
      execution_id: a.executionId ?? null,
      claim: a.claim,
      overall_confidence: a.overallConfidence,
      independent_sources_count: a.independentSourcesCount,
      citations: a.citations,
      has_contradiction: Boolean(a.hasContradiction),
      contradiction_details: a.contradictionDetails ?? null,
      audit_passed: a.auditPassed,
      created_at: a.createdAt || new Date().toISOString(),
    }));

    const { error } = await this.client.from("veracity_audits").insert(rows);
    if (error) {
      throw new Error(`Failed to insert veracity audits: ${error.message}`);
    }
  }

  async findByScoutId(scoutId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from("veracity_audits")
      .select("*")
      .eq("scout_id", scoutId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to query veracity audits for scout ${scoutId}: ${error.message}`);
    }
    return data || [];
  }

  async findByExecutionId(executionId: string): Promise<Record<string, unknown>[]> {
    const { data, error } = await this.client
      .from("veracity_audits")
      .select("*")
      .eq("execution_id", executionId)
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`Failed to query veracity audits for execution ${executionId}: ${error.message}`);
    }
    return data || [];
  }
}
