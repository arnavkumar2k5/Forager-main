"use client";

import { useState } from "react";
import Link from "next/link";
import { type ScoutItem } from "@/hooks/use-scouts-realtime";
import { getScoutStatusMeta } from "@/hooks/use-scout-status";
import { triggerScoutRun } from "@/app/actions/scouts";
import { cn } from "@/lib/utils";
import { Clock, ArrowRight, Activity, Calendar, Play, Loader2 } from "lucide-react";
import { formatRelativeTime } from "@/lib/date";
import { toast } from "sonner";

interface ScoutCardProps {
  scout: ScoutItem;
}

export function ScoutCard({ scout }: ScoutCardProps) {
  const [isStarting, setIsStarting] = useState(false);
  const statusMeta = getScoutStatusMeta(scout.status);
  const isRunning = isStarting || scout.status === "running";

  async function handleQuickRun(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsStarting(true);
    try {
      toast.info(`Checking updates for "${scout.title}"...`);
      await triggerScoutRun({
        scoutId: scout.id,
        query: scout.goal || scout.title,
        goal: scout.goal || scout.title,
        title: scout.title,
        maxSteps: 10,
      });
      toast.success("Check initiated");
    } catch (err) {
      toast.error(`Run dispatch failed: ${(err as Error).message}`);
    } finally {
      setIsStarting(false);
    }
  }

  return (
    <Link
      href={`/scouts/${scout.id}`}
      className={cn(
        "group relative block rounded-xl border bg-card p-4 transition-all hover:shadow-md",
        isRunning
          ? "border-primary/50 ring-1 ring-primary/20 shadow-xs"
          : "border-border hover:border-muted-foreground/60"
      )}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2.5 min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="relative flex h-2 w-2 shrink-0">
              {isRunning && (
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
              )}
              <span
                className={cn(
                  "relative inline-flex h-2 w-2 rounded-full",
                  isRunning ? "bg-primary" : statusMeta.dotClass
                )}
              />
            </span>

            <h2 className="truncate text-sm font-semibold text-foreground group-hover:text-primary transition-colors">
              {scout.title}
            </h2>

            <span className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              <Calendar className="h-2.5 w-2.5 text-muted-foreground" />
              {scout.schedule === "daily" ? "Daily" : scout.schedule === "every_3_days" ? "Every 3 Days" : scout.schedule === "weekly" ? "Weekly" : "Manual"}
            </span>

            <span
              className={cn(
                "rounded-md px-1.5 py-0.5 text-[10px] font-medium border",
                scout.isActive
                  ? "bg-success/15 text-success border-success/30 font-semibold"
                  : "bg-muted text-muted-foreground border-border"
              )}
            >
              {scout.isActive ? "Active" : "Paused"}
            </span>
          </div>

          <p className="line-clamp-2 text-xs text-muted-foreground leading-relaxed">
            {scout.goal || "No specific goal defined."}
          </p>

          <div className="flex flex-wrap items-center gap-4 pt-0.5 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1 font-sans" suppressHydrationWarning>
              <Clock className="h-3 w-3 text-muted-foreground" />
              {scout.lastRunAt
                ? `Last checked ${formatRelativeTime(scout.lastRunAt)}`
                : `Created ${formatRelativeTime(scout.createdAt)}`}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 self-center shrink-0">
          <button
            type="button"
            onClick={handleQuickRun}
            disabled={isStarting}
            title="Check for updates now"
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground hover:text-primary hover:border-primary/40 hover:bg-primary/5 transition-all cursor-pointer shadow-2xs disabled:opacity-50"
          >
            {isStarting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </button>

          <div className="flex h-8 w-8 items-center justify-center text-muted-foreground group-hover:text-primary group-hover:translate-x-0.5 transition-all">
            <ArrowRight className="h-4 w-4" />
          </div>
        </div>
      </div>
    </Link>
  );
}
