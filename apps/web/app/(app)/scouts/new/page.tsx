import Link from "next/link";
import { ScoutForm } from "@/components/scouts/scout-form";
import { ArrowLeft } from "lucide-react";

export default function NewScoutPage() {
  return (
    <div className="space-y-6">
      <div className="border-b border-border pb-4 space-y-1">
        <Link
          href="/scouts"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mb-1"
        >
          <ArrowLeft className="h-3 w-3" />
          Back to Scouts
        </Link>
        <h1 className="text-xl font-bold tracking-tight text-foreground">
          Create Research Scout
        </h1>
        <p className="text-xs text-muted-foreground">
          Configure an autonomous agent to crawl, extract atomic claims, and detect factual drift.
        </p>
      </div>

      <ScoutForm />
    </div>
  );
}

