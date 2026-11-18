import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function extractCleanDomain(rawUrlOrDomain?: string | null): string | null {
  if (!rawUrlOrDomain || typeof rawUrlOrDomain !== "string") return null;
  const trimmed = rawUrlOrDomain.trim();
  if (!trimmed || trimmed.startsWith("urn:")) return null;

  try {
    const withProto = trimmed.includes("://") ? trimmed : `https://${trimmed}`;
    const parsed = new URL(withProto);
    let host = parsed.hostname.toLowerCase();
    if (host.startsWith("www.")) host = host.slice(4);
    const parts = host.split(".").filter(Boolean);
    if (parts.length >= 2) {
      const secondTld = parts[parts.length - 2];
      if (parts.length >= 3 && ["co", "com", "org", "gov", "edu", "net"].includes(secondTld)) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    }
    return host || null;
  } catch {}

  const clean = trimmed
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, "")
    .split("/")[0]
    .split(":")[0]
    .replace(/^www\./, "");
  if (clean.includes(".")) {
    const parts = clean.split(".").filter(Boolean);
    if (parts.length >= 2) {
      const secondTld = parts[parts.length - 2];
      if (parts.length >= 3 && ["co", "com", "org", "gov", "edu", "net"].includes(secondTld)) {
        return parts.slice(-3).join(".");
      }
      return parts.slice(-2).join(".");
    }
    return clean;
  }
  return null;
}
