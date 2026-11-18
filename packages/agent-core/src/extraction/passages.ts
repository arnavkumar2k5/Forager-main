export interface PassageExtractionOptions {
  maxTotalCharacters?: number;
  leadCharacters?: number;
  minPassageCharacters?: number;
  maxPassageCharacters?: number;
}

export interface ExtractedPassageResult {
  excerpt: string;
  matchedTerms: string[];
  hasDirectMatch: boolean;
  totalDocumentLength: number;
  selectedPassagesCount: number;
  limitationNote?: string;
}

export interface DocumentSection {
  header: string;
  content: string;
  score: number;
  matchedTerms: string[];
  startIndex: number;
}

export interface SentenceSpan {
  text: string;
  startIndex: number;
  endIndex: number;
}

const COMMON_STOPWORDS = new Set([
  "what",
  "is",
  "the",
  "a",
  "an",
  "of",
  "and",
  "in",
  "to",
  "for",
  "on",
  "with",
  "at",
  "by",
  "from",
  "as",
  "about",
  "into",
  "through",
  "after",
  "before",
  "between",
  "under",
  "above",
  "how",
  "why",
  "which",
  "who",
  "does",
  "did",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "have",
  "has",
  "had",
  "do",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "or",
  "not",
  "no",
  "so",
  "can",
  "could",
  "will",
  "would",
  "if",
  "then",
  "there",
  "where",
  "when",
  "all",
  "any",
  "each",
  "more",
  "some",
  "such",
  "than",
  "too",
  "very",
]);

export function extractQueryKeywords(query: string): { terms: string[]; phrases: string[] } {
  if (!query || !query.trim()) {
    return { terms: [], phrases: [] };
  }

  const normalized = query.toLowerCase().trim();
  const rawWords = normalized.split(/[^a-z0-9_-]+/).filter(Boolean);
  const terms = rawWords.filter((w) => w.length > 2 && !COMMON_STOPWORDS.has(w));

  const phrases: string[] = [];
  for (let i = 0; i < rawWords.length - 1; i++) {
    const w1 = rawWords[i];
    const w2 = rawWords[i + 1];
    if (w1 && w2 && (terms.includes(w1) || terms.includes(w2))) {
      phrases.push(`${w1} ${w2}`);
    }
  }

  for (let i = 0; i < rawWords.length - 2; i++) {
    const w1 = rawWords[i];
    const w2 = rawWords[i + 1];
    const w3 = rawWords[i + 2];
    if (w1 && w2 && w3 && (terms.includes(w1) || terms.includes(w2) || terms.includes(w3))) {
      phrases.push(`${w1} ${w2} ${w3}`);
    }
  }

  return { terms: Array.from(new Set(terms)), phrases: Array.from(new Set(phrases)) };
}

export function extractSentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = [];
  const sentenceRegex = /[^.!?\r\n]+(?:[.!?]+(?=[\s\r\n]|$)|$)/g;
  let match: RegExpExecArray | null;
  while ((match = sentenceRegex.exec(text)) !== null) {
    const raw = match[0];
    const trimmed = raw.trim();
    if (trimmed.length > 0) {
      const leadingOffset = raw.indexOf(trimmed);
      const start = match.index + leadingOffset;
      spans.push({
        text: trimmed,
        startIndex: start,
        endIndex: start + trimmed.length,
      });
    }
  }
  return spans;
}

export function splitIntoSentenceWindows(
  documentText: string,
  windowSentenceCount = 3,
  stepSentenceCount = 1
): DocumentSection[] {
  const spans = extractSentenceSpans(documentText);
  if (spans.length === 0) {
    return [];
  }

  if (spans.length <= windowSentenceCount && documentText.length < 1000) {
    return [
      {
        header: `Document Text [chars 0-${documentText.length}]`,
        content: documentText.trim(),
        score: 0,
        matchedTerms: [],
        startIndex: 0,
      },
    ];
  }

  const sections: DocumentSection[] = [];
  for (let i = 0; i < spans.length; i += stepSentenceCount) {
    const windowSpans = spans.slice(i, i + windowSentenceCount);
    if (windowSpans.length === 0) break;

    const startSpan = windowSpans[0]!;
    const endSpan = windowSpans[windowSpans.length - 1]!;
    const windowStart = startSpan.startIndex;
    const windowEnd = endSpan.endIndex;
    const windowContent = documentText.slice(windowStart, windowEnd).trim();

    if (windowContent.length >= 20) {
      sections.push({
        header: `Window [chars ${windowStart}-${windowEnd}]`,
        content: windowContent,
        score: 0,
        matchedTerms: [],
        startIndex: windowStart,
      });
    }

    if (i + windowSentenceCount >= spans.length) {
      break;
    }
  }

  return sections;
}

