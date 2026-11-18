import type { VeracityAudit } from "@repo/types";
import { VeracityRepository, getServiceClient } from "@repo/database";
import { env } from "@repo/config-env";
import { server } from "../server";

export async function saveVeracityAuditsSafe(
  scoutId: string | undefined,
  executionId: string | undefined,
  audits: VeracityAudit[]
): Promise<{ savedCount: number; warning?: string }> {
  if (!audits || audits.length === 0) {
    return { savedCount: 0 };
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
      savedCount: 0,
      warning: "Database credentials unconfigured; veracity audits not persisted.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new VeracityRepository(client);

    const rows = audits.map((a) => ({
      scoutId: scoutId || null,
      executionId: executionId || null,
      claim: a.claim,
      overallConfidence: a.overallConfidence,
      independentSourcesCount: a.independentSourcesCount,
      citations: a.citations,
      hasContradiction: Boolean(a.hasContradiction),
      contradictionDetails: a.contradictionDetails ?? null,
      auditPassed: a.auditPassed,
    }));

    await repo.saveAudits(rows);
    return { savedCount: rows.length };
  } catch (err) {
    server.log.warn({ err, scoutId, executionId }, "Failed to persist veracity audits");
    return {
      savedCount: 0,
      warning: (err as Error).message,
    };
  }
}
