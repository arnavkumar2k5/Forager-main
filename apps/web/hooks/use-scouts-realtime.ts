"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ScoutItem {
  id: string;
  userId?: string;
  title: string;
  goal: string;
  schedule?: string;
  status: string;
  isActive?: boolean;
  createdAt: string;
  updatedAt?: string;
  lastRunAt?: string | null;
}

interface RawScoutRow {
  id: string;
  user_id?: string;
  userId?: string;
  title?: string | null;
  goal?: string | null;
  description?: string | null;
  frequency?: string | null;
  schedule?: string | null;
  status?: string | null;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  updatedAt?: string;
  last_run_at?: string | null;
  lastRunAt?: string | null;
  is_active?: boolean;
}

function normalizeScout(row: RawScoutRow): ScoutItem {
  return {
    id: row.id,
    userId: row.user_id || row.userId || "",
    title: row.title || row.description || "Untitled Scout",
    goal: row.goal || row.description || "",
    schedule: row.frequency || row.schedule || "manual",
    status: row.status || "idle",
    isActive: Boolean(row.is_active),
    createdAt: row.created_at || row.createdAt || new Date().toISOString(),
    updatedAt: row.updated_at || row.updatedAt,
    lastRunAt: row.last_run_at || row.lastRunAt || null,
  };
}

export function useScoutsRealtime(initialScouts: ScoutItem[] = []) {
  const [scouts, setScouts] = useState<ScoutItem[]>(initialScouts);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    setScouts(initialScouts);
  }, [initialScouts]);

  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel("scouts_realtime_channel")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "scouts" },
        (payload) => {
          if (payload.eventType === "INSERT") {
            const newScout = normalizeScout(payload.new as RawScoutRow);
            setScouts((prev) => [newScout, ...prev.filter((s) => s.id !== newScout.id)]);
          } else if (payload.eventType === "UPDATE") {
            const updated = normalizeScout(payload.new as RawScoutRow);
            setScouts((prev) =>
              prev.map((s) => (s.id === updated.id ? { ...s, ...updated } : s))
            );
          } else if (payload.eventType === "DELETE") {
            const deletedId = (payload.old as { id?: string })?.id;
            if (deletedId) {
              setScouts((prev) => prev.filter((s) => s.id !== deletedId));
            }
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  return { scouts, setScouts, isLoading, setIsLoading };
}

