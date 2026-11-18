"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createAndRunScout } from "@/app/actions/scouts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Loader2, Sparkles, Compass, Lightbulb, Bell, Target, SlidersHorizontal } from "lucide-react";

interface ScoutPreset {
  label: string;
  title: string;
  goal: string;
  searchQueries: string[];
  schedule: "daily" | "every_3_days" | "weekly";
}

const PRESETS: ScoutPreset[] = [
  {
    label: "DevTools Funding",
    title: "AI & DevTools Funding Rounds",
    goal: "Monitor tech blogs and news for seed and Series A funding rounds in developer tools and autonomous agents announced recently. Extract company name, amount raised, and lead investor.",
    searchQueries: ["developer tools seed round funding", "ai agent startup series a funding"],
    schedule: "daily",
  },
  {
    label: "Web Agent Benchmarks",
    title: "Web Agents & Evaluation Papers",
    goal: "Search recent arXiv preprints and benchmark leaderboards for web navigation agents, browser automation benchmarks (WebWalker, Mind2Web), and trajectory evaluation. Extract paper title, authors, benchmark used, and reported score.",
    searchQueries: ["webwalker browser agent benchmark", "mind2web web navigation evaluation"],
    schedule: "daily",
  },
  {
    label: "LLM API Pricing",
    title: "Frontier LLM Pricing & Context Windows",
    goal: "Track pricing and context window changes across OpenAI, Anthropic, Google, and Groq pricing pages. Report input/output price per million tokens and major updates.",
    searchQueries: ["openai api pricing updates", "anthropic claude pricing per million tokens"],
    schedule: "every_3_days",
  },
  {
    label: "Zero-Day CVEs",
    title: "Zero-Day Vulnerability Alerts",
    goal: "Monitor security advisories and CVE databases for actively exploited zero-day vulnerabilities in cloud infrastructure and developer runtimes.",
    searchQueries: ["active zero day cve advisory", "cisa known exploited vulnerabilities"],
    schedule: "daily",
  },
];

