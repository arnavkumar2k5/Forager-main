"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  triggerScoutRun,
  updateScout,
  toggleScoutActive,
  deleteScout,
} from "@/app/actions/scouts";
import { getScoutStatusMeta } from "@/hooks/use-scout-status";
import { cn, extractCleanDomain } from "@/lib/utils";
import {
  Compass,
  CheckCircle2,
  XCircle,
  Loader2,
  Search,
  Globe,
  FileText,
  Play,
  ExternalLink,
  ShieldCheck,
  ArrowLeft,
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Clock,
  Activity,
  Layers,
  Database,
  Flame,
  Calendar,
  Settings,
  Power,
  Trash2,
  Save,
  SlidersHorizontal,
  Bell,
  Cpu,
  Target,
  Scale,
  Network,
  Zap,
} from "lucide-react";
import { markNotificationAsRead } from "@/app/actions/notifications";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { FormattedMarkdown } from "@/components/ui/formatted-markdown";
import {
  formatRelativeTime,
  formatFutureRelativeTime,
  formatDuration,
  formatDeterministicDateTime,
} from "@/lib/date";

export interface ScoutExecution {
  id: string;
  scoutId: string;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  resultsSummary?: Record<string, unknown> | null;
  summaryText?: string | null;
  createdAt: string;
}

export interface ExecutionStep {
  id: string;
  executionId: string;
  stepNumber: number;
  stepType: string;
  description: string;
  inputData?: Record<string, unknown> | null;
  outputData?: Record<string, unknown> | null;
  status: "running" | "completed" | "failed";
  startedAt: string;
  completedAt?: string | null;
  errorMessage?: string | null;
  createdAt: string;
}

export interface PropositionItem {
  id: string;
  scoutId: string;
  executionId?: string | null;
  content: string;
  sourceUrl: string;
  domSelector?: string | null;
  confidence?: number | null;
  status?: "active" | "deprecated" | "contradicted" | null;
  createdAt: string;
}

export interface VeracityAuditItem {
  id: string;
  scoutId?: string | null;
  executionId?: string | null;
  claim: string;
  overallConfidence: number;
  independentSourcesCount: number;
  citations: Array<{
    url?: string;
    domain?: string;
    title?: string;
    text?: string;
    snippet?: string;
    anchorSnippet?: string;
    domMatched?: boolean;
    veracityScore?: number;
    notes?: string;
  }>;
  hasContradiction?: boolean | null;
  contradictionDetails?: string | null;
  auditPassed: boolean;
  createdAt: string;
}

export interface ScentMetricItem {
  id: string;
  scoutId: string;
  driftScore: number;
  volatilityFactor: number;
  baseIntervalMinutes: number;
  computedIntervalMinutes: number;
  nextRunAt: string;
  recordedAt: string;
}

export interface ScoutMessageItem {
  id: string;
  scoutId: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ScoutNotificationItem {
  id: string;
  scoutId: string;
  executionId?: string | null;
  title: string;
  message: string;
  urgency: "low" | "medium" | "high";
  read?: boolean;
  createdAt: string;
}

export interface ScoutData {
  id: string;
  title: string;
  goal: string;
  description?: string | null;
  targetUrl?: string | null;
  frequency: string;
  searchQueries?: string[];
  isActive: boolean;
  consecutiveFailures: number;
  lastRunAt?: string | null;
  createdAt: string;
  location?: {
    notifyEmail?: string;
    notifyOnGoalMatch?: boolean;
    notifyOnDrift?: boolean;
    [key: string]: unknown;
  } | null;
}

interface ScoutDetailViewProps {
  scout: ScoutData;
  initialExecutions: ScoutExecution[];
  initialSteps: ExecutionStep[];
  initialPropositions: PropositionItem[];
  initialAudits: VeracityAuditItem[];
  initialScentMetrics: ScentMetricItem[];
  initialMessages: ScoutMessageItem[];
  initialNotifications: ScoutNotificationItem[];
}

export function ScoutDetailView({
  scout,
  initialExecutions,
  initialSteps,
  initialPropositions,
  initialAudits,
  initialScentMetrics,
  initialMessages,
  initialNotifications,
}: ScoutDetailViewProps) {
  const router = useRouter();

  const [scoutState, setScoutState] = useState<ScoutData>(scout);
  const [isTogglingActive, setIsTogglingActive] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isDeletingScout, setIsDeletingScout] = useState(false);

  const [editTitle, setEditTitle] = useState(scout.title);
  const [editGoal, setEditGoal] = useState(scout.goal);
  const [editFrequency, setEditFrequency] = useState<"daily" | "every_3_days" | "weekly">(
    (scout.frequency as "daily" | "every_3_days" | "weekly") || "daily"
  );
  const [editIsActive, setEditIsActive] = useState(scout.isActive);
  const [editSearchQueriesText, setEditSearchQueriesText] = useState(
    (scout.searchQueries || []).join(", ")
  );
  const [editNotifyEmail, setEditNotifyEmail] = useState(scout.location?.notifyEmail || "");
  const [editNotifyOnGoalMatch, setEditNotifyOnGoalMatch] = useState(
    scout.location?.notifyOnGoalMatch ?? true
  );
  const [editNotifyOnDrift, setEditNotifyOnDrift] = useState(scout.location?.notifyOnDrift ?? true);

  useEffect(() => {
    setScoutState(scout);
    setEditNotifyEmail(scout.location?.notifyEmail || "");
    setEditNotifyOnGoalMatch(scout.location?.notifyOnGoalMatch ?? true);
    setEditNotifyOnDrift(scout.location?.notifyOnDrift ?? true);
  }, [scout]);

  const [executions, setExecutions] = useState<ScoutExecution[]>(initialExecutions);
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(
    initialExecutions[0]?.id || null
  );
  const [steps, setSteps] = useState<ExecutionStep[]>(initialSteps);
  const [propositions, setPropositions] = useState<PropositionItem[]>(initialPropositions);
  const [audits, setAudits] = useState<VeracityAuditItem[]>(initialAudits);
  const [scentMetrics, setScentMetrics] = useState<ScentMetricItem[]>(initialScentMetrics);
  const [messages, setMessages] = useState<ScoutMessageItem[]>(initialMessages);
  const [notifications, setNotifications] = useState<ScoutNotificationItem[]>(initialNotifications);

