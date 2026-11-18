import { FrontierCandidate, DomainCoverage } from "@repo/types";
import { canonicalizeUrl } from "../normalization/url";

export function normalizeCandidateUrl(rawUrl: string): string | null {
  return canonicalizeUrl(rawUrl);
}

export function extractRootDomain(rawUrl?: string): string {
  if (!rawUrl) return "unknown";
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    return host || "unknown";
  } catch {
    return "unknown";
  }
}

export interface RawSearchResult {
  url: string;
  title?: string;
  description?: string;
  markdown?: string;
}

export class CandidateFrontier {
  private candidates = new Map<string, FrontierCandidate>();
  private domainCoverage = new Map<string, DomainCoverage>();

  addCandidates(
    items: RawSearchResult[],
    sourceQuery: string,
    stepNumber: number
  ): number {
    let addedCount = 0;

    for (const item of items) {
      if (!item.url) continue;
      const canonical = normalizeCandidateUrl(item.url);
      if (!canonical) continue;

      const domain = extractRootDomain(canonical);
      const existing = this.candidates.get(canonical);

      if (existing) {
        if (!existing.snippet && (item.description || item.markdown)) {
          existing.snippet = (item.description || item.markdown || "").slice(0, 300);
        }
        continue;
      }

      const candidate: FrontierCandidate = {
        url: item.url,
        canonicalUrl: canonical,
        rootDomain: domain,
        title: item.title || canonical,
        snippet: (item.description || item.markdown || "").slice(0, 300),
        sourceQuery,
        discoveredAtStep: stepNumber,
        status: "queued",
      };

      this.candidates.set(canonical, candidate);
      addedCount++;

      if (!this.domainCoverage.has(domain)) {
        this.domainCoverage.set(domain, {
          rootDomain: domain,
          scrapedPaths: [],
          evidenceCount: 0,
        });
      }
    }

    return addedCount;
  }

  getQueuedCandidates(): FrontierCandidate[] {
    return Array.from(this.candidates.values()).filter((c) => c.status === "queued");
  }

  getAllCandidates(): FrontierCandidate[] {
    return Array.from(this.candidates.values());
  }

  markSelected(urls: string[]): void {
    const canonicals = new Set(urls.map((u) => normalizeCandidateUrl(u) || u));
    for (const [key, c] of this.candidates) {
      if (canonicals.has(key) || canonicals.has(c.url)) {
        c.status = "selected";
      }
    }
  }

  recordScraped(url: string, stepNumber: number): void {
    const canonical = normalizeCandidateUrl(url) || url;
    const candidate = this.candidates.get(canonical);
    if (candidate) {
      candidate.status = "scraped";
    }

    const domain = extractRootDomain(canonical);
    let coverage = this.domainCoverage.get(domain);
    if (!coverage) {
      coverage = {
        rootDomain: domain,
        scrapedPaths: [],
        evidenceCount: 0,
      };
      this.domainCoverage.set(domain, coverage);
    }

    try {
      const parsed = new URL(canonical);
      const pathWithSearch = `${parsed.pathname}${parsed.search}`;
      if (!coverage.scrapedPaths.includes(pathWithSearch)) {
        coverage.scrapedPaths.push(pathWithSearch);
      }
    } catch {
      coverage.scrapedPaths.push(canonical);
    }

    coverage.evidenceCount += 1;
    if (coverage.firstVisitedAtStep === undefined) {
      coverage.firstVisitedAtStep = stepNumber;
    }
    coverage.lastVisitedAtStep = stepNumber;
  }

  markPruned(url: string): void {
    const canonical = normalizeCandidateUrl(url) || url;
    const candidate = this.candidates.get(canonical);
    if (candidate) {
      candidate.status = "pruned";
    }
  }

  updateRelevance(url: string, score: number): void {
    const canonical = normalizeCandidateUrl(url) || url;
    const candidate = this.candidates.get(canonical);
    if (candidate) {
      candidate.relevanceScore = score;
    }
  }

  getDomainCoverage(rootDomain: string): DomainCoverage | undefined {
    return this.domainCoverage.get(rootDomain);
  }

  getAllDomainCoverages(): DomainCoverage[] {
    return Array.from(this.domainCoverage.values());
  }

  getExploredDomainCount(): number {
    return Array.from(this.domainCoverage.values()).filter(
      (d) => d.scrapedPaths.length > 0
    ).length;
  }

  selectDiverseTopCandidates(limit: number = 3): FrontierCandidate[] {
    const queued = this.getQueuedCandidates();
    if (queued.length === 0) return [];

    const sorted = [...queued].sort((a, b) => {
      const scoreA = a.relevanceScore ?? 0.5;
      const scoreB = b.relevanceScore ?? 0.5;
      return scoreB - scoreA;
    });

    const selected: FrontierCandidate[] = [];
    const chosenDomains = new Set<string>();

    for (const cand of sorted) {
      if (!chosenDomains.has(cand.rootDomain)) {
        selected.push(cand);
        chosenDomains.add(cand.rootDomain);
        if (selected.length >= limit) break;
      }
    }

    if (selected.length < limit) {
      for (const cand of sorted) {
        if (!selected.some((s) => s.canonicalUrl === cand.canonicalUrl)) {
          selected.push(cand);
          if (selected.length >= limit) break;
        }
      }
    }

    return selected;
  }
}

