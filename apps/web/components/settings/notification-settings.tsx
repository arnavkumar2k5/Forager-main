"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { Bell, Save, Loader2, Check } from "lucide-react";
import {
  getNotificationPreferences,
  saveNotificationPreferences,
} from "@/app/actions/settings";

export function NotificationSettings() {
  const [notifyOnComplete, setNotifyOnComplete] = useState(true);
  const [notifyOnDrift, setNotifyOnDrift] = useState(true);
  const [email, setEmail] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const prefs = await getNotificationPreferences();
        if (mounted) {
          setEmail(prefs.email || "");
          setNotifyOnComplete(prefs.notifyOnComplete);
          setNotifyOnDrift(prefs.notifyOnDrift);
        }
      } catch (err) {
        toast.error("Failed to load saved notification settings");
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    setIsSaved(false);

    try {
      const res = await saveNotificationPreferences({
        email,
        notifyOnComplete,
        notifyOnDrift,
      });

      setIsSaved(true);
      toast.success(
        res.email
          ? `Notification preferences saved. Recipient: ${res.email}`
          : "Notification preferences saved"
      );
      setTimeout(() => setIsSaved(false), 3000);
    } catch (err) {
      toast.error(
        (err as Error).message || "Failed to save notification preferences"
      );
    } finally {
      setIsSaving(false);
    }
  }

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin text-primary" />
        Loading notification preferences...
      </div>
    );
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-xl">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Bell className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          Alerts & Digest Dispatch
        </h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5 bg-card">
          <div className="space-y-0.5">
            <Label
              htmlFor="notify-complete"
              className="text-xs font-semibold text-foreground"
            >
              Trajectory Completion Alerts
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Receive a summary notification when an autonomous research loop
              finishes or verifies research goals.
            </p>
          </div>
          <Switch
            id="notify-complete"
            checked={notifyOnComplete}
            onCheckedChange={setNotifyOnComplete}
          />
        </div>

        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3.5 bg-card">
          <div className="space-y-0.5">
            <Label
              htmlFor="notify-drift"
              className="text-xs font-semibold text-foreground"
            >
              Factual Drift & Volatility Alerts
            </Label>
            <p className="text-[11px] text-muted-foreground">
              Trigger instant alerts when atomic proposition diffing detects
              novel facts or contradictory claims.
            </p>
          </div>
          <Switch
            id="notify-drift"
            checked={notifyOnDrift}
            onCheckedChange={setNotifyOnDrift}
          />
        </div>

        <div className="space-y-1.5 pt-2">
          <Label
            htmlFor="alert-email"
            className="text-xs font-semibold text-foreground"
          >
            Recipient Email Address
          </Label>
          <Input
            id="alert-email"
            type="email"
            placeholder="researcher@lab.org"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setIsSaved(false);
            }}
            className="text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            Where urgent scout updates and high-scent digests will be delivered.
            Saved in your user preferences.
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <Button
          type="submit"
          disabled={isSaving}
          className="text-xs font-semibold cursor-pointer shadow-xs"
        >
          {isSaving ? (
            <>
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              Saving...
            </>
          ) : isSaved ? (
            <>
              <Check className="mr-1.5 h-3.5 w-3.5 text-white" />
              Preferences Saved
            </>
          ) : (
            <>
              <Save className="mr-1.5 h-3.5 w-3.5" />
              Save Preferences
            </>
          )}
        </Button>
      </div>
    </form>
  );
}
