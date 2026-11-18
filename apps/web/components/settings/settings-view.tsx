"use client";

import { useState } from "react";
import { NotificationSettings } from "@/components/settings/notification-settings";
import { ApiKeySettings } from "@/components/settings/api-key-settings";
import { cn } from "@/lib/utils";
import { Bell, Key } from "lucide-react";

export function SettingsView() {
  const [activeTab, setActiveTab] = useState<"notifications" | "api">("notifications");

  return (
    <div className="space-y-6 pb-12">
      <div className="flex border-b border-border">
        <button
          type="button"
          onClick={() => setActiveTab("notifications")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer",
            activeTab === "notifications"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Bell className="h-3.5 w-3.5" />
          Notifications & Alerts
        </button>

        <button
          type="button"
          onClick={() => setActiveTab("api")}
          className={cn(
            "flex items-center gap-2 border-b-2 px-4 py-2.5 text-xs font-semibold transition-colors cursor-pointer",
            activeTab === "api"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          <Key className="h-3.5 w-3.5" />
          Scraping & Worker API
        </button>
      </div>

      <div className="pt-2">
        {activeTab === "notifications" && <NotificationSettings />}
        {activeTab === "api" && <ApiKeySettings />}
      </div>
    </div>
  );
}

