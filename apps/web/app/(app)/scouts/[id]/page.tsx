import { notFound } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  ScoutDetailView,
  type ScoutData,
  type ScoutExecution,
  type ExecutionStep,
  type PropositionItem,
  type VeracityAuditItem,
  type ScentMetricItem,
  type ScoutMessageItem,
} from "@/components/scouts/scout-detail-view";

export const instant = false;

interface ScoutDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function ScoutDetailPage({ params }: ScoutDetailPageProps) {
  await connection();
  const { id } = await params;
  const supabase = await createClient();

  // 1. Fetch scout record
  const { data: rawScout, error: scoutErr } = await supabase
    .from("scouts")
    .select("*")
    .eq("id", id)
    .single();

  if (scoutErr || !rawScout) {
    notFound();
  }

  // 2. Fetch all executions for this scout
  const { data: rawExecutions } = await supabase
    .from("scout_executions")
    .select("*")
    .eq("scout_id", id)
    .order("started_at", { ascending: false });

  const executions: ScoutExecution[] = (rawExecutions || []).map((e) => ({
    id: e.id,
    scoutId: e.scout_id,
    status: e.status,
    startedAt: e.started_at,
    completedAt: e.completed_at,
    errorMessage: e.error_message,
    resultsSummary: e.results_summary,
    summaryText: e.summary_text,
    createdAt: e.created_at || e.started_at,
  }));

  // 3. Fetch steps across executions (if executions exist)
  let steps: ExecutionStep[] = [];
  if (executions.length > 0) {
    const executionIds = executions.map((e) => e.id);
    const { data: rawSteps } = await supabase
      .from("scout_execution_steps")
      .select("*")
      .in("execution_id", executionIds)
      .order("step_number", { ascending: true });

    if (rawSteps) {
      const stepMap = new Map<string, (typeof rawSteps)[0]>();
      for (const s of rawSteps) {
        const key = `${s.execution_id}:${s.step_number}`;
        const existing = stepMap.get(key);
        if (
          !existing ||
          (existing.status !== "completed" && s.status === "completed") ||
          (!existing.output_data && s.output_data) ||
          new Date(s.completed_at || s.started_at || 0) > new Date(existing.completed_at || existing.started_at || 0)
        ) {
          stepMap.set(key, s);
        }
      }

      steps = Array.from(stepMap.values()).map((s) => ({
        id: s.id,
        executionId: s.execution_id,
        stepNumber: s.step_number,
        stepType: s.step_type,
        description: s.description,
        inputData: s.input_data,
        outputData: s.output_data,
        status: s.status,
        startedAt: s.started_at,
        completedAt: s.completed_at,
        errorMessage: s.error_message,
        createdAt: s.created_at || s.started_at,
      }));
    }
  }

  // 4. Fetch propositions for this scout
  const { data: rawProps } = await supabase
    .from("propositions")
    .select("*")
    .eq("scout_id", id)
    .order("created_at", { ascending: false });

  const propositions: PropositionItem[] = (rawProps || []).map((p) => ({
    id: p.id,
    scoutId: p.scout_id,
    executionId: p.execution_id,
    content: p.content,
    sourceUrl: p.source_url,
    domSelector: p.dom_selector,
    confidence: p.confidence,
    status: p.status,
    createdAt: p.created_at,
  }));

  // 5. Fetch veracity audits
  const { data: rawAudits } = await supabase
    .from("veracity_audits")
    .select("*")
    .eq("scout_id", id)
    .order("created_at", { ascending: false });

  const audits: VeracityAuditItem[] = (rawAudits || []).map((a) => ({
    id: a.id,
    scoutId: a.scout_id,
    executionId: a.execution_id,
    claim: a.claim,
    overallConfidence: a.overall_confidence,
    independentSourcesCount: a.independent_sources_count,
    citations: a.citations || [],
    hasContradiction: a.has_contradiction,
    contradictionDetails: a.contradiction_details,
    auditPassed: a.audit_passed,
    createdAt: a.created_at,
  }));

  // 6. Fetch scent metrics
  const { data: rawScent } = await supabase
    .from("scent_metrics")
    .select("*")
    .eq("scout_id", id)
    .order("recorded_at", { ascending: false });

  const scentMetrics: ScentMetricItem[] = (rawScent || []).map((s) => ({
    id: s.id,
    scoutId: s.scout_id,
    driftScore: s.drift_score,
    volatilityFactor: s.volatility_factor,
    baseIntervalMinutes: s.base_interval_minutes,
    computedIntervalMinutes: s.computed_interval_minutes,
    nextRunAt: s.next_run_at,
    recordedAt: s.recorded_at,
  }));

  // 7. Fetch scout messages
  const { data: rawMessages } = await supabase
    .from("scout_messages")
    .select("*")
    .eq("scout_id", id)
    .order("created_at", { ascending: true });

  const messages: ScoutMessageItem[] = (rawMessages || []).map((m) => ({
    id: m.id,
    scoutId: m.scout_id,
    role: m.role,
    content: m.content,
    createdAt: m.created_at,
  }));

  // 8. Fetch scout notifications
  const { data: rawNotifs } = await supabase
    .from("scout_notifications")
    .select("*")
    .eq("scout_id", id)
    .order("created_at", { ascending: false });

  const notifications = (rawNotifs || []).map((n) => ({
    id: n.id,
    scoutId: n.scout_id,
    executionId: n.execution_id,
    title: n.title,
    message: n.message,
    urgency: (n.urgency || "medium") as "low" | "medium" | "high",
    read: Boolean(n.read),
    createdAt: n.created_at,
  }));

  const scoutData: ScoutData = {
    id: rawScout.id,
    title: rawScout.title || rawScout.description || "Research Scout",
    goal:
      rawScout.goal ||
      rawScout.description ||
      rawScout.title ||
      "Targeted web research",
    description: rawScout.description,
    frequency: rawScout.frequency || "daily",
    searchQueries: (rawScout.search_queries as string[]) || [],
    isActive: Boolean(rawScout.is_active),
    consecutiveFailures: rawScout.consecutive_failures || 0,
    lastRunAt: rawScout.last_run_at,
    createdAt: rawScout.created_at || "1970-01-01T00:00:00.000Z",
    location: (rawScout.location as ScoutData["location"]) || null,
  };

  return (
    <ScoutDetailView
      scout={scoutData}
      initialExecutions={executions}
      initialSteps={steps}
      initialPropositions={propositions}
      initialAudits={audits}
      initialScentMetrics={scentMetrics}
      initialMessages={messages}
      initialNotifications={notifications}
    />
  );
}
