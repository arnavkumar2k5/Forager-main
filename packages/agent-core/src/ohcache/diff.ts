import { Proposition, PropositionDiffItem, PropositionDiffResult } from "@repo/types";
import { cosineSimilarity, isValidEmbedding } from "./vector";
import { extractEntityFromText, isMatchingEntity, normalizeEntityKey } from "./entities";

function wordJaccardSimilarity(textA: string, textB: string): number {
  const cleanA = textA.toLowerCase().replace(/[^\w\s]/g, " ").trim();
  const cleanB = textB.toLowerCase().replace(/[^\w\s]/g, " ").trim();
  const setA = new Set(cleanA.split(/\s+/).filter(Boolean));
  const setB = new Set(cleanB.split(/\s+/).filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  const union = new Set([...setA, ...setB]);
  return intersection.size / union.size;
}

function extractNumbersAndRates(text: string): string[] {
  const matches = text.match(/\$[\d,]+(?:\.\d+)?|\b\d+(?:\.\d+)?\s*(?:%|sec|seconds?|cu-hour|gb-month|month|mo|credits?|token|tokens|million|billion|b|m)\b/gi);
  return matches ? matches.map((m) => m.toLowerCase().replace(/\s+/g, "")) : [];
}

export async function computePropositionDiff(
  candidatePropositions: Proposition[],
  historicalPropositions: Proposition[],
  similarityThreshold = 0.85
): Promise<PropositionDiffResult> {
  const items: PropositionDiffItem[] = [];
  let novelCount = 0;
  let redundantCount = 0;
  let contradictionCount = 0;

  const historicalEntities = new Map<string, Proposition[]>();
  for (const hist of historicalPropositions) {
    const ent = extractEntityFromText(hist.content);
    if (ent && ent.key) {
      const list = historicalEntities.get(ent.key) || [];
      list.push(hist);
      historicalEntities.set(ent.key, list);
    }
  }

  for (const candidate of candidatePropositions) {
    let maxSimilarity = 0;
    let nearestMatch: Proposition | null = null;
    let bestMethod: "vector_cosine" | "lexical_jaccard" = "lexical_jaccard";

    for (const historical of historicalPropositions) {
      let sim = 0;
      let method: "vector_cosine" | "lexical_jaccard" = "lexical_jaccard";

      if (
        candidate.embedding &&
        historical.embedding &&
        isValidEmbedding(candidate.embedding) &&
        isValidEmbedding(historical.embedding)
      ) {
        sim = cosineSimilarity(candidate.embedding, historical.embedding);
        method = "vector_cosine";
      } else {
        sim = wordJaccardSimilarity(candidate.content, historical.content);
        method = "lexical_jaccard";
      }

      if (sim > maxSimilarity) {
        maxSimilarity = sim;
        nearestMatch = historical;
        bestMethod = method;
      }
    }

    const candidateEntity = extractEntityFromText(candidate.content);
    let matchingHistList: Proposition[] | undefined = undefined;
    if (candidateEntity?.key) {
      if (historicalEntities.has(candidateEntity.key)) {
        matchingHistList = historicalEntities.get(candidateEntity.key);
      } else {
        for (const [histKey, props] of historicalEntities.entries()) {
          if (isMatchingEntity(candidateEntity.key, histKey)) {
            matchingHistList = props;
            break;
          }
        }
      }
    }
    const hasKnownEntity = Boolean(matchingHistList && matchingHistList.length > 0);

    const effectiveThreshold = hasKnownEntity ? Math.min(similarityThreshold, 0.80) : similarityThreshold;

    if (maxSimilarity >= effectiveThreshold) {
      redundantCount++;
      items.push({
        proposition: candidate,
        diffType: "redundant",
        similarityToNearest: Number(maxSimilarity.toFixed(4)),
        nearestPropositionId: nearestMatch?.id,
        similarityMethod: bestMethod,
        explanation:
          bestMethod === "vector_cosine"
            ? "Factual assertion corroborated via embedding cosine similarity."
            : "Factual assertion matched historical index via lexical word overlap fallback.",
      });
    } else if (hasKnownEntity && candidateEntity) {
      const bestEntityMatch = (matchingHistList && matchingHistList[0]) || nearestMatch;

      const candNums = extractNumbersAndRates(candidate.content);
      const histNums = bestEntityMatch ? extractNumbersAndRates(bestEntityMatch.content) : [];
      const numsMatch = candNums.length > 0 && histNums.length > 0 && candNums.every((n) => histNums.includes(n));

      const minCorroborationSim = bestMethod === "vector_cosine" ? 0.70 : 0.45;
      if (numsMatch && maxSimilarity >= minCorroborationSim) {
        redundantCount++;
        items.push({
          proposition: candidate,
          diffType: "redundant",
          similarityToNearest: Number(maxSimilarity.toFixed(4)),
          nearestPropositionId: bestEntityMatch?.id,
          similarityMethod: bestMethod,
          explanation: `Corroborated specs & pricing for known entity (${candidateEntity.name}).`,
        });
      } else {
        contradictionCount++;
        items.push({
          proposition: candidate,
          diffType: "contradiction",
          similarityToNearest: Number(maxSimilarity.toFixed(4)),
          nearestPropositionId: bestEntityMatch?.id,
          similarityMethod: bestMethod,
          explanation: `Status shift, pricing update, or new tier for existing entity (${candidateEntity.name}).`,
        });
      }
    } else {
      const hasNegation = /\b(not|no|never|ceased|stopped|false|cancelled|denied)\b/i.test(
        candidate.content
      );
      const contradictionThreshold = bestMethod === "vector_cosine" ? 0.5 : 0.35;
      if (maxSimilarity >= contradictionThreshold && hasNegation) {
        contradictionCount++;
        items.push({
          proposition: candidate,
          diffType: "contradiction",
          similarityToNearest: Number(maxSimilarity.toFixed(4)),
          nearestPropositionId: nearestMatch?.id,
          similarityMethod: bestMethod,
          explanation: "Candidate proposition asserts a negation or alteration of historical claim.",
        });
      } else {
        novelCount++;
        items.push({
          proposition: candidate,
          diffType: "novel",
          similarityToNearest: Number(maxSimilarity.toFixed(4)),
          nearestPropositionId: nearestMatch?.id,
          similarityMethod: bestMethod,
          explanation: "Novel factual assertion not present in prior knowledge state.",
        });
      }
    }
  }

  const total = candidatePropositions.length || 1;
  const driftScore = Number(((novelCount + contradictionCount * 1.5) / total).toFixed(4));

  return {
    novelCount,
    redundantCount,
    contradictionCount,
    updatedCount: contradictionCount,
    items,
    driftScore: Math.min(1.0, driftScore),
  };
}
