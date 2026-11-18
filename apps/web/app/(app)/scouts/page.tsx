import Link from "next/link";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { ScoutsList } from "@/components/scouts/scouts-list";
import { type ScoutItem } from "@/hooks/use-scouts-realtime";
import { Plus, Compass, Activity, ShieldCheck } from "lucide-react";

export const instant = false;

export default async function ScoutsPage() {
  await connection();
  const supabase = await createClient();
  const { data: rawScouts, error } = await supabase
    .from("scouts")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("Failed to load scouts:", error.message);
  }

  const initialScouts: ScoutItem[] = (rawScouts || []).map((row) => ({
    id: row.id,
    userId: row.user_id,
    title: row.title || row.description || "Untitled Scout",
    goal: row.goal || row.description || "",
    schedule: row.frequency || "daily",
    status: row.status || "idle",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || "1970-01-01T00:00:00.000Z",
    updatedAt: row.updated_at,
    lastRunAt: row.last_run_at,
  }));

  const activeMonitoringCount = initialScouts.filter((s) => s.isActive).length;

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-xl font-bold tracking-tight text-foreground">Scouts</h1>
            <span className="rounded-full bg-muted border border-border px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {initialScouts.length}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            Automated monitors tracking web sources and notifying you when data changes.
          </p>
        </div>

        <Link
          href="/scouts/new"
          className="inline-flex items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs shrink-0 cursor-pointer"
        >
          <Plus className="h-3.5 w-3.5" />
          New Scout
        </Link>
      </div>

      {/* Overview Stat Badges */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-card border border-border text-primary shrink-0">
            <Compass className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground leading-tight">{initialScouts.length}</div>
            <div className="text-[10px] text-muted-foreground">Monitored Topics</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-card border border-border text-success shrink-0">
            <Activity className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-success leading-tight">{activeMonitoringCount} Active</div>
            <div className="text-[10px] text-muted-foreground">Active Monitors</div>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-card/50 p-3 flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-md bg-card border border-border text-muted-foreground shrink-0">
            <ShieldCheck className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-bold text-foreground leading-tight">Automated Checks</div>
            <div className="text-[10px] text-muted-foreground">Source Verification</div>
          </div>
        </div>
      </div>

      {/* Interactive Scouts List */}
      <ScoutsList initialScouts={initialScouts} />
    </div>
  );
}
