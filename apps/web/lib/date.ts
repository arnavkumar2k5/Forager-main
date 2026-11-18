const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatDeterministicDateTime(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const year = d.getUTCFullYear();
    const month = MONTHS[d.getUTCMonth()];
    const day = String(d.getUTCDate()).padStart(2, "0");
    const hours = String(d.getUTCHours()).padStart(2, "0");
    const minutes = String(d.getUTCMinutes()).padStart(2, "0");
    return `${day} ${month} ${year}, ${hours}:${minutes} UTC`;
  } catch {
    return "-";
  }
}

export function formatDeterministicDate(dateStr?: string | null): string {
  if (!dateStr) return "-";
  try {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "-";
    const year = d.getUTCFullYear();
    const month = MONTHS[d.getUTCMonth()];
    const day = String(d.getUTCDate()).padStart(2, "0");
    return `${day} ${month} ${year}`;
  } catch {
    return "-";
  }
}

export function formatRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Never";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return "-";
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();

    if (diffMs < -30000) {
      const futureMins = Math.round(-diffMs / (1000 * 60));
      const futureHours = Math.round(futureMins / 60);
      const futureDays = Math.round(futureHours / 24);

      if (futureMins < 60) return `in ${futureMins}m`;
      if (futureHours < 24) return `in ${futureHours}h`;
      if (futureDays < 7) return `in ${futureDays}d`;
      const day = String(date.getUTCDate()).padStart(2, "0");
      const month = MONTHS[date.getUTCMonth()];
      return `on ${day} ${month}`;
    }

    const diffMins = Math.round(diffMs / (1000 * 60));
    const diffHours = Math.round(diffMins / 60);
    const diffDays = Math.round(diffHours / 24);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = MONTHS[date.getUTCMonth()];
    const year = date.getUTCFullYear();
    return `${day} ${month} ${year}`;
  } catch {
    return "-";
  }
}

export function formatFutureRelativeTime(dateStr?: string | null): string {
  if (!dateStr) return "Not scheduled";
  try {
    const target = new Date(dateStr);
    if (isNaN(target.getTime())) return "-";
    const now = new Date();
    const diffMs = target.getTime() - now.getTime();

    if (diffMs <= 0) {
      return "Due soon";
    }

    const diffMins = Math.round(diffMs / (1000 * 60));
    const diffHours = Math.round(diffMins / 60);
    const diffDays = Math.round(diffHours / 24);

    if (diffMins < 1) return "In moments";
    if (diffMins < 60) return `In ~${diffMins}m`;
    if (diffHours < 24) return `In ~${diffHours}h`;
    if (diffDays < 7) return `In ${diffDays}d`;

    const day = String(target.getUTCDate()).padStart(2, "0");
    const month = MONTHS[target.getUTCMonth()];
    return `On ${day} ${month}`;
  } catch {
    return "-";
  }
}

export function formatDuration(startStr: string, endStr?: string | null): string {
  if (!endStr) return "In progress...";
  try {
    const start = new Date(startStr).getTime();
    const end = new Date(endStr).getTime();
    const sec = Math.max(0, Math.round((end - start) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const rem = sec % 60;
    return `${min}m ${rem}s`;
  } catch {
    return "-";
  }
}

