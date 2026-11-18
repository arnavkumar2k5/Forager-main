const TRACKING_QUERY_PREFIXES = ["utm_", "pd_rd_", "pf_rd_"];

const TRACKING_QUERY_PARAMS = new Set([
  "fbclid",
  "gclid",
  "msclkid",
  "mc_eid",
  "ref",
  "ref_",
  "source",
  "tag",
  "camp",
  "creative",
  "qid",
  "sr",
  "th",
  "psc",
  "keywords",
  "sprefix",
  "crid",
  "dib",
  "dib_tag",
  "marketplace",
  "qh",
  "lid",
  "spotlighttagid",
  "ppt",
  "ppn",
  "ssid",
  "_encoding",
]);

export function canonicalizeUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string") return null;
  const trimmed = rawUrl.trim();
  if (!trimmed || !trimmed.startsWith("http")) return null;

  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    parsed.hash = "";

    const hostname = parsed.hostname.toLowerCase();

    const amazonMatch = hostname.match(/^(?:www\.)?amazon\.([a-z.]{2,6})$/);
    if (amazonMatch) {
      const tld = amazonMatch[1];
      const asinMatch = parsed.pathname.match(
        /(?:\/(?:gp\/(?:product|aw\/d)|[^/]+\/dp|dp))\/(B[A-Z0-9]{9}|[0-9]{9}[0-9Xx])/i
      );
      if (asinMatch && asinMatch[1]) {
        const asin = asinMatch[1].toUpperCase();
        return `https://www.amazon.${tld}/dp/${asin}`;
      }
    }

    const flipkartMatch = hostname.match(/^(?:www\.)?flipkart\.com$/);
    if (flipkartMatch) {
      const pidMatch = parsed.pathname.match(/^\/([^/]+)\/p\/(itm[a-zA-Z0-9]+|[a-zA-Z0-9]+)/i);
      if (pidMatch && pidMatch[1] && pidMatch[2]) {
        return `https://www.flipkart.com/${pidMatch[1]}/p/${pidMatch[2]}`;
      }
    }

    const searchParams = new URLSearchParams(parsed.search);
    for (const param of Array.from(searchParams.keys())) {
      const lower = param.toLowerCase();
      const isPrefixMatch = TRACKING_QUERY_PREFIXES.some((prefix) => lower.startsWith(prefix));
      if (isPrefixMatch || TRACKING_QUERY_PARAMS.has(lower)) {
        searchParams.delete(param);
      }
    }

    const cleanSearch = searchParams.toString();
    parsed.search = cleanSearch ? `?${cleanSearch}` : "";

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.slice(0, -1);
    }

    return `${parsed.protocol}//${hostname}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

export function extractDirectUrls(text?: string): string[] {
  if (!text) return [];
  const urlRegex = /https?:\/\/[^\s)"]+/gi;
  const matches = text.match(urlRegex) || [];
  const canonicals = new Set<string>();

  for (const match of matches) {
    const cleaned = match.replace(/[.,;!?]+$/, "");
    const canonical = canonicalizeUrl(cleaned);
    if (canonical) {
      canonicals.add(canonical);
    }
  }

  return Array.from(canonicals);
}
