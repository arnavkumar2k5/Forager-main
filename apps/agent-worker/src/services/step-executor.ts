import type { ExplorerAction } from "@repo/types";
import {
  searchWeb,
  scrapeUrl,
  extractRelevantPassages,
  isEcommerceOrProductTarget,
  extractJsonLdPrices,
} from "../agent-core";

export interface TrajectorySearchResultItem {
  url: string;
  title: string;
  description?: string;
  markdown?: string;
  favicon?: string | null;
}

export interface ScrapedPageEvidence {
  url: string;
  title: string;
  content: string;
  screenshot?: string;
  error?: string;
}

export interface StepObservationOutcome {
  observation: string;
  scrapedUrl?: string;
  scrapedTitle?: string;
  scrapedContent?: string;
  scrapedScreenshot?: string;
  scrapedPages?: ScrapedPageEvidence[];
  searchResults?: TrajectorySearchResultItem[];
}

async function scrapeSingleUrl(targetUrl: string, goal: string): Promise<ScrapedPageEvidence> {
  try {
    const ecom = isEcommerceOrProductTarget(targetUrl, goal);
    const formats: Array<"markdown" | "html"> = ecom.isEcommerce
      ? ["markdown", "html"]
      : ["markdown"];

    const scrapeRes = await scrapeUrl(targetUrl, {
      formats,
      timeoutMs: ecom.isEcommerce ? 15000 : 12000,
      onlyMainContent: !ecom.isEcommerce,
      waitFor: ecom.isEcommerce ? ecom.suggestedWaitMs || 2500 : undefined,
    });

    const resObj = scrapeRes as unknown as Record<string, unknown> | null;
    if (!resObj || !resObj.success) {
      const errMsg =
        resObj && typeof resObj.error === "string" ? resObj.error : "Unknown scraping failure";
      return {
        url: targetUrl,
        title: targetUrl,
        content: "",
        error: errMsg,
      };
    }

    const metadata = (resObj.metadata as Record<string, unknown>) || {};
    let markdown = (resObj.markdown as string) || "";
    const html = (resObj.html as string) || (resObj.rawHtml as string) || "";
    const title = (metadata.title as string) || targetUrl;
    const screenshot =
      (resObj.screenshot as string | undefined) ||
      ((resObj.data as Record<string, unknown> | undefined)?.screenshot as string | undefined) ||
      undefined;

    if (ecom.isEcommerce) {
      const jsonLdPrices = extractJsonLdPrices(html || markdown);
      if (jsonLdPrices.length > 0) {
        const priceLines = jsonLdPrices.map(
          (p) =>
            `[Product Structured Data / Live Price]: ${p.name ? `${p.name} - ` : ""}Price: ${p.currency || ""} ${p.price}${p.availability ? ` (${p.availability})` : ""}`
        );
        markdown = `${priceLines.join("\n")}\n\n${markdown}`;
      }
    }

    if (markdown && markdown.trim().length > 0) {
      const extracted = extractRelevantPassages(markdown, goal);
      return {
        url: targetUrl,
        title,
        content: extracted.excerpt,
        screenshot,
      };
    }

    return {
      url: targetUrl,
      title,
      content: "Page loaded but returned empty content.",
      screenshot,
    };
  } catch (err) {
    return {
      url: targetUrl,
      title: targetUrl,
      content: "",
      error: (err as Error).message,
    };
  }
}

export async function executeStepObservation(
  action: ExplorerAction,
  goal: string,
  currentUrl?: string
): Promise<StepObservationOutcome> {
  if (action.type === "search") {
    const query = action.query || goal;
    try {
      const results = await searchWeb(query, { limit: 5 });
      if (results.length > 0) {
        const lines = results.map((r, idx) => {
          const descPart = r.description?.trim() ? ` - ${r.description.trim()}` : "";
          return `[Result ${idx + 1}] ${r.title} (${r.url})${descPart}`;
        });
        const formattedResults: TrajectorySearchResultItem[] = results.map((r) => ({
          url: r.url,
          title: r.title,
          description: r.description,
          markdown: r.markdown,
          favicon: r.favicon || null,
        }));
        return {
          observation: `Search results for query:\n${lines.join("\n")}`.slice(0, 2500),
          searchResults: formattedResults,
        };
      }
      return {
        observation: `Search yielded no results for query: ${query}`,
        searchResults: [],
      };
    } catch (err) {
      return {
        observation: `Search failed: ${(err as Error).message}`,
        searchResults: [],
      };
    }
  }

  if (action.type === "navigate") {
    const targetUrls: string[] = [];
    if (action.urls && action.urls.length > 0) {
      for (const u of action.urls) {
        if (u && u.startsWith("http") && !targetUrls.includes(u)) {
          targetUrls.push(u);
        }
      }
    } else if (action.url || currentUrl) {
      const single = action.url || currentUrl;
      if (single) targetUrls.push(single);
    }

    if (targetUrls.length === 0) {
      return { observation: "Navigate action did not specify any valid URLs." };
    }

    const settled = await Promise.allSettled(
      targetUrls.map((target) => scrapeSingleUrl(target, goal))
    );

    const scrapedPages: ScrapedPageEvidence[] = [];
    for (const res of settled) {
      if (res.status === "fulfilled") {
        scrapedPages.push(res.value);
      }
    }

    const validPages = scrapedPages.filter((p) => !p.error && p.content && p.content.trim().length > 0);

    if (validPages.length === 0) {
      const firstErr = scrapedPages[0]?.error || "Scraping failed for all targets.";
      return {
        observation: `Failed to scrape target URLs: ${firstErr}`,
        scrapedPages,
      };
    }

    const primary = validPages[0]!;
    const observationParts = validPages.map(
      (p, idx) => `[Source ${idx + 1}: ${p.title} (${p.url})]\n${p.content}`
    );

    return {
      observation: observationParts.join("\n\n---\n\n").slice(0, 6000),
      scrapedUrl: primary.url,
      scrapedTitle: primary.title,
      scrapedContent: primary.content,
      scrapedScreenshot: primary.screenshot,
      scrapedPages,
    };
  }

  if (action.type === "extract") {
    return {
      observation: action.extractedContent
        ? `Extracted claim from ${currentUrl || "document"}: ${action.extractedContent}`.slice(0, 2000)
        : "No factual claim isolated in extract action.",
    };
  }

  return { observation: "Research traversal complete." };
}
