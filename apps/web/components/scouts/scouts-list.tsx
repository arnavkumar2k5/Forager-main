"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { useScoutsRealtime, type ScoutItem } from "@/hooks/use-scouts-realtime";
import { ScoutCard } from "@/components/scouts/scout-card";
import { Plus, Compass, Search, Filter, Sparkles } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ScoutsListProps {
  initialScouts: ScoutItem[];
}

export function ScoutsList({ initialScouts }: ScoutsListProps) {
  const { scouts } = useScoutsRealtime(initialScouts);
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "running" | "idle">("all");

  const filteredScouts = useMemo(() => {
    return scouts.filter((scout) => {
      const matchesSearch =
        scout.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
        scout.goal.toLowerCase().includes(searchQuery.toLowerCase());

      const matchesStatus =
        statusFilter === "all" ||
        (statusFilter === "running" && scout.status === "running") ||
        (statusFilter === "idle" && (scout.status === "idle" || scout.status === "completed"));

      return matchesSearch && matchesStatus;
    });
  }, [scouts, searchQuery, statusFilter]);

  const activeCount = scouts.filter((s) => s.isActive).length;

  if (scouts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-12 text-center bg-muted/30">
        <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary mb-3">
          <Compass className="h-6 w-6" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">No research scouts yet</h3>
        <p className="mt-1 text-xs text-muted-foreground max-w-sm">
          Scouts autonomously explore web targets, extract atomic propositions, and alert you when facts drift.
        </p>
        <Link
          href="/scouts/new"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90 transition-colors shadow-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Create First Scout
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Search and filter toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Filter scouts by name or goal..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 text-xs h-8"
          />
        </div>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setStatusFilter("all")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer ${statusFilter === "all"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
              }`}
          >
            All ({scouts.length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("running")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer ${statusFilter === "running"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
              }`}
          >
            Active ({activeCount})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter("idle")}
            className={`rounded-md px-2.5 py-1 text-xs font-medium border transition-colors cursor-pointer ${statusFilter === "idle"
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"
              }`}
          >
            Idle ({scouts.length - activeCount})
          </button>
        </div>
      </div>

      {/* Scout list */}
      {filteredScouts.length === 0 ? (
        <div className="rounded-lg border border-border bg-card p-8 text-center text-xs text-muted-foreground">
          No scouts match your search query &ldquo;{searchQuery}&rdquo;.
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setStatusFilter("all");
            }}
            className="ml-2 font-medium text-primary hover:underline cursor-pointer"
          >
            Reset filters
          </button>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredScouts.map((scout) => (
            <ScoutCard key={scout.id} scout={scout} />
          ))}
        </div>
      )}
    </div>
  );
}
