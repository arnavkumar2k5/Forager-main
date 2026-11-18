"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Compass, Settings, Plus, Sparkles, Activity } from "lucide-react";
import { UserMenu } from "@/components/shell/user-menu";
import { checkWorkerHealth } from "@/lib/agent-worker";

interface NavItem {
  label: string;
  href: string;
  icon: typeof Compass;
  matchPrefix?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  {
    label: "Scouts",
    href: "/scouts",
    icon: Compass,
    matchPrefix: true,
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    matchPrefix: false,
  },
];

export function Sidebar() {
  const pathname = usePathname();
  const [workerOnline, setWorkerOnline] = useState<boolean | null>(null);

  useEffect(() => {
    let mounted = true;
    checkWorkerHealth()
      .then(() => {
        if (mounted) setWorkerOnline(true);
      })
      .catch(() => {
        if (mounted) setWorkerOnline(false);
      });

    const interval = setInterval(() => {
      checkWorkerHealth()
        .then(() => {
          if (mounted) setWorkerOnline(true);
        })
        .catch(() => {
          if (mounted) setWorkerOnline(false);
        });
    }, 15000);

    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, []);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col justify-between bg-muted p-3 select-none">
      <div className="space-y-4">
        {/* Brand header */}
        <div className="flex items-center justify-between px-2 pt-1 pb-2 border-b border-border">
          <Link href="/scouts" className="flex items-center gap-2 group">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary text-primary-foreground shadow-xs group-hover:bg-primary/90 transition-colors">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <span className="text-[14px] font-bold tracking-tight text-foreground block leading-none">
                Forager
              </span>
              <span className="text-[10px] text-muted-foreground font-medium leading-tight">
                Autonomous Scout
              </span>
            </div>
          </Link>

          <Link
            href="/scouts/new"
            title="Create New Scout"
            className="flex h-7 w-7 items-center justify-center rounded-md border border-border bg-card text-foreground hover:bg-accent hover:text-primary hover:border-primary/30 transition-all shadow-xs"
          >
            <Plus className="h-4 w-4" />
          </Link>
        </div>

        {/* Primary navigation */}
        <nav className="space-y-1">
          {NAV_ITEMS.map((item) => {
            const isActive = item.matchPrefix
              ? pathname === item.href || (pathname.startsWith(item.href + "/") && item.href !== "/")
              : pathname === item.href;
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center justify-between rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors",
                  isActive
                    ? "bg-card text-primary shadow-xs border border-border"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground border border-transparent"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <Icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                  <span>{item.label}</span>
                </div>
                {item.label === "Scouts" && (
                  <span className="flex h-2 w-2 rounded-full bg-success ring-2 ring-background" />
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* Footer / Account section */}
      <div className="space-y-2 border-t border-border pt-2">
        <div className="px-2 py-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="flex items-center gap-1.5 font-medium">
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                workerOnline === true
                  ? "bg-success"
                  : workerOnline === false
                  ? "bg-destructive"
                  : "bg-warning animate-pulse"
              )}
            />
            <span>Agent Engine</span>
          </span>
          <span className="text-[10px] font-mono text-muted-foreground">
            {workerOnline === true
              ? "Online"
              : workerOnline === false
              ? "Offline"
              : "Checking..."}
          </span>
        </div>
        <UserMenu />
      </div>
    </aside>
  );
}