  const [activeTab, setActiveTab] = useState<"steps" | "propositions" | "veracity" | "scent" | "messages" | "notifications">("steps");
  const [propFilter, setPropFilter] = useState<"all" | "novel" | "updated" | "redundant">("all");
  const [isStartingRun, setIsStartingRun] = useState(false);
  const [copiedFindings, setCopiedFindings] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);

  const selectedExecution = useMemo(() => {
    return executions.find((e) => e.id === selectedExecutionId) || executions[0] || null;
  }, [executions, selectedExecutionId]);

  const isCurrentRunActive = selectedExecution?.status === "running";

  useEffect(() => {
    if (!isCurrentRunActive) {
      setElapsedSec(0);
      return;
    }
    const startMs = selectedExecution?.startedAt
      ? new Date(selectedExecution.startedAt).getTime()
      : Date.now();
    setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));

    const timer = setInterval(() => {
      setElapsedSec(Math.max(0, Math.floor((Date.now() - startMs) / 1000)));
    }, 1000);

    return () => clearInterval(timer);
  }, [isCurrentRunActive, selectedExecution?.startedAt]);

  const executionSteps = useMemo(() => {
    if (!selectedExecution) return [];
    const stepMap = new Map<number, ExecutionStep>();
    for (const s of steps) {
      if (s.executionId !== selectedExecution.id) continue;
      const existing = stepMap.get(s.stepNumber);
      if (
        !existing ||
        (existing.status !== "completed" && s.status === "completed") ||
        (!existing.outputData && s.outputData) ||
        new Date(s.completedAt || s.startedAt || 0) > new Date(existing.completedAt || existing.startedAt || 0)
      ) {
        stepMap.set(s.stepNumber, s);
      }
    }
    return Array.from(stepMap.values()).sort((a, b) => a.stepNumber - b.stepNumber);
  }, [steps, selectedExecution]);

  const executionPropositions = useMemo(() => {
    if (!selectedExecution) return propositions;
    const match = propositions.filter((p) => p.executionId === selectedExecution.id);
    if (match.length > 0) return match;
    const summaryItems = (selectedExecution.resultsSummary as { propositions?: { items?: PropositionItem[] } })?.propositions?.items;
    if (Array.isArray(summaryItems) && summaryItems.length > 0) {
      return summaryItems;
    }
    return propositions;
  }, [propositions, selectedExecution]);

  const executionAudits = useMemo(() => {
    if (!selectedExecution) return audits;
    const match = audits.filter((a) => a.executionId === selectedExecution.id);
    if (match.length > 0) return match;
    const summaryAudits = (selectedExecution.resultsSummary as { audits?: VeracityAuditItem[] })?.audits;
    if (Array.isArray(summaryAudits) && summaryAudits.length > 0) {
      return summaryAudits;
    }
    return audits;
  }, [audits, selectedExecution]);

  const visitedDomains = useMemo(() => {
    const domainSet = new Set<string>();

    const addCandidate = (val: unknown) => {
      if (!val) return;
      if (typeof val === "string") {
        const d = extractCleanDomain(val);
        if (d) domainSet.add(d);
      } else if (Array.isArray(val)) {
        for (const item of val) addCandidate(item);
      } else if (typeof val === "object") {
        const obj = val as Record<string, unknown>;
        if (obj.domain) addCandidate(obj.domain);
        if (obj.url) addCandidate(obj.url);
        if (obj.link) addCandidate(obj.link);
      }
    };

    // 1. Veracity audits citations
    for (const audit of executionAudits) {
      if (Array.isArray(audit.citations)) {
        for (const cite of audit.citations) {
          addCandidate(cite.domain);
          addCandidate(cite.url);
        }
      }
    }

    // 2. Execution results summary
    const summary = selectedExecution?.resultsSummary as Record<string, unknown> | undefined;
    if (summary) {
      addCandidate(summary.evidenceUrls);
      addCandidate(summary.citations);
      addCandidate(summary.sources);
      if (Array.isArray(summary.audits)) {
        for (const a of summary.audits as Record<string, unknown>[]) {
          if (Array.isArray(a.citations)) addCandidate(a.citations);
        }
      }
    }

    // 3. Proposition source URLs
    for (const prop of executionPropositions) {
      addCandidate(prop.sourceUrl);
    }

    // 4. Execution steps
    for (const s of executionSteps) {
      const action = s.inputData?.action as Record<string, unknown> | undefined;
      addCandidate(action?.url);
      addCandidate(action?.urls);
      addCandidate(s.inputData?.url);
      addCandidate(s.inputData?.urls);
      addCandidate(s.outputData?.url);
      addCandidate(s.outputData?.urls);
      addCandidate(s.outputData?.results);
      addCandidate(s.outputData?.candidates);
      addCandidate(s.outputData?.evidenceList);
      addCandidate(s.outputData?.evidenceUrls);

      const textToScan = `${s.description || ""} ${typeof s.outputData?.text === "string" ? s.outputData.text : ""}`;
      const urlMatches = textToScan.match(/https?:\/\/[^\s"'<>)]+/g);
      if (urlMatches) {
        for (const u of urlMatches) addCandidate(u);
      }
    }

    // 5. Initial target/location URLs or URLs in goal
    if (scoutState.targetUrl) {
      addCandidate(scoutState.targetUrl);
    }
    const locUrl = (scoutState.location as Record<string, unknown> | undefined)?.url as string | undefined;
    if (locUrl) {
      addCandidate(locUrl);
    }
    const goalUrls = scoutState.goal?.match(/https?:\/\/[^\s"'<>)]+/g);
    if (goalUrls) {
      for (const u of goalUrls) addCandidate(u);
    }

    return Array.from(domainSet);
  }, [executionSteps, executionAudits, executionPropositions, selectedExecution, scoutState.targetUrl, scoutState.location, scoutState.goal]);

  const executionNotifications = useMemo(() => {
    if (!selectedExecution) return notifications;
    return notifications.filter((n) => !n.executionId || n.executionId === selectedExecution.id);
  }, [notifications, selectedExecution]);

  const executionScentMetrics = useMemo(() => {
    if (scentMetrics.length > 0) return scentMetrics;
    const summaryScent = (selectedExecution?.resultsSummary as { scent?: ScentMetricItem })?.scent;
    if (summaryScent && summaryScent.computedIntervalMinutes) {
      return [summaryScent];
    }
    return [];
  }, [scentMetrics, selectedExecution]);

  const activeStep = useMemo(() => {
    return executionSteps.find((s) => s.status === "running") || executionSteps[executionSteps.length - 1] || null;
  }, [executionSteps]);

  const diffSummary = useMemo(() => {
    const res = selectedExecution?.resultsSummary?.diffSummary as {
      isBaseline?: boolean;
      novelCount?: number;
      updatedCount?: number;
      redundantCount?: number;
      driftScore?: number;
      novelItems?: string[];
      updatedItems?: string[];
      redundantItems?: string[];
    } | undefined;
    return res;
  }, [selectedExecution]);

  const handleMarkNotificationRead = async (id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    await markNotificationAsRead(id, scout.id);
  };

  useEffect(() => {
    const supabase = createClient();

    const execChannel = supabase
      .channel(`scout_execs_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scout_executions",
          filter: `scout_id=eq.${scout.id}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;

          const normalized: ScoutExecution = {
            id: String(raw.id),
            scoutId: String(raw.scout_id),
            status: raw.status as "running" | "completed" | "failed",
            startedAt: String(raw.started_at),
            completedAt: (raw.completed_at as string | null) ?? null,
            errorMessage: (raw.error_message as string | null) ?? null,
            resultsSummary: (raw.results_summary as Record<string, unknown> | null) ?? null,
            summaryText: (raw.summary_text as string | null) ?? null,
            createdAt: String(raw.created_at || raw.started_at),
          };

          setExecutions((prev) => {
            const index = prev.findIndex((e) => e.id === normalized.id);
            if (index >= 0) {
              const updated = [...prev];
              updated[index] = normalized;
              return updated;
            }
            return [normalized, ...prev];
          });

          if (payload.eventType === "INSERT") {
            setSelectedExecutionId(normalized.id);
          }
        }
      )
      .subscribe();

    const stepsChannel = supabase
      .channel(`scout_steps_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scout_execution_steps",
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;

          const normalized: ExecutionStep = {
            id: String(raw.id),
            executionId: String(raw.execution_id),
            stepNumber: Number(raw.step_number),
            stepType: String(raw.step_type),
            description: String(raw.description),
            inputData: (raw.input_data as Record<string, unknown> | null) ?? null,
            outputData: (raw.output_data as Record<string, unknown> | null) ?? null,
            status: raw.status as "running" | "completed" | "failed",
            startedAt: String(raw.started_at),
            completedAt: (raw.completed_at as string | null) ?? null,
            errorMessage: (raw.error_message as string | null) ?? null,
            createdAt: String(raw.created_at || raw.started_at),
          };

          setSteps((prev) => {
            const idx = prev.findIndex(
              (s) =>
                s.id === normalized.id ||
                (s.executionId === normalized.executionId && s.stepNumber === normalized.stepNumber)
            );
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = {
                ...next[idx]!,
                ...normalized,
                status:
                  next[idx]!.status === "completed" && normalized.status === "running"
                    ? "completed"
                    : normalized.status,
              };
              return next;
            }
            return [...prev, normalized];
          });
        }
      )
      .subscribe();

    const propChannel = supabase
      .channel(`scout_props_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "propositions",
          filter: `scout_id=eq.${scout.id}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;
          const normalized: PropositionItem = {
            id: String(raw.id),
            scoutId: String(raw.scout_id),
            executionId: (raw.execution_id as string | null) ?? null,
            content: String(raw.content),
            sourceUrl: String(raw.source_url),
            domSelector: (raw.dom_selector as string | null) ?? null,
            confidence: typeof raw.confidence === "number" ? raw.confidence : null,
            status: (raw.status as PropositionItem["status"]) ?? "active",
            createdAt: String(raw.created_at),
          };
          setPropositions((prev) => {
            const idx = prev.findIndex((p) => p.id === normalized.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = normalized;
              return next;
            }
            return [normalized, ...prev];
          });
        }
      )
      .subscribe();

    const auditsChannel = supabase
      .channel(`scout_audits_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "veracity_audits",
          filter: `scout_id=eq.${scout.id}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;
          const normalized: VeracityAuditItem = {
            id: String(raw.id),
            scoutId: (raw.scout_id as string | null) ?? null,
            executionId: (raw.execution_id as string | null) ?? null,
            claim: String(raw.claim),
            overallConfidence: Number(raw.overall_confidence),
            independentSourcesCount: Number(raw.independent_sources_count),
            citations: (raw.citations as VeracityAuditItem["citations"]) || [],
            hasContradiction: (raw.has_contradiction as boolean | null) ?? false,
            contradictionDetails: (raw.contradiction_details as string | null) ?? null,
            auditPassed: Boolean(raw.audit_passed),
            createdAt: String(raw.created_at),
          };
          setAudits((prev) => [normalized, ...prev.filter((a) => a.id !== normalized.id)]);
        }
      )
      .subscribe();

    const notifsChannel = supabase
      .channel(`scout_notifs_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scout_notifications",
          filter: `scout_id=eq.${scout.id}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;
          const normalized: ScoutNotificationItem = {
            id: String(raw.id),
            scoutId: String(raw.scout_id),
            executionId: (raw.execution_id as string | null) ?? null,
            title: String(raw.title),
            message: String(raw.message),
            urgency: ((raw.urgency as string) || "medium") as "low" | "medium" | "high",
            read: Boolean(raw.read),
            createdAt: String(raw.created_at),
          };
          setNotifications((prev) => [normalized, ...prev.filter((n) => n.id !== normalized.id)]);
          if (payload.eventType === "INSERT") {
            toast(normalized.title, { description: normalized.message });
          }
        }
      )
      .subscribe();

    const scentChannel = supabase
      .channel(`scout_scent_${scout.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "scent_metrics",
          filter: `scout_id=eq.${scout.id}`,
        },
        (payload) => {
          const raw = payload.new as Record<string, unknown>;
          if (!raw?.id) return;
          const normalized: ScentMetricItem = {
            id: String(raw.id),
            scoutId: String(raw.scout_id),
            driftScore: Number(raw.drift_score),
            volatilityFactor: Number(raw.volatility_factor),
            baseIntervalMinutes: Number(raw.base_interval_minutes),
            computedIntervalMinutes: Number(raw.computed_interval_minutes),
            nextRunAt: String(raw.next_run_at),
            recordedAt: String(raw.recorded_at),
          };
          setScentMetrics((prev) => [normalized, ...prev.filter((s) => s.id !== normalized.id)]);
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(execChannel);
      supabase.removeChannel(stepsChannel);
      supabase.removeChannel(propChannel);
      supabase.removeChannel(auditsChannel);
      supabase.removeChannel(notifsChannel);
      supabase.removeChannel(scentChannel);
    };
  }, [scout.id]);

  async function handleToggleActive() {
    setIsTogglingActive(true);
    const nextActive = !scoutState.isActive;
    try {
      await toggleScoutActive(scout.id, nextActive);
      setScoutState((prev) => ({ ...prev, isActive: nextActive }));
      toast.success(
        nextActive
          ? "Scout activated: Scent-driven autonomous polling resumed"
          : "Scout paused: Background polling suspended"
      );
    } catch (err) {
      toast.error(`Failed to update scout status: ${(err as Error).message}`);
    } finally {
      setIsTogglingActive(false);
    }
  }

  function handleOpenSettings() {
    setEditTitle(scoutState.title);
    setEditGoal(scoutState.goal);
    setEditFrequency((scoutState.frequency as "daily" | "every_3_days" | "weekly") || "daily");
    setEditIsActive(scoutState.isActive);
    setEditSearchQueriesText((scoutState.searchQueries || []).join(", "));
    setEditNotifyEmail(scoutState.location?.notifyEmail || "");
    setEditNotifyOnGoalMatch(scoutState.location?.notifyOnGoalMatch ?? true);
    setEditNotifyOnDrift(scoutState.location?.notifyOnDrift ?? true);
    setIsSettingsOpen(true);
  }

  async function handleSaveSettings() {
    if (!editTitle.trim()) {
      toast.error("Scout title cannot be empty");
      return;
    }
    if (!editGoal.trim()) {
      toast.error("Research goal cannot be empty");
      return;
    }

    setIsSavingSettings(true);
    try {
      const parsedQueries = editSearchQueriesText
        .split(/[,\n]/)
        .map((q) => q.trim())
        .filter((q) => q.length > 0);

      const locationPayload = {
        notifyEmail: editNotifyEmail.trim(),
        notifyOnGoalMatch: editNotifyOnGoalMatch,
        notifyOnDrift: editNotifyOnDrift,
      };

      const updated = await updateScout({
        scoutId: scout.id,
        title: editTitle.trim(),
        goal: editGoal.trim(),
        frequency: editFrequency,
        isActive: editIsActive,
        searchQueries: parsedQueries,
        location: locationPayload,
      });

      setScoutState({
        ...scoutState,
        title: (updated.title as string) || editTitle.trim(),
        goal: (updated.goal as string) || editGoal.trim(),
        frequency: (updated.frequency as string) || editFrequency,
        isActive: Boolean(updated.is_active),
        searchQueries: (updated.search_queries as string[]) || parsedQueries,
        location: (updated.location as ScoutData["location"]) || locationPayload,
      });

      setIsSettingsOpen(false);
      toast.success("Scout settings saved successfully");
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleDeleteScout() {
    const confirmed = window.confirm(
      `Are you sure you want to delete "${scoutState.title}"? This will permanently remove all executions, proposition diffs, and veracity audits.`
    );
    if (!confirmed) return;

    setIsDeletingScout(true);
    try {
      await deleteScout(scout.id);
      toast.success("Scout deleted successfully");
      router.push("/scouts");
    } catch (err) {
      toast.error(`Deletion failed: ${(err as Error).message}`);
      setIsDeletingScout(false);
    }
  }

  async function handleLaunchRun() {
    setIsStartingRun(true);
    try {
      const runQuery =
        scoutState.goal?.trim() ||
        scoutState.description?.trim() ||
        scoutState.title?.trim() ||
        "Web Research";
      toast.info("Checking for new updates...");
      await triggerScoutRun({
        scoutId: scout.id,
        query: runQuery,
        goal: scoutState.goal || runQuery,
        title: scoutState.title || "Research Scout",
        maxSteps: 10,
      });
      toast.success("Check started");
    } catch (err) {
      toast.error(`Run dispatch failed: ${(err as Error).message}`);
    } finally {
      setIsStartingRun(false);
    }
  }

  function handleCopyFindings() {
    if (selectedExecution?.summaryText) {
      navigator.clipboard.writeText(selectedExecution.summaryText);
      setCopiedFindings(true);
      toast.success("Findings copied to clipboard");
      setTimeout(() => setCopiedFindings(false), 2000);
    }
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Breadcrumb */}
      <div className="space-y-3">
        <Link
          href="/scouts"
          className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary transition-colors cursor-pointer"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to Scouts
        </Link>

        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-border pb-4">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold tracking-tight text-foreground">{scoutState.title}</h1>

              {/* Active / Paused Pill with Quick Toggle */}
              <button
                type="button"
                onClick={handleToggleActive}
                disabled={isTogglingActive}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold transition-all border shadow-2xs cursor-pointer",
                  scoutState.isActive
                    ? "bg-success/15 text-success border-success/30 hover:bg-success/25"
                    : "bg-muted text-muted-foreground border-border hover:bg-accent"
                )}
                title="Click to toggle active scheduling"
              >
                <span
                  className={cn(
                    "h-2 w-2 rounded-full",
                    scoutState.isActive ? "bg-success animate-pulse" : "bg-muted-foreground"
                  )}
                />
                {scoutState.isActive ? "Active" : "Paused"}
                {isTogglingActive ? (
                  <Loader2 className="h-3 w-3 animate-spin ml-0.5" />
                ) : (
                  <Power className="h-2.5 w-2.5 opacity-60 ml-0.5" />
                )}
              </button>

              <span className="rounded-md border border-border bg-muted/80 px-2 py-0.5 text-xs font-medium text-muted-foreground">
                Schedule: {scoutState.frequency === "every_3_days" ? "Every 3 Days" : scoutState.frequency === "weekly" ? "Weekly" : "Daily"}
              </span>

              {scoutState.consecutiveFailures > 0 && (
                <span className="inline-flex items-center gap-1 rounded-md border border-destructive/30 bg-destructive/10 px-2 py-0.5 text-xs font-medium text-destructive">
                  {scoutState.consecutiveFailures} Failures
                </span>
              )}
            </div>

            <p className="text-xs text-muted-foreground max-w-3xl leading-relaxed">{scoutState.goal}</p>

            {scoutState.searchQueries && scoutState.searchQueries.length > 0 && (
              <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                <span className="text-[11px] font-semibold text-muted-foreground">Starting Points:</span>
                {scoutState.searchQueries.map((q, idx) => (
                  <span
                    key={idx}
                    className="rounded bg-muted/70 px-1.5 py-0.5 font-mono text-[10px] text-foreground border border-border"
                  >
                    {q}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenSettings}
              className="text-xs font-semibold shadow-xs cursor-pointer gap-1.5"
            >
              <Settings className="h-3.5 w-3.5 text-muted-foreground" />
              Settings
            </Button>

            <Button
              onClick={handleLaunchRun}
              disabled={isStartingRun || isCurrentRunActive}
              size="sm"
              className="text-xs font-semibold shadow-xs cursor-pointer gap-1.5"
            >
              {isStartingRun || isCurrentRunActive ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  {isCurrentRunActive ? "Checking updates..." : "Starting check..."}
                </>
              ) : (
                <>
                  <Play className="h-3.5 w-3.5" />
                  Check Now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* Main 2-Column Interface: Left = Runs History, Right = Selected Trajectory Deep-Dive */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Column: Runs History */}
        <div className="lg:col-span-4 space-y-3">
          <div className="flex items-center justify-between pb-1 border-b border-border">
            <div className="flex items-center gap-2">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" />
              <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                Runs History ({executions.length})
              </h2>
            </div>
            {executions.some((e) => e.status === "running") && (
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-primary animate-pulse">
                <span className="h-2 w-2 rounded-full bg-primary animate-ping" />
                Active Run
              </span>
            )}
          </div>

          {executions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border p-6 text-center bg-card">
              <Compass className="h-6 w-6 text-muted-foreground mx-auto mb-2 opacity-60" />
              <p className="text-xs font-semibold text-foreground">No checks recorded yet</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Click &ldquo;Check Now&rdquo; above to run your first automated check.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {executions.map((exec, index) => {
                const isSelected = selectedExecution?.id === exec.id;
                const isRunning = exec.status === "running";
                const isFailed = exec.status === "failed";
                const isCompleted = exec.status === "completed";
                const runNumber = executions.length - index;

                const novelCount =
                  exec.resultsSummary?.novelCount ??
                  (exec.resultsSummary?.diffSummary as { novelCount?: number })?.novelCount ??
                  (exec.resultsSummary?.propositions as { novelCount?: number })?.novelCount ??
                  0;

                return (
                  <button
                    key={exec.id}
                    type="button"
                    onClick={() => {
                      setSelectedExecutionId(exec.id);
                      setExpandedStepId(null);
                    }}
                    className={cn(
                      "w-full text-left rounded-xl border p-3 text-xs transition-all cursor-pointer relative",
                      isSelected
                        ? "border-primary bg-card ring-1 ring-primary/30 shadow-xs"
                        : "border-border bg-card hover:border-muted-foreground/60 hover:bg-muted/40"
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-foreground">Check #{runNumber}</span>
                        <span
                          className={cn(
                            "rounded px-1.5 py-0.5 text-[10px] font-medium border uppercase tracking-wider",
                            isRunning && "bg-primary/10 text-primary border-primary/20 font-semibold animate-pulse",
                            isCompleted && "bg-success/15 text-success border-success/20",
                            isFailed && "bg-destructive/10 text-destructive border-destructive/20"
                          )}
                        >
                          {exec.status}
                        </span>
                      </div>

                      <span className="text-[10px] text-muted-foreground font-mono" suppressHydrationWarning>
                        {formatDuration(exec.startedAt, exec.completedAt)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1.5">
                      <span suppressHydrationWarning>{formatRelativeTime(exec.startedAt)}</span>
                      {Number(novelCount) > 0 ? (
                        <span className="font-mono text-[10px] font-semibold text-success bg-success/10 px-1.5 py-0.2 rounded border border-success/20">
                          +{String(novelCount)} new
                        </span>
                      ) : (
                        <span className="font-mono text-[10px] text-muted-foreground">initial check</span>
                      )}
                    </div>

                    {exec.errorMessage && (
                      <p className="mt-1 line-clamp-1 text-[10px] text-destructive font-mono">
                        {exec.errorMessage}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Column: Selected Trajectory & Research Deep-Dive */}
        <div className="lg:col-span-8 space-y-4">
          {selectedExecution ? (
            <div className="space-y-4">
              {/* REAL-TIME EXECUTION FLOW PIPELINE STEPPER */}
              <div className="rounded-xl border border-border bg-card p-4 space-y-3.5 shadow-2xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-border">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-foreground">Check Summary</span>
                      <span className="font-mono text-[11px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                        {selectedExecution.id.slice(0, 8)}
                      </span>

                      {diffSummary?.isBaseline ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-primary/10 text-primary border border-primary/30">
                          <Sparkles className="h-3 w-3" />
                          Initial Check
                        </span>
                      ) : (diffSummary?.novelCount ?? 0) > 0 || (diffSummary?.updatedCount ?? 0) > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold bg-success/15 text-success border border-success/30">
                          <Sparkles className="h-3 w-3" />
                          +{diffSummary?.novelCount ?? 0} New Updates
                          {(diffSummary?.updatedCount ?? 0) > 0 ? `, ${diffSummary?.updatedCount} Changed` : ""}
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium bg-muted text-muted-foreground border border-border">
                          No Changes Detected
                        </span>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground mt-0.5" suppressHydrationWarning>
                      Started: {formatDeterministicDateTime(selectedExecution.startedAt)} · Duration:{" "}
                      {isCurrentRunActive ? `${elapsedSec}s elapsed` : formatDuration(selectedExecution.startedAt, selectedExecution.completedAt)}
                    </div>
                  </div>

                  {selectedExecution.summaryText && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={handleCopyFindings}
                      className="text-xs border-border self-start cursor-pointer gap-1.5"
                    >
                      {copiedFindings ? (
                        <>
                          <Check className="h-3.5 w-3.5 text-success" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-3.5 w-3.5" />
                          Copy Report
                        </>
                      )}
                    </Button>
                  )}
                </div>

                {/* 4 Clean Product Metric Cards */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 pt-1 text-[11px]">
                  <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <Globe className="h-3 w-3 text-primary" />
                      Websites Checked
                    </div>
                    <div className="font-semibold text-foreground text-xs">
                      {visitedDomains.length} {visitedDomains.length === 1 ? "Source" : "Sources"}
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <Layers className="h-3 w-3 text-primary" />
                      Actions Taken
                    </div>
                    <div className="font-semibold text-foreground text-xs">
                      {executionSteps.length} Steps
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <Database className="h-3 w-3 text-primary" />
                      Verified Facts
                    </div>
                    <div className="font-semibold text-foreground text-xs">
                      {executionPropositions.length} Points
                    </div>
                  </div>

                  <div className="rounded-lg border border-border bg-muted/40 p-2.5 text-center space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground flex items-center justify-center gap-1">
                      <Clock className="h-3 w-3 text-primary" />
                      Next Check
                    </div>
                    <div className="font-semibold text-foreground text-xs" suppressHydrationWarning>
                      {!scoutState.isActive
                        ? "Paused"
                        : executionScentMetrics[0]?.nextRunAt
                        ? formatFutureRelativeTime(executionScentMetrics[0].nextRunAt)
                        : `In ~${Math.round((executionScentMetrics[0]?.computedIntervalMinutes ?? 1440) / 60)}h`}
                    </div>
                  </div>
                </div>

                {/* LIVE RUNNING HUD (Active when execution is running) */}
                {isCurrentRunActive && (
                  <div className="rounded-lg border border-primary/30 bg-primary/10 p-3.5 space-y-2.5">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin text-primary" />
                        <span className="text-xs font-bold text-foreground">
                          Checking web sources for new updates...
                        </span>
                      </div>
                      <span className="font-mono text-xs font-semibold text-primary">
                        {elapsedSec}s elapsed
                      </span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 text-xs">
                      <div className="rounded bg-background/80 p-2 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block font-bold">
                          Current Action
                        </span>
                        <span className="font-medium text-foreground capitalize">
                          {activeStep?.stepType === "search"
                            ? "Searching Web"
                            : activeStep?.stepType === "scrape"
                            ? "Reading Web Page"
                            : activeStep?.stepType === "extract"
                            ? "Extracting Facts"
                            : activeStep?.stepType === "finish"
                            ? "Finalizing Report"
                            : "Starting..."}
                        </span>
                      </div>

                      <div className="rounded bg-background/80 p-2 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block font-bold">
                          Sources Visited
                        </span>
                        <span className="font-medium text-foreground">
                          {visitedDomains.length} website(s)
                        </span>
                      </div>

                      <div className="rounded bg-background/80 p-2 border border-border">
                        <span className="text-[10px] text-muted-foreground uppercase tracking-wider block font-bold">
                          Progress
                        </span>
                        <span className="font-medium text-foreground">
                          Analyzing content
                        </span>
                      </div>
                    </div>

                    {activeStep?.description && (
                      <p className="text-[11px] text-foreground font-mono bg-background/60 p-2 rounded border border-border truncate">
                        Step: {activeStep.description}
                      </p>
                    )}
                  </div>
                )}

                {/* Unread Alerts Banner */}
                {executionNotifications.some((n) => !n.read) && (
                  <div className="space-y-1.5 pt-1">
                    {executionNotifications
                      .filter((n) => !n.read)
                      .slice(0, 2)
                      .map((notif) => (
                        <div
                          key={notif.id}
                          className={cn(
                            "rounded-lg p-2.5 text-xs flex items-center justify-between gap-3 border",
                            notif.urgency === "high"
                              ? "bg-warning/15 border-warning/30 text-warning"
                              : "bg-primary/10 border-primary/30 text-primary"
                          )}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <Bell className="h-3.5 w-3.5 shrink-0" />
                            <div className="truncate">
                              <span className="font-semibold">{notif.title}: </span>
                              <span className="opacity-90">{notif.message}</span>
                            </div>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            onClick={() => handleMarkNotificationRead(notif.id)}
                            className="text-[10px] h-6 px-2 text-current hover:bg-black/5 shrink-0 cursor-pointer"
                          >
                            Dismiss
                          </Button>
                        </div>
                      ))}
                  </div>
                )}

                {/* Synthesized Knowledge Markdown Banner */}
                {Boolean(selectedExecution.summaryText || selectedExecution.resultsSummary?.response) ? (
                  <div className="text-xs text-foreground leading-relaxed font-sans bg-muted/60 p-4 rounded-xl border border-border">
                    <div className="flex items-center justify-between pb-2 mb-2 border-b border-border/80">
                      <div className="flex items-center gap-1.5 font-bold text-foreground text-xs">
                        <Sparkles className="h-3.5 w-3.5 text-primary" />
                        Summary & Key Findings
                      </div>
                      <span className="text-[10px] text-muted-foreground">
                        Verified across {visitedDomains.length} sources
                      </span>
                    </div>

                    <FormattedMarkdown
                      content={
                        selectedExecution.summaryText ||
                        (selectedExecution.resultsSummary?.response as string) ||
                        (selectedExecution.resultsSummary?.summary as string) ||
                        ""
                      }
                    />
                  </div>
                ) : null}

                {/* Error Banner if Execution Failed */}
                {selectedExecution.errorMessage && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3.5 text-xs text-destructive font-mono space-y-1">
                    <div className="font-bold flex items-center gap-1.5">
                      <XCircle className="h-4 w-4" />
                      Check Error:
                    </div>
                    <div className="pl-5 text-[11px] leading-relaxed">{selectedExecution.errorMessage}</div>
                  </div>
                )}
              </div>

              {/* TABS NAVIGATION */}
              <div className="border-b border-border flex items-center gap-1 overflow-x-auto pb-px">
                <button
                  type="button"
                  onClick={() => setActiveTab("steps")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "steps"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Layers className="h-3.5 w-3.5" />
                  Activity & Steps ({executionSteps.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("propositions")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "propositions"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Database className="h-3.5 w-3.5" />
                  Key Facts ({executionPropositions.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("veracity")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "veracity"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <ShieldCheck className="h-3.5 w-3.5" />
                  Verified Sources ({visitedDomains.length > 0 ? visitedDomains.length : executionAudits.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("scent")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "scent"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Clock className="h-3.5 w-3.5" />
                  Schedule & Frequency
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("messages")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "messages"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Activity className="h-3.5 w-3.5" />
                  Updates ({messages.length})
                </button>

                <button
                  type="button"
                  onClick={() => setActiveTab("notifications")}
                  className={cn(
                    "flex items-center gap-1.5 px-3 py-2 text-xs font-semibold border-b-2 transition-colors cursor-pointer whitespace-nowrap",
                    activeTab === "notifications"
                      ? "border-primary text-primary"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  <Bell className="h-3.5 w-3.5" />
                  Alerts ({notifications.length})
                  {notifications.some((n) => !n.read) && (
                    <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
                  )}
                </button>
              </div>

              {/* TAB 1: TRAJECTORY STEPS */}
              {activeTab === "steps" && (
                <div className="space-y-3">
                  {executionSteps.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground bg-card">
                      No steps recorded for this execution yet.
                    </div>
                  ) : (
                    executionSteps.map((step) => {
                      const isExpanded = expandedStepId === step.id;
                      const isRunning = step.status === "running";
                      const isCompleted = step.status === "completed";
                      const isFailed = step.status === "failed";

                      const actionObj = (step.inputData?.action as Record<string, unknown>) || {};
                      const evalObj = (step.outputData?.evaluation as Record<string, unknown>) || {};
                      const criticScore =
                        step.outputData?.criticScore !== undefined
                          ? Number(step.outputData.criticScore)
                          : evalObj?.score !== undefined
                          ? Number(evalObj.score)
                          : undefined;
                      const criticFeedback = typeof evalObj?.feedback === "string" ? evalObj.feedback : undefined;
                      const criticSuggestions = Array.isArray(evalObj?.suggestedNextSteps)
                        ? (evalObj.suggestedNextSteps as string[])
                        : undefined;
                      const explorerReasoning = typeof actionObj?.reasoning === "string" ? actionObj.reasoning : undefined;
                      const batchUrls = (Array.isArray(actionObj?.urls)
                        ? actionObj.urls
                        : Array.isArray(step.inputData?.urls)
                        ? step.inputData.urls
                        : []) as string[];

                      const searchResults = (step.outputData?.results ||
                        step.outputData?.searchResults ||
                        []) as Array<{ title?: string; url?: string; description?: string; snippet?: string }>;

                      return (
                        <div
                          key={step.id}
                          className={cn(
                            "rounded-xl border bg-card p-4 text-xs space-y-3 transition-all",
                            isRunning
                              ? "border-primary ring-1 ring-primary/30 shadow-xs"
                              : "border-border hover:border-muted-foreground/60"
                          )}
                        >
                          {/* Step Header */}
                          <div className="flex items-center justify-between gap-2 pb-2 border-b border-border">
                            <div className="flex items-center gap-2">
                              <span className="flex h-5 w-5 items-center justify-center rounded bg-muted text-[11px] font-bold text-foreground">
                                {step.stepNumber}
                              </span>
                              <span
                                className={cn(
                                  "rounded px-2 py-0.5 text-[10px] font-mono font-semibold uppercase tracking-wider border",
                                  step.stepType === "search" && "bg-blue-500/10 text-blue-500 border-blue-500/30",
                                  step.stepType === "scrape" && "bg-purple-500/10 text-purple-500 border-purple-500/30",
                                  step.stepType === "extract" && "bg-emerald-500/10 text-emerald-500 border-emerald-500/30",
                                  step.stepType === "finish" && "bg-amber-500/10 text-amber-500 border-amber-500/30"
                                )}
                              >
                                {step.stepType}
                              </span>
                            </div>

                            <div className="flex items-center gap-3">
                              <div className="flex items-center gap-1.5">
                                {isRunning && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                                {isCompleted && <CheckCircle2 className="h-3.5 w-3.5 text-success" />}
                                {isFailed && <XCircle className="h-3.5 w-3.5 text-destructive" />}
                                <span
                                  className={cn(
                                    "text-[11px] font-medium capitalize",
                                    isCompleted && "text-success",
                                    isFailed && "text-destructive",
                                    isRunning && "text-primary font-semibold"
                                  )}
                                >
                                  {step.status}
                                </span>
                              </div>

                              <button
                                type="button"
                                onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                                className="text-muted-foreground hover:text-foreground p-0.5 rounded cursor-pointer"
                                title={isExpanded ? "Collapse payload" : "Inspect raw payload"}
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3.5 w-3.5" />
                                ) : (
                                  <ChevronRight className="h-3.5 w-3.5" />
                                )}
                              </button>
                            </div>
                          </div>

                          {/* Step Main Description */}
                          <div className="font-mono text-[11px] text-foreground bg-muted/60 p-2.5 rounded-lg border border-border leading-relaxed">
                            {step.description}
                          </div>

                          {/* Explorer Action Rationale */}
                          {explorerReasoning && explorerReasoning !== step.description && (
                            <div className="rounded-lg border border-primary/25 bg-primary/5 p-3 space-y-1">
                              <div className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-primary">
                                <Compass className="h-3.5 w-3.5" />
                                Step Objective
                              </div>
                              <p className="text-foreground leading-relaxed text-[11px] font-sans">
                                {explorerReasoning}
                              </p>
                            </div>
                          )}

                          {/* Search Results Preview */}
                          {step.stepType === "search" && searchResults.length > 0 && (
                            <div className="rounded-lg border border-border bg-card p-3 space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                                <Search className="h-3.5 w-3.5 text-primary" />
                                Relevant Web Pages Found ({searchResults.length})
                              </div>
                              <div className="space-y-1.5">
                                {searchResults.slice(0, 3).map((item, idx) => (
                                  <div key={idx} className="p-2 rounded bg-muted/40 border border-border text-[11px] space-y-0.5">
                                    <a
                                      href={item.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-primary hover:underline flex items-center gap-1 truncate"
                                    >
                                      {item.title || item.url}
                                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                    </a>
                                    <p className="text-[10px] text-muted-foreground line-clamp-1">
                                      {item.snippet || item.description || "Grounded candidate target."}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Multi-Site Batch Scrape Targets */}
                          {batchUrls.length > 1 && (
                            <div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5 space-y-1.5 text-xs">
                              <div className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-primary">
                                <Globe className="h-3.5 w-3.5" />
                                Sites Checked In Parallel ({batchUrls.length})
                              </div>
                              <div className="flex flex-wrap gap-1">
                                {batchUrls.map((u, uIdx) => (
                                  <span
                                    key={uIdx}
                                    className="text-[10px] text-muted-foreground font-mono bg-card px-1.5 py-0.5 rounded border border-border max-w-xs truncate"
                                  >
                                    {u}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Critic Agent Heuristic Guidance */}
                          {(criticFeedback || (criticSuggestions && criticSuggestions.length > 0) || criticScore !== undefined) && (
                            <div className="rounded-lg border border-warning/30 bg-warning/5 p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="flex items-center gap-1.5 font-semibold text-[10px] uppercase tracking-wider text-warning">
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  Content Evaluation
                                </div>
                                {criticScore !== undefined && (
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] text-muted-foreground">Relevance:</span>
                                    <div className="h-1.5 w-16 bg-muted rounded-full overflow-hidden border border-border">
                                      <div
                                        className="h-full bg-warning rounded-full"
                                        style={{ width: `${Math.min(100, Math.round(criticScore * 100))}%` }}
                                      />
                                    </div>
                                    <span className="font-mono text-[10px] font-bold text-foreground">
                                      {(criticScore * 100).toFixed(0)}%
                                    </span>
                                  </div>
                                )}
                              </div>

                              {criticFeedback && (
                                <p className="text-foreground leading-relaxed text-[11px] font-sans">
                                  {criticFeedback}
                                </p>
                              )}

                              {criticSuggestions && criticSuggestions.length > 0 && (
                                <div className="text-[10px] text-muted-foreground space-y-0.5 pt-0.5">
                                  <span className="font-semibold text-foreground">Next action:</span>
                                  <ul className="list-disc list-inside space-y-0.5 pl-1">
                                    {criticSuggestions.map((sug, sIdx) => (
                                      <li key={sIdx}>{sug}</li>
                                    ))}
                                  </ul>
                                </div>
                              )}
                            </div>
                          )}

                          {/* Extracted Factual Content */}
                          {Boolean(
                            step.outputData?.extractedContent ||
                            (step.inputData?.action as Record<string, unknown> | undefined)?.extractedContent
                          ) && (
                            <div className="rounded-lg bg-success/10 border border-success/30 p-3 space-y-1">
                              <span className="font-semibold flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-success">
                                <Database className="h-3.5 w-3.5" />
                                Key Facts Extracted:
                              </span>
                              <p className="text-foreground font-sans leading-relaxed whitespace-pre-wrap text-[11px]">
                                {String(
                                  step.outputData?.extractedContent ||
                                  (step.inputData?.action as Record<string, unknown> | undefined)?.extractedContent
                                )}
                              </p>
                            </div>
                          )}

                          {/* Raw Inspection Dropdown */}
                          {isExpanded && (
                            <div className="space-y-2 pt-2 border-t border-border text-[10px]">
                              {step.inputData && (
                                <div>
                                  <span className="font-semibold text-muted-foreground">Action Input Payload:</span>
                                  <pre className="mt-1 p-2 rounded bg-muted text-foreground overflow-x-auto font-mono text-[10px] border border-border">
                                    {JSON.stringify(step.inputData, null, 2)}
                                  </pre>
                                </div>
                              )}
                              {step.outputData && (
                                <div>
                                  <span className="font-semibold text-muted-foreground">Observation Output:</span>
                                  <pre className="mt-1 p-2 rounded bg-muted text-foreground overflow-x-auto font-mono text-[10px] border border-border">
                                    {JSON.stringify(step.outputData, null, 2)}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* TAB 2: OHCACHE PROPOSITIONS */}
              {activeTab === "propositions" && (() => {
                const novelSet = new Set((diffSummary?.novelItems || []).map((s) => s.trim().toLowerCase()));
                const updatedSet = new Set((diffSummary?.updatedItems || []).map((s) => s.trim().toLowerCase()));

                const filtered = executionPropositions.filter((prop) => {
                  const lower = prop.content.trim().toLowerCase();
                  const isNov = novelSet.has(lower);
                  const isUpd = updatedSet.has(lower) || prop.status === "contradicted";

                  if (propFilter === "novel") return isNov;
                  if (propFilter === "updated") return isUpd;
                  if (propFilter === "redundant") return !isNov && !isUpd;
                  return true;
                });

                return (
                  <div className="space-y-3">
                    {/* Filter controls */}
                    <div className="flex flex-wrap items-center gap-1.5 pb-1">
                      <button
                        type="button"
                        onClick={() => setPropFilter("all")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors",
                          propFilter === "all"
                            ? "bg-primary text-primary-foreground border-primary"
                            : "bg-card text-muted-foreground border-border hover:border-muted-foreground"
                        )}
                      >
                        All ({executionPropositions.length})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPropFilter("novel")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors",
                          propFilter === "novel"
                            ? "bg-success text-success-foreground border-success"
                            : "bg-card text-success border-success/30 hover:border-success"
                        )}
                      >
                        New Facts (+{diffSummary?.novelCount ?? 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPropFilter("updated")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors",
                          propFilter === "updated"
                            ? "bg-warning text-warning-foreground border-warning"
                            : "bg-card text-warning border-warning/30 hover:border-warning"
                        )}
                      >
                        Changes & Updates (~{diffSummary?.updatedCount ?? 0})
                      </button>
                      <button
                        type="button"
                        onClick={() => setPropFilter("redundant")}
                        className={cn(
                          "px-2.5 py-1 rounded-md text-[11px] font-medium border cursor-pointer transition-colors",
                          propFilter === "redundant"
                            ? "bg-muted-foreground text-background border-muted-foreground"
                            : "bg-card text-muted-foreground border-border hover:border-muted-foreground"
                        )}
                      >
                        Confirmed Facts (=)
                      </button>
                    </div>

                    {filtered.length === 0 ? (
                      <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground bg-card">
                        No facts matching selected filter.
                      </div>
                    ) : (
                      filtered.map((prop) => {
                        const lower = prop.content.trim().toLowerCase();
                        const isNov = novelSet.has(lower);
                        const isUpd = updatedSet.has(lower) || prop.status === "contradicted";

                        return (
                          <div
                            key={prop.id}
                            className="rounded-xl border border-border bg-card p-3.5 space-y-2 text-xs hover:border-muted-foreground/60 transition-colors"
                          >
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-1.5">
                                {isNov ? (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border uppercase bg-success/15 text-success border-success/30">
                                    + New Fact
                                  </span>
                                ) : isUpd ? (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold border uppercase bg-warning/15 text-warning border-warning/30">
                                    ~ Updated
                                  </span>
                                ) : (
                                  <span className="rounded px-1.5 py-0.5 text-[10px] font-medium border uppercase bg-muted text-muted-foreground border-border">
                                    = Confirmed
                                  </span>
                                )}

                                <span
                                  className={cn(
                                    "rounded px-1.5 py-0.5 text-[10px] font-mono lowercase border",
                                    prop.status === "active" && "bg-card text-muted-foreground border-border",
                                    prop.status === "contradicted" && "bg-destructive/10 text-destructive border-destructive/20"
                                  )}
                                >
                                  {prop.status || "active"}
                                </span>
                              </div>

                              {prop.confidence !== null && prop.confidence !== undefined && (
                                <span className="font-mono text-[10px] text-muted-foreground">
                                  Confidence: {(prop.confidence * 100).toFixed(0)}%
                                </span>
                              )}
                            </div>

                            <p className="text-foreground leading-relaxed font-sans text-xs">{prop.content}</p>

                            <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-muted-foreground">
                              {prop.sourceUrl && (
                                <a
                                  href={prop.sourceUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="inline-flex items-center gap-1 text-primary hover:underline"
                                >
                                  <Globe className="h-3 w-3" />
                                  <span className="max-w-xs truncate">{prop.sourceUrl}</span>
                                  <ExternalLink className="h-2.5 w-2.5" />
                                </a>
                              )}
                              {prop.domSelector && (
                                <span className="font-mono text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded border border-border">
                                  DOM: {prop.domSelector}
                                </span>
                              )}
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                );
              })()}

              {/* TAB 3: VERACITY AUDITS & CITATIONS */}
              {activeTab === "veracity" && (
                <div className="space-y-3">
                  {executionAudits.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground bg-card">
                      No source verifications recorded yet. Sources are automatically checked when research completes.
                    </div>
                  ) : (
                    executionAudits.map((audit) => {
                      const distinctDomains = Array.from(
                        new Set(
                          (audit.citations || [])
                            .map((c) => c.domain || extractCleanDomain(c.url || ""))
                            .filter(Boolean) as string[]
                        )
                      );
                      const sourcesCount = Math.max(audit.independentSourcesCount || 0, distinctDomains.length);
                      const isMultiSource = sourcesCount >= 2;

                      return (
                        <div
                          key={audit.id}
                          className="rounded-xl border border-border bg-card p-4 space-y-2.5 text-xs hover:border-muted-foreground/60 transition-colors"
                        >
                          <div className="flex items-center justify-between gap-2">
                            {isMultiSource ? (
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border",
                                  audit.auditPassed
                                    ? "bg-success/15 text-success border-success/30"
                                    : audit.hasContradiction
                                    ? "bg-destructive/15 text-destructive border-destructive/30"
                                    : "bg-primary/15 text-primary border-primary/30"
                                )}
                              >
                                <CheckCircle2 className="h-3.5 w-3.5" />
                                {audit.auditPassed
                                  ? `Verified Across Multiple Sources (${sourcesCount})`
                                  : `Cross-Referenced (${sourcesCount} Sources)`}
                              </span>
                            ) : sourcesCount === 1 ? (
                              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border bg-muted text-muted-foreground border-border">
                                <Globe className="h-3.5 w-3.5" />
                                Single Source
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[11px] font-semibold border bg-muted text-muted-foreground border-border">
                                <Globe className="h-3.5 w-3.5" />
                                Pending Verification
                              </span>
                            )}

                            <span className="font-mono text-[11px] text-muted-foreground">
                              Confidence: {(audit.overallConfidence * 100).toFixed(0)}% · {sourcesCount} Source(s)
                            </span>
                          </div>

                        <div className="font-medium text-foreground leading-relaxed text-xs">
                          &ldquo;{audit.claim}&rdquo;
                        </div>

                        {audit.contradictionDetails && (
                          <div className="rounded-lg bg-destructive/10 p-2.5 text-[11px] text-destructive border border-destructive/20">
                            <strong>Note:</strong> {audit.contradictionDetails}
                          </div>
                        )}

                        {audit.citations && audit.citations.length > 0 && (
                          <div className="pt-1 space-y-1.5">
                            <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                              Sources & Quotations ({audit.citations.length}):
                            </span>
                            <div className="space-y-1">
                              {audit.citations.map((cite, cidx) => (
                                <div
                                  key={cidx}
                                  className="text-[11px] text-muted-foreground bg-muted/60 p-2 rounded-lg border border-border"
                                >
                                  {cite.url && (
                                    <a
                                      href={cite.url}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="font-medium text-primary hover:underline flex items-center gap-1"
                                    >
                                      {cite.domain || extractCleanDomain(cite.url) || cite.title || cite.url}
                                      <ExternalLink className="h-2.5 w-2.5" />
                                    </a>
                                  )}
                                  {(cite.anchorSnippet || cite.snippet) && (
                                    <p className="mt-0.5 text-[10px] font-mono text-foreground">
                                      &quot;{cite.anchorSnippet || cite.snippet}&quot;
                                    </p>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })
                  )}
                </div>
              )}

              {/* TAB 4: SCHEDULE & NEXT CHECK */}
              {activeTab === "scent" && (
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4 text-xs space-y-3">
                    <div className="flex items-center justify-between pb-2 border-b border-border">
                      <div className="font-semibold text-foreground flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-primary" />
                        Automated Check Schedule
                      </div>
                      <span className="rounded-md bg-success/15 text-success border border-success/30 px-2 py-0.5 text-[11px] font-semibold">
                        Auto-Scheduling Active
                      </span>
                    </div>

                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      Forager checks online sources on a regular schedule. When frequent updates are found, it checks sooner; when sources are quiet, it spaces out checks to avoid redundant web traffic.
                    </p>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
                      <div className="rounded-lg bg-muted/60 p-3 border border-border space-y-1">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                          Check Frequency
                        </span>
                        <div className="text-sm font-bold text-foreground capitalize">
                          {scoutState.frequency === "every_3_days" ? "Every 3 Days" : scoutState.frequency === "weekly" ? "Weekly" : "Daily"}
                        </div>
                        <span className="text-[10px] text-muted-foreground">Configured interval</span>
                      </div>

                      <div className="rounded-lg bg-primary/10 p-3 border border-primary/25 space-y-1 text-primary">
                        <span className="text-[10px] uppercase font-bold tracking-wider block">
                          Next Automated Check
                        </span>
                        <div className="text-sm font-bold text-foreground" suppressHydrationWarning>
                          {!scoutState.isActive
                            ? "Monitoring Paused"
                            : executionScentMetrics[0]?.nextRunAt
                            ? formatDeterministicDateTime(executionScentMetrics[0].nextRunAt)
                            : "Scheduled according to frequency"}
                        </div>
                        <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                          {!scoutState.isActive
                            ? "Resume monitoring to enable auto-checks"
                            : executionScentMetrics[0]?.nextRunAt
                            ? `(${formatFutureRelativeTime(executionScentMetrics[0].nextRunAt)})`
                            : "Daily check"}
                        </span>
                      </div>

                      <div className="rounded-lg bg-muted/60 p-3 border border-border space-y-1">
                        <span className="text-[10px] uppercase font-bold text-muted-foreground tracking-wider block">
                          Monitoring Status
                        </span>
                        <div className="text-sm font-bold text-foreground">
                          {scoutState.isActive ? "Active Monitoring" : "Paused"}
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {scoutState.isActive ? "Background poller running" : "Checks suspended"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Past Check Schedule History */}
                  {executionScentMetrics.length > 0 && (
                    <div className="rounded-xl border border-border bg-card p-4 space-y-3">
                      <div className="text-xs font-semibold text-foreground">Recent Check Timing History</div>
                      <div className="space-y-2">
                        {executionScentMetrics.map((scentItem) => (
                          <div
                            key={scentItem.id}
                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2.5 rounded-lg border border-border bg-muted/30 text-[11px]"
                            suppressHydrationWarning
                          >
                            <span className="text-muted-foreground">
                              Checked on {formatDeterministicDateTime(scentItem.recordedAt)}
                            </span>
                            <span className="font-medium text-foreground">
                              Next scheduled: {formatDeterministicDateTime(scentItem.nextRunAt)} ({formatFutureRelativeTime(scentItem.nextRunAt)})
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TAB 5: MESSAGES */}
              {activeTab === "messages" && (
                <div className="space-y-3">
                  {messages.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground bg-card">
                      No directive or conversation messages logged for this scout.
                    </div>
                  ) : (
                    messages.map((msg) => (
                      <div
                        key={msg.id}
                        className={cn(
                          "rounded-xl p-3 text-xs space-y-1 border",
                          msg.role === "user"
                            ? "bg-primary/10 border-primary/25 ml-6"
                            : "bg-muted/70 border-border mr-6"
                        )}
                      >
                        <div className="flex items-center justify-between text-[10px] text-muted-foreground" suppressHydrationWarning>
                          <span className="font-semibold uppercase tracking-wider">{msg.role}</span>
                          <span>{formatDeterministicDateTime(msg.createdAt)}</span>
                        </div>
                        <p className="text-foreground leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                      </div>
                    ))
                  )}
                </div>
              )}

              {/* TAB 6: NOTIFICATIONS & ALERTS */}
              {activeTab === "notifications" && (
                <div className="space-y-3">
                  {notifications.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border p-8 text-center text-xs text-muted-foreground bg-card">
                      No notifications or alerts recorded for this scout.
                    </div>
                  ) : (
                    notifications.map((notif) => (
                      <div
                        key={notif.id}
                        className={cn(
                          "rounded-xl border p-4 space-y-2 text-xs transition-colors",
                          notif.read ? "bg-card border-border" : "bg-muted/80 border-primary/40 shadow-xs"
                        )}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <span
                              className={cn(
                                "rounded px-1.5 py-0.5 text-[10px] font-semibold border uppercase tracking-wider",
                                notif.urgency === "high" && "bg-destructive/10 text-destructive border-destructive/30",
                                notif.urgency === "medium" && "bg-warning/15 text-warning border-warning/30",
                                notif.urgency === "low" && "bg-primary/10 text-primary border-primary/30"
                              )}
                            >
                              {notif.urgency}
                            </span>
                            <span className="font-semibold text-foreground text-xs">{notif.title}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[10px] text-muted-foreground" suppressHydrationWarning>
                              {formatRelativeTime(notif.createdAt)}
                            </span>
                            {!notif.read && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => handleMarkNotificationRead(notif.id)}
                                className="text-[10px] h-6 px-2 border-border cursor-pointer"
                              >
                                Mark read
                              </Button>
                            )}
                          </div>
                        </div>
                        <p className="text-foreground leading-relaxed">{notif.message}</p>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border p-12 text-center text-xs text-muted-foreground bg-card">
              Select a run from the history to inspect its trajectory steps and findings.
            </div>
          )}
        </div>
      </div>

      {/* Scout Settings Dialog */}
      <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
        <DialogContent className="max-w-lg border border-border bg-card p-6 shadow-xl sm:rounded-xl max-h-[85vh] flex flex-col overflow-hidden">
          <DialogHeader className="shrink-0">
            <div className="flex items-center gap-2 text-primary">
              <SlidersHorizontal className="h-5 w-5" />
              <DialogTitle className="text-base font-bold text-foreground">
                Scout Configuration & Settings
              </DialogTitle>
            </div>
            <DialogDescription className="text-xs text-muted-foreground">
              Configure research parameters, autonomous polling schedule, and target queries for this scout.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs overflow-y-auto flex-1 pr-1">
            <div className="space-y-1.5">
              <Label htmlFor="scout-title" className="text-xs font-semibold text-foreground">
                Scout Title
              </Label>
              <Input
                id="scout-title"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="e.g. AI & DevTools Funding Tracker"
                className="h-8 text-xs"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scout-goal" className="text-xs font-semibold text-foreground">
                Target Research Goal
              </Label>
              <Textarea
                id="scout-goal"
                rows={3}
                value={editGoal}
                onChange={(e) => setEditGoal(e.target.value)}
                placeholder="e.g. Track seed and Series A funding rounds for developer tools..."
                className="text-xs resize-y min-h-[70px]"
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scout-frequency" className="text-xs font-semibold text-foreground">
                Adaptive Scent Polling Interval
              </Label>
              <select
                id="scout-frequency"
                value={editFrequency}
                onChange={(e) =>
                  setEditFrequency(e.target.value as "daily" | "every_3_days" | "weekly")
                }
                className="w-full rounded-md border border-border bg-card px-2.5 py-1.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary cursor-pointer"
              >
                <option value="daily">Daily (Adaptive Scent Decay, ~1440m base)</option>
                <option value="every_3_days">Every 3 Days (~4320m base)</option>
                <option value="weekly">Weekly (~10080m base)</option>
              </select>
            </div>

            <div className="flex items-center justify-between rounded-lg border border-border p-3 bg-card">
              <div className="space-y-0.5">
                <Label htmlFor="scout-active" className="text-xs font-semibold text-foreground cursor-pointer">
                  Autonomous Scent Polling
                </Label>
                <p className="text-[11px] text-muted-foreground">
                  When enabled, agent-worker daemon continuously polls targets on schedule.
                </p>
              </div>
              <Switch id="scout-active" checked={editIsActive} onCheckedChange={setEditIsActive} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="scout-queries" className="text-xs font-semibold text-foreground">
                Target Search Queries (comma-separated)
              </Label>
              <Input
                id="scout-queries"
                value={editSearchQueriesText}
                onChange={(e) => setEditSearchQueriesText(e.target.value)}
                placeholder="e.g. ai agent preprints, webwalker benchmark, browser agents"
                className="h-8 text-xs"
              />
            </div>

            {/* Notification & Dispatch Settings */}
            <div className="rounded-lg border border-border bg-muted/60 p-3 space-y-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Bell className="h-3.5 w-3.5 text-primary" />
                Notification & Alert Dispatch
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="scout-notify-email" className="text-[11px] font-semibold text-foreground">
                  Recipient Email (Optional Override)
                </Label>
                <Input
                  id="scout-notify-email"
                  type="email"
                  value={editNotifyEmail}
                  onChange={(e) => setEditNotifyEmail(e.target.value)}
                  placeholder="e.g. tracker@lab.org (leave empty to inherit Settings email)"
                  className="h-8 text-xs"
                />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1">
                <div className="space-y-0.5">
                  <div className="text-[11px] font-semibold text-foreground">
                    Notify on Research Goal Match
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Dispatch alerts when trajectory results satisfy the research goal.
                  </p>
                </div>
                <Switch checked={editNotifyOnGoalMatch} onCheckedChange={setEditNotifyOnGoalMatch} />
              </div>

              <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
                <div className="space-y-0.5">
                  <div className="text-[11px] font-semibold text-foreground">
                    Notify on Factual Drift & Novelty
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Dispatch instant alerts when novel propositions or shifts are detected.
                  </p>
                </div>
                <Switch checked={editNotifyOnDrift} onCheckedChange={setEditNotifyOnDrift} />
              </div>
            </div>

            {/* Danger Zone */}
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold text-destructive">Delete Scout</div>
                  <p className="text-[11px] text-muted-foreground">
                    Permanently delete this scout and all historical executions.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleDeleteScout}
                  disabled={isDeletingScout}
                  className="border-destructive/40 text-destructive hover:bg-destructive/15 text-xs font-semibold shrink-0 cursor-pointer"
                >
                  {isDeletingScout ? (
                    <Loader2 className="h-3 w-3 animate-spin mr-1" />
                  ) : (
                    <Trash2 className="h-3 w-3 mr-1" />
                  )}
                  Delete
                </Button>
              </div>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0 pt-3 border-t border-border shrink-0">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsSettingsOpen(false)}
              disabled={isSavingSettings}
              className="text-xs cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveSettings}
              disabled={isSavingSettings}
              className="text-xs font-semibold shadow-xs cursor-pointer gap-1.5"
            >
              {isSavingSettings ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving...
                </>
              ) : (
                <>
                  <Save className="h-3 w-3" />
                  Save Changes
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