export function splitIntoDocumentSections(documentText: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = documentText.split(/\r?\n/);

  let currentHeader = "Document Start";
  let currentLines: string[] = [];
  let startIndex = 0;
  let runningIndex = 0;

  for (const line of lines) {
    const headerMatch = line.match(/^(#{1,4}\s+[^\n]+)/);
    if (headerMatch) {
      if (currentLines.length > 0) {
        sections.push({
          header: currentHeader,
          content: currentLines.join("\n").trim(),
          score: 0,
          matchedTerms: [],
          startIndex,
        });
      }
      currentHeader = headerMatch[1]!.trim();
      currentLines = [line];
      startIndex = runningIndex;
    } else {
      currentLines.push(line);
    }
    runningIndex += line.length + 1;
  }

  if (currentLines.length > 0) {
    sections.push({
      header: currentHeader,
      content: currentLines.join("\n").trim(),
      score: 0,
      matchedTerms: [],
      startIndex,
    });
  }

  const validHeaderSections = sections.filter((s) => s.content.length > 0);

  if (validHeaderSections.length > 1) {
    return validHeaderSections;
  }

  if (documentText.length > 1000) {
    const rawParagraphs = documentText.split(/\n\s*\n+/);
    let runningParaOffset = 0;
    const paragraphSections: DocumentSection[] = [];

    for (let idx = 0; idx < rawParagraphs.length; idx++) {
      const p = rawParagraphs[idx]!;
      const trimmed = p.trim();
      const pIndex = documentText.indexOf(trimmed, runningParaOffset);
      const start = pIndex !== -1 ? pIndex : runningParaOffset;
      if (trimmed.length > 20) {
        paragraphSections.push({
          header: `Paragraph ${idx + 1} [chars ${start}-${start + trimmed.length}]`,
          content: trimmed,
          score: 0,
          matchedTerms: [],
          startIndex: start,
        });
      }
      runningParaOffset = start + trimmed.length;
    }

    if (paragraphSections.length > 1) {
      return paragraphSections;
    }

    return splitIntoSentenceWindows(documentText);
  }

  return validHeaderSections;
}

export function extractRelevantPassages(
  documentText: string,
  query: string,
  options: PassageExtractionOptions = {}
): ExtractedPassageResult {
  const {
    maxTotalCharacters = 4500,
    leadCharacters = 1000,
    minPassageCharacters = 60,
    maxPassageCharacters = 1800,
  } = options;

  const totalDocumentLength = documentText ? documentText.length : 0;
  if (!documentText || totalDocumentLength === 0) {
    return {
      excerpt: "",
      matchedTerms: [],
      hasDirectMatch: false,
      totalDocumentLength: 0,
      selectedPassagesCount: 0,
      limitationNote: "Empty document content.",
    };
  }

  const { terms, phrases } = extractQueryKeywords(query);
  const hasMeaningfulTerms = terms.length > 0 || phrases.length > 0;

  if (!hasMeaningfulTerms) {
    const leadText = documentText.slice(0, Math.min(leadCharacters, maxTotalCharacters)).trim();
    const limitationNote =
      "Query contains no meaningful search terms after stopword filtering. Showing unranked lead excerpt only.";
    return {
      excerpt: `[Document Overview / Unranked Lead Excerpt]\n${leadText}\n\n---\n\n[Retrieval Note: ${limitationNote}]`,
      matchedTerms: [],
      hasDirectMatch: false,
      totalDocumentLength,
      selectedPassagesCount: 0,
      limitationNote,
    };
  }

  if (totalDocumentLength <= maxTotalCharacters) {
    const matched = terms.filter((t) => documentText.toLowerCase().includes(t));
    const hasDirectMatch = matched.length > 0;
    let limitationNote: string | undefined;
    let excerpt = documentText.trim();

    if (!hasDirectMatch) {
      limitationNote = `Keyword search across the document (${totalDocumentLength} characters) did not locate sections matching query terms [${terms.join(", ")}].`;
      excerpt = `[Document Overview / Lead Excerpt]\n${excerpt}\n\n---\n\n[Retrieval Note: ${limitationNote}]`;
    }

    return {
      excerpt,
      matchedTerms: matched,
      hasDirectMatch,
      totalDocumentLength,
      selectedPassagesCount: hasDirectMatch ? 1 : 0,
      limitationNote,
    };
  }

  const sections = splitIntoDocumentSections(documentText);

  const queryHasPriceIntent =
    /\b(price|pricing|cost|rate|drop|mrp|discount|deal|buy|sale)\b|[₹$€£]|(\brs\.?\b)|(\binr\b)|(\busd\b)/i.test(
      query
    );
  const PRICE_PATTERN =
    /(?:₹|\$|€|£|\brs\.?|\binr\b|\busd\b)\s*(\d{1,3}(?:,\d{2,3})*(?:\.\d{2})?|\d+)/i;
  const STRUCTURED_PRICE_MARKER = "[product structured data / live price]";

  const allMatchedTerms = new Set<string>();
  for (const sec of sections) {
    const secLower = (sec.header + "\n" + sec.content).toLowerCase();
    let score = 0;

    for (const phrase of phrases) {
      if (secLower.includes(phrase)) {
        score += 8;
      }
    }

    const matchedTerms: string[] = [];
    for (const term of terms) {
      if (secLower.includes(term)) {
        score += 3;
        matchedTerms.push(term);
        allMatchedTerms.add(term);
      }
    }

    const headerLower = sec.header.toLowerCase();
    for (const term of terms) {
      if (headerLower.includes(term)) {
        score += 5;
      }
    }

    if (queryHasPriceIntent) {
      if (secLower.includes(STRUCTURED_PRICE_MARKER)) {
        score += 20;
      } else if (PRICE_PATTERN.test(secLower)) {
        score += 8;
      } else if (/\b(m\.?r\.?p\.?|deal price|our price|selling price|current price)\b/i.test(secLower)) {
        score += 5;
      }
    }

    sec.score = score;
    sec.matchedTerms = matchedTerms;
  }

  const leadText = documentText.slice(0, leadCharacters).trim();
  const leadHasMatch = terms.some((t) => leadText.toLowerCase().includes(t));

  const candidates = sections
    .filter((s) => s.score > 0 && s.content.length >= minPassageCharacters)
    .sort((a, b) => b.score - a.score);

  const selectedParts: string[] = [];
  let currentBudget = maxTotalCharacters;

  selectedParts.push(`[Document Overview / Lead Excerpt]\n${leadText}`);
  currentBudget -= leadText.length + 50;

  let selectedPassagesCount = 0;
  const selectedCharacterRanges: [number, number][] = [];

  for (const candidate of candidates) {
    if (currentBudget <= 250) break;

    const candStart = candidate.startIndex;
    const candEnd = candidate.startIndex + candidate.content.length;

    if (candStart < leadCharacters && (candEnd <= leadCharacters || candStart < 200)) {
      continue;
    }

    const overlaps = selectedCharacterRanges.some(
      ([s, e]) => Math.max(s, candStart) < Math.min(e, candEnd) - 50
    );
    if (overlaps) {
      continue;
    }

    const candidateSnippet =
      candidate.content.length > maxPassageCharacters
        ? candidate.content.slice(0, maxPassageCharacters).trim() + "..."
        : candidate.content.trim();

    if (candidateSnippet.length <= currentBudget) {
      selectedParts.push(`[Relevant Section: ${candidate.header}]\n${candidateSnippet}`);
      currentBudget -= candidateSnippet.length + 50;
      selectedPassagesCount++;
      selectedCharacterRanges.push([candStart, candEnd]);
    }
  }

  const hasDirectMatch = selectedPassagesCount > 0 || leadHasMatch;
  let limitationNote: string | undefined;

  if (!hasDirectMatch) {
    limitationNote = `Keyword search across the full document (${totalDocumentLength} characters) did not locate sections matching query terms [${terms.join(", ")}]. Showing document lead only.`;
    selectedParts.push(`[Retrieval Note: ${limitationNote}]`);
  }

  return {
    excerpt: selectedParts.join("\n\n---\n\n"),
    matchedTerms: Array.from(allMatchedTerms),
    hasDirectMatch,
    totalDocumentLength,
    selectedPassagesCount,
    limitationNote,
  };
}
