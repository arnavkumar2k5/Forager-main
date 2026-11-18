export type ScoutStatusVariant = "running" | "completed" | "failed" | "idle" | "queued";

export interface ScoutStatusMeta {
  label: string;
  dotClass: string;
  textClass: string;
}

export function getScoutStatusMeta(status?: string | null): ScoutStatusMeta {
  switch (status?.toLowerCase()) {
    case "running":
      return {
        label: "Running",
        dotClass: "bg-primary animate-pulse",
        textClass: "text-primary",
      };
    case "completed":
      return {
        label: "Completed",
        dotClass: "bg-success",
        textClass: "text-success",
      };
    case "failed":
      return {
        label: "Failed",
        dotClass: "bg-destructive",
        textClass: "text-destructive",
      };
    case "queued":
      return {
        label: "Queued",
        dotClass: "bg-warning",
        textClass: "text-warning",
      };
    case "idle":
    default:
      return {
        label: "Idle",
        dotClass: "bg-muted-foreground",
        textClass: "text-muted-foreground",
      };
  }
}

