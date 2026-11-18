import crypto from "node:crypto";
import { Proposition } from "@repo/types";
import { extractEntityFromText } from "./entities";

const SUBORDINATE_ATTRIBUTE_REGEX =
  /^(pricing|price|input pricing|output pricing|cost|cost per video|specs|specification|specifications|features|key focus|focus|resolution|clip length|audio|rate|format|duration|lead investor|investor|investors|valuation|raised|funding|founded|headquarters|location|founder|founders|current price|original price|discount|availability|tier|credits):/i;

const NON_FACTUAL_HEADER_REGEX =
  /^[A-Za-z0-9\s&/,\-–—]+(rounds?|discoveries|findings|overview|baseline|status shifts?|models?|apis?|platform|platforms?|plans?)$/i;

export function extractAtomicPropositionsFromText(
  rawText: string,
  sourceUrl: string,
  scoutId: string,
  executionId?: string
): Proposition[] {
  if (!rawText || !rawText.trim()) return [];

  const noHtml = rawText.replace(/<[^>]+>/g, " ");
  const rawLines = noHtml.split(/\r?\n+/);
  const candidates: string[] = [];

  let currentEntityContext = "";

  for (const rawLine of rawLines) {
    let line = rawLine.trim();
    if (!line) continue;

    const isSubBullet = /^\s{2,}|\t/.test(rawLine);

    line = line.replace(/^[#\*\-\•\d+\.]+\s*/, "").trim();
    line = line.replace(/[*_~`]/g, "").trim();
    if (!line) continue;

    if (
      /^(source|sources|link|links|url|overview|summary|status shift|changes|new discoveries|corroborated & unchanged):/i.test(
        line
      )
    ) {
      continue;
    }
    if (/^https?:\/\/\S+$/i.test(line)) {
      continue;
    }

    const isHeaderOrSection =
      NON_FACTUAL_HEADER_REGEX.test(line) &&
      line.length < 50 &&
      !line.includes(":") &&
      !line.includes("$") &&
      !line.includes("·") &&
      !line.includes("₹") &&
      !line.includes("€") &&
      !line.includes("%");

    if (isHeaderOrSection) {
      continue;
    }

    const isSubordinate = SUBORDINATE_ATTRIBUTE_REGEX.test(line);

    if (isSubordinate) {
      if (candidates.length > 0) {
        const lastIdx = candidates.length - 1;
        const last = candidates[lastIdx]!;
        if (last.length + line.length < 400 && !last.includes(line)) {
          candidates[lastIdx] = `${last} (${line})`;
          continue;
        }
      }

      if (currentEntityContext) {
        const combined = `${currentEntityContext}: ${line}`;
        candidates.push(combined);
        continue;
      }
    }

    const detected = extractEntityFromText(line);
    if (detected && detected.name) {
      currentEntityContext = detected.name;
    }

    const isBareEntity =
      line.endsWith(":") &&
      line.length < 60 &&
      !line.includes("$") &&
      !line.includes("%") &&
      !line.includes("·");

    if (isBareEntity) {
      currentEntityContext = line.replace(/:$/, "").trim();
      continue;
    }

    if (/[.?!]\s+[A-Z]/.test(line)) {
      const sentences = line.split(/(?<=[.?!])\s+/);
      for (const s of sentences) {
        const cleanS = s.trim();
        if (cleanS.length >= 15 && cleanS.length <= 500) {
          candidates.push(cleanS);
        }
      }
    } else {
      if (line.length >= 15 && line.length <= 500) {
        candidates.push(line);
      }
    }
  }

  const seen = new Set<string>();
  const uniqueSentences: string[] = [];
  for (const c of candidates) {
    const norm = c.toLowerCase().trim();
    if (!seen.has(norm)) {
      seen.add(norm);
      uniqueSentences.push(c);
    }
  }

  return uniqueSentences.slice(0, 30).map((sentence) => ({
    id: crypto.randomUUID(),
    scoutId,
    executionId,
    content: sentence,
    sourceUrl,
    confidence: 0.95,
    status: "active",
    createdAt: new Date().toISOString(),
  }));
}
