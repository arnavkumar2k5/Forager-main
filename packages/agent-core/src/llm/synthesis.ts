import { z } from "zod";
import { invokeLLM } from "./client";
import { extractQueryKeywords } from "../extraction/passages";

export interface EvidenceSource {
  url: string;
  title?: string;
  content: string;
}

export interface SynthesisDiffContext {
  isBaseline?: boolean;
  historicalPropositions?: Array<{ id: string; content: string }>;
  diffClassification?: {
    novel?: string[];
    updated?: string[];
    redundant?: string[];
  };
  missionMode?: "landscape_discovery" | "metric_delta" | "general_monitor";
}

export interface SynthesisParams {
  query: string;
  evidence: EvidenceSource[];
  diffContext?: SynthesisDiffContext;
}

export interface SynthesisResult {
  answer: string;
  citations: string[];
  isComplete: boolean;
  missingInformation?: string;
  tokensUsed: number;
  promptTokens?: number;
  completionTokens?: number;
  evidenceSnippets?: Array<{ url: string; title?: string; snippet: string }>;
}

export const SynthesisOutputSchema = z.object({
  answer: z.string(),
  citations: z.array(z.string()).default([]),
  isComplete: z.boolean(),
  missingInformation: z.string().optional(),
});

export const SYNTHESIS_SYSTEM_PROMPT = `
You are the Lead Research Synthesizer in an autonomous web research platform.
Your mission is to produce a well-structured, authoritative, factual, and strictly grounded answer to the user's research query based exclusively on the provided retrieved evidence.

Non-negotiable Directives:
1. Grounding: Every statement must be supported by the provided retrieved documents. Do not speculate, extrapolate, or hallucinate facts not present in the evidence.
2. Temporal Filtering:
   - When the user query asks for "upcoming", "future", "latest", or "next" events, conferences, or releases, strictly verify dates against the Current Date provided in the prompt.
   - Any event that occurred BEFORE the current date is in the PAST and must NOT be presented as upcoming. If past events appear in retrieved articles, omit them or clearly sequester them under a separate "Past Archive" note.
   - For ongoing tools, AI models, APIs, and commercial services, existing market solutions remain active and valid regardless of their initial release date. Do not exclude currently active models or tools unless evidence indicates they have been discontinued or shut down.
3. Real Citations Only: The "citations" array MUST ONLY contain exact URLs present in the provided evidence sources. Never fabricate URLs.
4. Source Disagreements: If authoritative sources disagree or provide conflicting accounts, articulate the conflict factually rather than inventing a resolution.
5. Structured Presentation (Mandatory):
   - Never output a continuous, dense wall of text.
   - Use clean, readable GitHub-flavored Markdown:
     * Organize by categorized sections with H3 headings (e.g. "### Upcoming Developer Conferences", "### Global AI & Cloud Summits").
     * Present events or findings using structured bullet points with bold field labels:
       - **[Event Name]**: [Dates, Month, Year] | [Location or Virtual]
         - **Focus**: [Key technical themes]
         - **Source**: [Source Domain]
     * When multiple events are reported, order them chronologically.
6. Honesty & Missing Information: If the evidence is incomplete, ambiguous, or lacks the necessary details to answer the query, state clearly what facts were found and what is missing. Set "isComplete" to false.
7. Strict JSON: Respond ONLY with a valid JSON object matching:
{
  "answer": "Grounded synthesis formatted in structured Markdown with headings, bullet points, and chronological groupings",
  "citations": ["https://..."],
  "isComplete": true | false,
  "missingInformation": "optional explanation of missing information"
}
`.trim();

