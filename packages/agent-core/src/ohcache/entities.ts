export interface ExtractedEntity {
  name: string;
  key: string;
}

const BRAND_PREFIXES = /\b(google|bytedance|alibaba|spacex|xai|runware|fal\.?ai|openrouter|black-forest-labs|bfl|kuaishou|openai)\b/gi;
const VERSION_AND_TIER_TOKENS = /\b([a-z]?\d+(\.\d+)*\w*|turbo|lite|pro|fast|max|ultra|plus|mini|standard|preview|exp|v2v|i2v|t2v|api|model|models|video|image|platform)\b/gi;

export function normalizeEntityKey(name: string): string {
  if (!name || !name.trim()) return "";
  const cleaned = name
    .replace(BRAND_PREFIXES, " ")
    .replace(VERSION_AND_TIER_TOKENS, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .toLowerCase()
    .trim();
  const tokens = cleaned.split(/\s+/).filter((t) => t.length > 1);
  return tokens.join("");
}

export function isMatchingEntity(keyA: string, keyB: string): boolean {
  if (!keyA || !keyB) return false;
  if (keyA === keyB) return true;
  if (keyA.length >= 3 && keyB.length >= 3) {
    if (keyA.startsWith(keyB) || keyB.startsWith(keyA)) return true;
  }
  return false;
}

export function extractEntityFromText(text: string): ExtractedEntity | null {
  if (!text || !text.trim()) return null;

  const markdownBoldMatch = text.match(/\*\*([^*]+)\*\*/);
  if (markdownBoldMatch && markdownBoldMatch[1]) {
    const raw = markdownBoldMatch[1].trim();
    if (raw.length >= 2 && raw.length <= 60 && !/^(source|pricing|specs|features|overview|focus|summary|details|cost)/i.test(raw)) {
      const key = normalizeEntityKey(raw);
      if (key.length >= 2) {
        return { name: raw, key };
      }
    }
  }

  const prefixColonMatch = text.match(/^([A-Za-z0-9\s\.\-_@\(\)]+?)(?:\s*\(.*?\))?:\s*(.+)/);
  if (prefixColonMatch && prefixColonMatch[1]) {
    const raw = prefixColonMatch[1].trim();
    if (raw.length >= 2 && raw.length <= 60 && !/^(source|pricing|specs|features|overview|focus|summary|details|cost|output pricing|input pricing|cost per video)/i.test(raw)) {
      const key = normalizeEntityKey(raw);
      if (key.length >= 2) {
        return { name: raw, key };
      }
    }
  }

  const subjectVerbMatch = text.match(/^([A-Z][A-Za-z0-9\s\.\-_@]+?)\s+(?:charges|offers|features|starts|started|priced|provides|costs|announced|released|raised|secured|lists|includes)\b/i);
  if (subjectVerbMatch && subjectVerbMatch[1]) {
    const raw = subjectVerbMatch[1].trim();
    if (raw.length >= 2 && raw.length <= 50 && !/^(several|many|various|based|recent|these|this|our|the)\b/i.test(raw)) {
      const key = normalizeEntityKey(raw);
      if (key.length >= 2) {
        return { name: raw, key };
      }
    }
  }

  return null;
}
