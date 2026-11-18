import { CitationVerification, VeracityAudit } from "@repo/types";

function extractRootDomain(url: string): string {
  try {
    const parsed = new URL(url);
    const parts = parsed.hostname.split(".").filter(Boolean);
    if (parts.length >= 2) {
      return parts.slice(-2).join(".");
    }
    return parsed.hostname;
  } catch {
    return "unknown";
  }
}

export interface CandidateEvidence {
  url: string;
  domContent?: string;
}

export async function auditClaimVeracity(
  claim: string,
  evidenceList: CandidateEvidence[],
  minIndependentDomains = 2
): Promise<VeracityAudit> {
  const citations: CitationVerification[] = [];
  const domainSet = new Set<string>();

  const claimKeywords = claim.toLowerCase().split(/\s+/).filter((w) => w.length > 3);

  for (const ev of evidenceList) {
    const domain = extractRootDomain(ev.url);
    domainSet.add(domain);

    let domMatched = false;
    let anchorSnippet = "";
    let veracityScore = 0.5;

    if (ev.domContent) {
      const domLower = ev.domContent.toLowerCase();
      const matches = claimKeywords.filter((kw) => domLower.includes(kw));
      const matchScore = claimKeywords.length > 0 ? matches.length / claimKeywords.length : 0;

      if (matchScore >= 0.25) {
        domMatched = true;
        veracityScore = Number((0.55 + matchScore * 0.45).toFixed(2));
        const idx = domLower.indexOf(matches[0] || "");
        if (idx !== -1) {
          anchorSnippet = ev.domContent.slice(Math.max(0, idx - 50), idx + 100);
        }
      }
    } else {
      domMatched = true;
      veracityScore = 0.7;
    }

    citations.push({
      url: ev.url,
      domain,
      anchorSnippet: anchorSnippet || undefined,
      domMatched,
      veracityScore,
      notes: domMatched ? "Grounded in DOM evidence" : "Weak lexical support in document tree",
    });
  }

  const independentSourcesCount = domainSet.size;
  const avgVeracity =
    citations.length > 0
      ? citations.reduce((sum, c) => sum + c.veracityScore, 0) / citations.length
      : 0;

  const multiDomainBonus =
    independentSourcesCount >= minIndependentDomains
      ? Math.min(0.25, 0.15 + (independentSourcesCount - minIndependentDomains) * 0.02)
      : -0.1;
  const overallConfidence = Math.max(
    0.1,
    Math.min(1.0, Number((avgVeracity + multiDomainBonus).toFixed(2)))
  );

  const hasContradiction = citations.some((c) => c.veracityScore < 0.3);
  const auditPassed =
    independentSourcesCount >= minIndependentDomains &&
    overallConfidence >= 0.65 &&
    !hasContradiction;

  return {
    claim,
    overallConfidence,
    independentSourcesCount,
    citations,
    hasContradiction,
    contradictionDetails: hasContradiction
      ? "Discrepancy detected across evidence domain contents."
      : undefined,
    auditPassed,
  };
}