export function robustParseSynthesisJson(rawText: string): {
  answer: string;
  citations: string[];
  isComplete: boolean;
  missingInformation?: string;
} {
  const trimmed = rawText.trim();
  const codeBlockMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  let candidate = codeBlockMatch ? codeBlockMatch[1]!.trim() : trimmed;

  try {
    const direct = JSON.parse(candidate);
    if (direct && typeof direct === "object" && typeof direct.answer === "string") {
      return {
        answer: direct.answer,
        citations: Array.isArray(direct.citations) ? direct.citations : [],
        isComplete: Boolean(direct.isComplete),
        missingInformation:
          typeof direct.missingInformation === "string" ? direct.missingInformation : undefined,
      };
    }
  } catch {
    // Continue to repair heuristics
  }

  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    candidate = candidate.slice(firstBrace, lastBrace + 1);
  }

  try {
    let sanitized = candidate
      .replace(/\/\/[^\n\r]*/g, "")
      .replace(/,\s*([}\]])/g, "$1");

    sanitized = sanitized.replace(/"((?:\\.|[^"\\])*)"/g, (match) =>
      match.replace(/\r?\n/g, "\\n").replace(/\t/g, "\\t")
    );

    const repaired = JSON.parse(sanitized);
    if (repaired && typeof repaired === "object" && typeof repaired.answer === "string") {
      return {
        answer: repaired.answer,
        citations: Array.isArray(repaired.citations) ? repaired.citations : [],
        isComplete: Boolean(repaired.isComplete),
        missingInformation:
          typeof repaired.missingInformation === "string" ? repaired.missingInformation : undefined,
      };
    }
  } catch {
    // Continue to regex field extraction
  }

  const answerMatch = candidate.match(
    /"answer"\s*:\s*"([\s\S]*?)"(?=\s*,\s*"(?:citations|isComplete|missingInformation)")/i
  );
  if (answerMatch && answerMatch[1]) {
    const rawAnswer = answerMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\")
      .trim();

    const citationsMatch = candidate.match(/"citations"\s*:\s*\[([\s\S]*?)\]/i);
    const citations: string[] = [];
    if (citationsMatch && citationsMatch[1]) {
      const urlMatches = citationsMatch[1].matchAll(/https?:\/\/[^\s"',\]]+/g);
      for (const m of urlMatches) {
        citations.push(m[0]);
      }
    }

    return {
      answer: rawAnswer,
      citations,
      isComplete: /"isComplete"\s*:\s*true/i.test(candidate),
    };
  }

  const cleanedText = candidate
    .replace(/^\{\s*"answer"\s*:\s*"/i, "")
    .replace(/"\s*,\s*"citations"\s*:[\s\S]*$/i, "")
    .replace(/\\n/g, "\n")
    .replace(/\\"/g, '"')
    .trim();

  const urlMatches = rawText.matchAll(/https?:\/\/[^\s"',\]\)]+/g);
  const fallbackCitations = Array.from(urlMatches, (m) => m[0]);

  return {
    answer: cleanedText.length > 50 ? cleanedText : rawText.trim(),
    citations: fallbackCitations,
    isComplete: true,
  };
}

/**
 * Normalizes a URL exclusively for citation comparison.
 * - Parses via WHATWG URL API
 * - Normalizes protocol to lower-case (enforces http: or https:)
 * - Normalizes hostname to lower-case
 * - Strips URL fragments / hash
 * - Strips trailing slashes from pathnames (e.g. /docs/raft/ -> /docs/raft, / -> '')
 * Returns null if the URL is malformed or not http/https.
 */
export function normalizeCitationUrl(rawUrl: string): string | null {
  if (typeof rawUrl !== "string") {
    return null;
  }
  const trimmed = rawUrl.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    parsed.hash = "";

    let pathname = parsed.pathname;
    if (pathname.length > 1 && pathname.endsWith("/")) {
      pathname = pathname.replace(/\/+$/, "");
    } else if (pathname === "/") {
      pathname = "";
    }

    const search = parsed.search || "";
    return `${parsed.protocol}//${parsed.host}${pathname}${search}`;
  } catch {
    return null;
  }
}

export async function synthesizeFinalAnswer(
  params: SynthesisParams
): Promise<SynthesisResult> {
  const { query, evidence, diffContext } = params;

  const trimmedQuery = (query || "").trim();
  if (!trimmedQuery) {
    return {
      answer: "Unable to answer research query: query is empty.",
      citations: [],
      isComplete: false,
      missingInformation: "Research query is empty.",
      tokensUsed: 0,
      evidenceSnippets: [],
    };
  }

  const { terms: queryTerms, phrases: queryPhrases } = extractQueryKeywords(trimmedQuery);
  const hasMeaningfulQuery = queryTerms.length > 0 || queryPhrases.length > 0;

  const validEvidence = evidence.filter(
    (e) => Boolean(e.url && e.url.trim()) && Boolean(e.content && e.content.trim())
  );

  // Map normalized retrieved URL -> original canonical retrieved URL
  const normalizedToCanonicalMap = new Map<string, string>();
  const canonicalRetrievedSet = new Set<string>();

  for (const item of validEvidence) {
    const canonical = item.url.trim();
    canonicalRetrievedSet.add(canonical);
    const normalized = normalizeCitationUrl(canonical);
    if (normalized && !normalizedToCanonicalMap.has(normalized)) {
      normalizedToCanonicalMap.set(normalized, canonical);
    }
  }

  if (validEvidence.length === 0) {
    return {
      answer: `Unable to answer "${query}". No primary source documents were successfully retrieved during the research trajectory.`,
      citations: [],
      isComplete: false,
      missingInformation: "No source documents were retrieved.",
      tokensUsed: 0,
      evidenceSnippets: [],
    };
  }

  const evidenceSnippets = validEvidence.map((e) => ({
    url: e.url,
    title: e.title,
    snippet: e.content.slice(0, 400).replace(/\s+/g, " ").trim(),
  }));

  const queryWords = (trimmedQuery || "").toLowerCase().split(/\s+/).filter((w) => w.length > 3);
  const prioritizedEvidence = [...validEvidence].sort((a, b) => {
    const aContent = (a.content || "").toLowerCase();
    const bContent = (b.content || "").toLowerCase();
    const aScore = queryWords.filter((w) => aContent.includes(w)).length;
    const bScore = queryWords.filter((w) => bContent.includes(w)).length;
    return bScore - aScore;
  });

  const topEvidence = prioritizedEvidence.slice(0, 8);

  const formattedEvidence = topEvidence
    .map((e, idx) => {
      const header = e.title ? `[Source ${idx + 1}]: ${e.title} (${e.url})` : `[Source ${idx + 1}]: ${e.url}`;
      const snippet = e.content.slice(0, 3500);
      return `${header}\n${snippet}`;
    })
    .join("\n\n---\n\n");

  const now = new Date();
  const currentDate = now.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  const currentYear = now.getFullYear();

  let diffInstructions = "";
  if (diffContext?.isBaseline) {
    diffInstructions = `
Mission Phase: Baseline Establishment (Run #1).
- Deliver a comprehensive, highly organized factual baseline of all discovered entities, metrics, exact pricing, and facts.
- Establish the clear benchmark state for future repeat monitoring.`;
  } else if (diffContext && !diffContext.isBaseline && (diffContext.historicalPropositions?.length ?? 0) > 0) {
    const uniqueProps = new Map<string, string>();
    for (const p of diffContext.historicalPropositions || []) {
      const clean = p.content.trim();
      if (clean && !uniqueProps.has(clean.toLowerCase())) {
        uniqueProps.set(clean.toLowerCase(), clean);
      }
    }
    const historicalList = Array.from(uniqueProps.values())
      .slice(0, 25)
      .map((c, idx) => `  ${idx + 1}. ${c}`)
      .join("\n");

    diffInstructions = `
Mission Phase: Delta Monitoring & Comprehensive Knowledge Synthesis.
Prior Established Knowledge Baseline (Known Entities & Previous Discoveries):
${historicalList}

CRITICAL SYNTHESIS DIRECTIVES:
1. Primary Factual Answer & Completeness:
   - You MUST deliver an exhaustive, well-structured answer detailing EVERY relevant model, tool, entity, and exact pricing discovered across the evidence (e.g. price per second, price per token, subscription tiers, resolutions, capabilities).
   - If evidence mentions models from the Prior Established Knowledge Baseline, retain them in the synthesized landscape with their corroborated specs and note any pricing shifts or new versions.
   - DO NOT claim that previously established entities from the baseline above are brand new discoveries.
   - If genuinely new models or tools appear in the evidence, highlight them clearly alongside the corroborated baseline models.
2. Structured Presentation:
   - Group models and providers by clear Markdown sections (###).
   - Use bold bullet points for exact specifications (**Pricing**, **Specs/Resolution**, **Features**, **Source**).`;
  }

  const userPrompt = `
Temporal Anchor: Current Date is ${currentDate} (${currentYear}).
User Research Query: "${query}"
${diffInstructions}

Retrieved Source Documents:
${formattedEvidence}

Available Valid Source URLs:
${Array.from(canonicalRetrievedSet).map((u) => `- ${u}`).join("\n")}

Instructions:
1. Synthesize a structured, clear, and comprehensive answer to the user's research query using only facts from the retrieved sources above.
2. Temporal Rule:
   - If the query asks for "upcoming" or "future" events, verify against ${currentDate}. Exclude any events that took place before ${currentDate}.
   - If the query asks about a specific past year, historical event, or specific conference edition (e.g., 2024, 2022, 2002), provide the historical facts as requested. Do NOT replace them with future dates.
3. Formatting: Organize with clear Markdown headings (###), categorized bullet points with bold field names (**Event Name**, **Dates**, **Location**, **Key Focus**), and chronological grouping. Do NOT output a single continuous block of text.
4. If the sources adequately answer the query, set "isComplete" to true and populate the "citations" array with the matching URLs from Available Valid Source URLs.
5. If the sources do not provide the necessary factual answer, state what was found, clearly explain what is missing, and set "isComplete" to false.
6. Output strictly valid JSON conforming to the requested schema.
`.trim();

  try {
    const llmResponse = await invokeLLM([
      { role: "system", content: SYNTHESIS_SYSTEM_PROMPT },
      { role: "user", content: userPrompt },
    ]);

    const data = robustParseSynthesisJson(llmResponse.content);

    // Strict citation verification:
    // Handles hostname casing, trailing slashes, and fragments,
    // preserving the original retrieved URL as the canonical citation.
    const verifiedCitations: string[] = [];
    const seenCanonicalUrls = new Set<string>();

    for (const rawCitation of data.citations) {
      if (typeof rawCitation !== "string") continue;
      const trimmed = rawCitation.trim();
      if (!trimmed) continue;

      let canonicalMatch: string | undefined;

      if (canonicalRetrievedSet.has(trimmed)) {
        canonicalMatch = trimmed;
      } else {
        const normalizedCite = normalizeCitationUrl(trimmed);
        if (normalizedCite && normalizedToCanonicalMap.has(normalizedCite)) {
          canonicalMatch = normalizedToCanonicalMap.get(normalizedCite);
        }
      }

      if (canonicalMatch && !seenCanonicalUrls.has(canonicalMatch)) {
        seenCanonicalUrls.add(canonicalMatch);
        verifiedCitations.push(canonicalMatch);
      }
    }

    // Invariant: Cannot be complete if no verified citations exist
    let isComplete = data.isComplete;
    if (verifiedCitations.length === 0 && isComplete) {
      isComplete = false;
    }

    // Invariant: Query with no meaningful terms cannot be answered as complete
    if (!hasMeaningfulQuery) {
      isComplete = false;
    }

    // Invariant: If all evidence is unranked lead fallback with no direct match, cannot be complete
    const allEvidenceIsFallback = validEvidence.every(
      (e) =>
        e.content.includes("[Retrieval Note:") ||
        e.content.includes("[Document Overview / Unranked Lead Excerpt]")
    );
    if (allEvidenceIsFallback) {
      isComplete = false;
    }

    // Invariant: If answer explicitly states information is missing, mark incomplete
    const missingSignals = [
      "not contain",
      "does not contain",
      "missing",
      "incomplete",
      "not yet",
      "unable to answer",
      "insufficient",
      "has not been retrieved",
      "could not find",
    ];
    const answerLower = data.answer.toLowerCase();
    if (missingSignals.some((sig) => answerLower.includes(sig))) {
      isComplete = false;
    }

    let missingInformation = data.missingInformation;
    if (!hasMeaningfulQuery && !missingInformation) {
      missingInformation = "Query contains no specific search terms after stopword filtering.";
    } else if (allEvidenceIsFallback && !missingInformation) {
      missingInformation = "Retrieved sources contained only unverified lead excerpts with no direct matches for query terms.";
    }

    return {
      answer: data.answer,
      citations: verifiedCitations,
      isComplete,
      missingInformation,
      tokensUsed: llmResponse.tokensUsed,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
      evidenceSnippets,
    };
  } catch (err) {
    return {
      answer: `Unable to synthesize answer due to API error: ${(err as Error).message}`,
      citations: Array.from(canonicalRetrievedSet),
      isComplete: false,
      missingInformation: `Synthesis invocation error: ${(err as Error).message}`,
      tokensUsed: 0,
      evidenceSnippets,
    };
  }
}