export function ScoutForm() {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const [searchQueriesText, setSearchQueriesText] = useState("");
  const [maxSteps, setMaxSteps] = useState(8);
  const [schedule, setSchedule] = useState<"daily" | "every_3_days" | "weekly">("daily");
  const [notifyEmail, setNotifyEmail] = useState("");
  const [notifyOnGoalMatch, setNotifyOnGoalMatch] = useState(true);
  const [notifyOnDrift, setNotifyOnDrift] = useState(true);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function applyPreset(preset: ScoutPreset) {
    setTitle(preset.title);
    setGoal(preset.goal);
    setSearchQueriesText(preset.searchQueries.join(", "));
    setSchedule(preset.schedule);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim() || !goal.trim()) {
      setError("Please fill out both the title and research goal.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const parsedQueries = searchQueriesText
      .split(/[,\n]/)
      .map((q) => q.trim())
      .filter((q) => q.length > 0);

    try {
      const result = await createAndRunScout({
        title: title.trim(),
        goal: goal.trim(),
        schedule,
        maxSteps: Number(maxSteps) || 8,
        searchQueries: parsedQueries,
        location: {
          notifyEmail: notifyEmail.trim(),
          notifyOnGoalMatch,
          notifyOnDrift,
        },
      });

      toast.success("Scout created and first check started");
      router.push(`/scouts/${result.scoutId}`);
    } catch (err) {
      const message = (err as Error).message || "Failed to create scout";
      setError(message);
      toast.error(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-6 pb-12">
      {/* Quick Research Templates */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-2.5 shadow-2xs">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
          <Lightbulb className="h-4 w-4 text-warning" />
          Quick Research Templates
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((preset) => (
            <button
              key={preset.label}
              type="button"
              onClick={() => applyPreset(preset)}
              className="rounded-lg border border-border bg-muted/50 px-3 py-1.5 text-xs font-medium text-foreground hover:border-primary hover:text-primary hover:bg-card transition-all cursor-pointer shadow-2xs"
            >
              + {preset.label}
            </button>
          ))}
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {error && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive font-mono">
            {error}
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="title" className="text-xs font-semibold text-foreground">
            Scout Name
          </Label>
          <Input
            id="title"
            placeholder="e.g., AI Funding Rounds Tracker"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={isSubmitting}
            required
            className="text-xs h-9"
          />
          <p className="text-[11px] text-muted-foreground">
            A concise name for what you want this scout to monitor.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="goal" className="text-xs font-semibold text-foreground">
            What to Monitor & Target Criteria
          </Label>
          <Textarea
            id="goal"
            rows={4}
            placeholder="e.g., Track seed and Series A funding rounds for developer tools announced this week. Extract company name, amount raised, and lead investor."
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={isSubmitting}
            required
            className="text-xs resize-y min-h-[90px] leading-relaxed"
          />
          <p className="text-[11px] text-muted-foreground">
            The instructions and goals guiding the agent on what to look for and extract.
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="schedule" className="text-xs font-semibold text-foreground">
            Check Frequency
          </Label>
          <select
            id="schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value as "daily" | "every_3_days" | "weekly")}
            disabled={isSubmitting}
            className="flex h-9 w-full rounded-md border border-input bg-card px-3 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring cursor-pointer"
          >
            <option value="daily">Daily (Recommended)</option>
            <option value="every_3_days">Every 3 Days</option>
            <option value="weekly">Weekly</option>
          </select>
          <p className="text-[11px] text-muted-foreground">
            How often the scout checks online sources for new developments.
          </p>
        </div>

        {/* Toggle Advanced Trajectory Parameters */}
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setShowAdvanced(!showAdvanced)}
            className="flex items-center gap-1.5 text-xs font-semibold text-primary hover:underline cursor-pointer"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
            {showAdvanced ? "Hide Advanced Options" : "Show Advanced Options (Starting URLs, Exploration Depth)"}
          </button>
        </div>

        {showAdvanced && (
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="seed-queries" className="text-xs font-semibold text-foreground">
                Starting Websites or Search Keywords (Optional)
              </Label>
              <Input
                id="seed-queries"
                placeholder="e.g. https://news.ycombinator.com, techcrunch.com, ai agent preprints"
                value={searchQueriesText}
                onChange={(e) => setSearchQueriesText(e.target.value)}
                disabled={isSubmitting}
                className="text-xs h-9"
              />
              <p className="text-[11px] text-muted-foreground">
                Give the agent specific starting points or queries to prioritize first.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="max-steps" className="text-xs font-semibold text-foreground">
                Maximum Search Depth
              </Label>
              <Input
                id="max-steps"
                type="number"
                min={3}
                max={15}
                value={maxSteps}
                onChange={(e) => setMaxSteps(Number(e.target.value))}
                disabled={isSubmitting}
                className="text-xs h-9 max-w-xs font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                Maximum number of pages explored per check before generating the report (Default: 8).
              </p>
            </div>
          </div>
        )}

        {/* Notification Settings */}
        <div className="rounded-xl border border-border bg-card p-4 space-y-3.5 shadow-2xs">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Bell className="h-4 w-4 text-primary" />
            Notification & Alert Dispatch
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="scout-email" className="text-xs font-semibold text-foreground">
              Recipient Email Address (Optional)
            </Label>
            <Input
              id="scout-email"
              type="email"
              placeholder="e.g., researcher@lab.org (leave empty to use account email)"
              value={notifyEmail}
              onChange={(e) => setNotifyEmail(e.target.value)}
              disabled={isSubmitting}
              className="text-xs h-9"
            />
            <p className="text-[11px] text-muted-foreground">
              Where urgent findings and digest notifications will be delivered for this scout.
            </p>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-foreground">
                Notify on Research Goal Match
              </div>
              <p className="text-[11px] text-muted-foreground">
                Send notification when trajectory completes and satisfies the research goal.
              </p>
            </div>
            <Switch
              checked={notifyOnGoalMatch}
              onCheckedChange={setNotifyOnGoalMatch}
              disabled={isSubmitting}
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border">
            <div className="space-y-0.5">
              <div className="text-xs font-semibold text-foreground">
                Notify on Factual Drift & Novelty
              </div>
              <p className="text-[11px] text-muted-foreground">
                Send instant alerts when novel propositions or factual changes are detected.
              </p>
            </div>
            <Switch
              checked={notifyOnDrift}
              onCheckedChange={setNotifyOnDrift}
              disabled={isSubmitting}
            />
          </div>
        </div>

        <div className="pt-2">
          <Button
            type="submit"
            disabled={isSubmitting}
            className="text-xs font-semibold shadow-xs cursor-pointer gap-1.5 h-9 px-4"
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Launching Scout Trajectory...
              </>
            ) : (
              <>
                <Sparkles className="h-3.5 w-3.5" />
                Create & Run Scout
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
