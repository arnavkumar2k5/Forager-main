"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { LogOut, User as UserIcon, ChevronsUpDown } from "lucide-react";

export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    try {
      const supabase = createClient();
      supabase.auth.getUser().then(({ data: { user }, error }) => {
        if (!mounted) return;
        if (!error && (user?.user_metadata?.notification_email || user?.email)) {
          setEmail((user.user_metadata?.notification_email as string) || user.email || null);
        }
        setLoading(false);
      }).catch(() => {
        if (mounted) setLoading(false);
      });
    } catch {
      if (mounted) setLoading(false);
    }
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSignOut() {
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
    } catch (err) {
      console.error("Sign out error:", err);
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  const initial = email ? email[0].toUpperCase() : "U";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="User account menu"
          className="group flex w-full items-center gap-2.5 rounded-lg border border-transparent p-1.5 text-left transition-all hover:bg-accent hover:border-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring cursor-pointer"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary border border-primary/20">
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-medium text-foreground">
              {loading ? "Loading..." : email || "Local Researcher"}
            </p>
            <p className="truncate text-[10px] text-muted-foreground">
              Active Workspace
            </p>
          </div>
          <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground opacity-60 group-hover:opacity-100 shrink-0" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-56 rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
      >
        <DropdownMenuLabel className="font-normal text-xs text-muted-foreground px-2 py-1.5">
          <span>Signed in as</span>
          <div className="truncate font-semibold text-xs text-foreground mt-0.5">
            {email || "local@forager.internal"}
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          onClick={() => router.push("/settings")}
          className="cursor-pointer text-xs text-foreground focus:bg-accent flex items-center px-2 py-1.5 rounded-md"
        >
          <UserIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
          Account & Keys
        </DropdownMenuItem>
        <DropdownMenuSeparator className="bg-border" />
        <DropdownMenuItem
          onClick={handleSignOut}
          className="cursor-pointer text-xs text-destructive focus:bg-destructive/10 focus:text-destructive flex items-center px-2 py-1.5 rounded-md font-medium"
        >
          <LogOut className="mr-2 h-3.5 w-3.5" />
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
