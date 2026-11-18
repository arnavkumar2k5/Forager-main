"use client";

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import {
  Key,
  Eye,
  EyeOff,
  CheckCircle2,
  Save,
  Server,
  AlertCircle,
  RefreshCw,
} from "lucide-react";
import { checkWorkerHealth, type WorkerHealthInfo } from "@/lib/agent-worker";
import { getApiSettings, saveApiSettings } from "@/app/actions/settings";

export function ApiKeySettings() {
  const [showKey, setShowKey] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [provider, setProvider] = useState("gemini");
  const [isTesting, setIsTesting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [workerStatus, setWorkerStatus] = useState<"unknown" | "online" | "offline">("unknown");
  const [workerInfo, setWorkerInfo] = useState<WorkerHealthInfo | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const [settings, health] = await Promise.allSettled([
          getApiSettings(),
          checkWorkerHealth(),
        ]);

        if (!mounted) return;

        if (settings.status === "fulfilled") {
          setApiKey(settings.value.firecrawlApiKey || "");
          setProvider(settings.value.preferredProvider || "gemini");
        }

        if (health.status === "fulfilled") {
          setWorkerStatus("online");
          setWorkerInfo(health.value);
        } else {
          setWorkerStatus("offline");
        }
      } catch {
        if (mounted) setWorkerStatus("offline");
      } finally {
        if (mounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      mounted = false;
    };
  }, []);

  async function handleTestConnection() {
    setIsTesting(true);
    try {
      const health = await checkWorkerHealth();
      setWorkerStatus("online");
      setWorkerInfo(health);
      toast.success(
        `Agent worker online (Model: ${health.model || "default"}, Uptime: ${Math.round(health.uptime)}s)`
      );
    } catch (err) {
      setWorkerStatus("offline");
      setWorkerInfo(null);
      toast.error(`Connection check failed: ${(err as Error).message}`);
    } finally {
      setIsTesting(false);
    }
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setIsSaving(true);
    try {
      await saveApiSettings({
        firecrawlApiKey: apiKey.trim(),
        preferredProvider: provider,
      });
      toast.success("API credentials saved successfully");
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <form onSubmit={handleSave} className="space-y-6 max-w-xl">
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <Key className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold text-foreground">
          Scraping & Agent Worker Credentials
        </h2>
      </div>

      <div className="space-y-4">
        {/* Firecrawl Key */}
        <div className="space-y-1.5">
          <Label htmlFor="firecrawl-key" className="text-xs font-semibold text-foreground">
            Firecrawl API Key
          </Label>
          <div className="relative">
            <Input
              id="firecrawl-key"
              type={showKey ? "text" : "password"}
              autoComplete="off"
              placeholder="fc-..."
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              className="pr-10 text-xs font-mono"
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              title={showKey ? "Hide key" : "Show key"}
            >
              {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Used by the research agent for clean webpage parsing and data extraction.
          </p>
        </div>

        {/* LLM Provider Selection */}
        <div className="space-y-1.5">
          <Label htmlFor="provider-select" className="text-xs font-semibold text-foreground">
            Preferred AI Model Provider
          </Label>
          <select
            id="provider-select"
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            className="w-full rounded-md border border-border bg-card px-3 py-1.5 text-xs text-foreground focus:outline-hidden focus:ring-1 focus:ring-primary"
          >
            <option value="gemini">Google Gemini (Recommended)</option>
            <option value="openai">OpenAI (GPT-4o / GPT-4o-mini)</option>
            <option value="groq">Groq (Llama 3.3 Fast Inference)</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            AI model powering autonomous web browsing, content analysis, and fact extraction.
          </p>
        </div>

        {/* Worker Daemon Status Card */}
        <div className="rounded-lg border border-border bg-card p-3.5 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Server className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-semibold text-foreground">
                  Agent Engine Status
                </span>
              </div>
              <div className="text-[11px] text-muted-foreground mt-0.5">
                Local background engine at http://localhost:4000
              </div>
            </div>

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleTestConnection}
              disabled={isTesting}
              className="text-xs border-border cursor-pointer gap-1.5"
            >
              <RefreshCw className={`h-3 w-3 ${isTesting ? "animate-spin" : ""}`} />
              {isTesting ? "Testing..." : "Test Connection"}
            </Button>
          </div>

          {workerStatus !== "unknown" && (
            <div
              className={`rounded-md p-3 text-xs space-y-2 border ${
                workerStatus === "online"
                  ? "bg-success/10 text-success border-success/30"
                  : "bg-destructive/10 text-destructive border-destructive/30"
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5 font-semibold">
                  {workerStatus === "online" ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : (
                    <AlertCircle className="h-3.5 w-3.5" />
                  )}
                  <span>
                    {workerStatus === "online"
                      ? "Engine Online & Responsive"
                      : "Engine Unreachable (Port 4000)"}
                  </span>
                </div>

                {workerInfo?.uptime !== undefined && (
                  <span className="text-[10px] font-mono opacity-80">
                    Uptime: {Math.round(workerInfo.uptime)}s
                  </span>
                )}
              </div>

              {workerStatus === "online" && workerInfo && (
                <div className="grid grid-cols-2 gap-2 pt-1 border-t border-success/20 text-[11px] text-foreground">
                  <div>
                    <span className="text-muted-foreground">Active Model: </span>
                    <span className="font-mono font-medium">{workerInfo.model || "gemini-3.5-flash-lite"}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Automated Checks: </span>
                    <span className="font-semibold text-success">
                      {workerInfo.schedulerRunning ? "Active" : "Paused"}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Button
        type="submit"
        disabled={isSaving || isLoading}
        className="text-xs font-semibold shadow-xs cursor-pointer"
      >
        <Save className="mr-1.5 h-3.5 w-3.5" />
        {isSaving ? "Saving..." : "Save Configuration"}
      </Button>
    </form>
  );
}
