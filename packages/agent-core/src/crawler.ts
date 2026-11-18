import FirecrawlApp from "@mendable/firecrawl-js";
import { env } from "@repo/config-env";

const GLOBAL_CRAWLER_KEY = Symbol.for("__forager_crawler_instance__");
let crawlerInstance: FirecrawlApp | null = null;

export function getCrawlerClient(): FirecrawlApp {
  const globalClient = (globalThis as Record<symbol, unknown>)[GLOBAL_CRAWLER_KEY] as FirecrawlApp | null | undefined;
  if (globalClient) {
    return globalClient;
  }
  if (crawlerInstance) {
    return crawlerInstance;
  }

  const apiKey = env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    throw new Error("FIRECRAWL_API_KEY is not set. Cannot initialize Firecrawl client.");
  }

  crawlerInstance = new FirecrawlApp({ apiKey });
  (globalThis as Record<symbol, unknown>)[GLOBAL_CRAWLER_KEY] = crawlerInstance;
  return crawlerInstance;
}

export function setCrawlerClient(client: FirecrawlApp | null): void {
  crawlerInstance = client;
  (globalThis as Record<symbol, unknown>)[GLOBAL_CRAWLER_KEY] = client;
}

export interface ScrapeOptions {
  formats?: (
    | "markdown"
    | "html"
    | "rawHtml"
    | "content"
    | "links"
    | "screenshot"
    | "screenshot@fullPage"
    | "extract"
    | "json"
    | "changeTracking"
  )[];
  timeoutMs?: number;
  parsePDF?: boolean;
  onlyMainContent?: boolean;
  waitFor?: number;
}

export interface SearchResultItem {
  url: string;
  title: string;
  description: string;
  markdown?: string;
  favicon?: string | null;
}

export interface SearchOptions {
  limit?: number;
  timeoutMs?: number;
}

export async function scrapeUrl(url: string, options: ScrapeOptions = {}) {
  const crawler = getCrawlerClient();
  const formats = options.formats || ["markdown", "screenshot@fullPage"];

  try {
    const params: Record<string, unknown> = {
      formats,
      parsePDF: options.parsePDF ?? true,
      onlyMainContent: options.onlyMainContent ?? true,
    };
    if (options.timeoutMs) {
      params.timeout = options.timeoutMs;
    }
    if (options.waitFor) {
      params.waitFor = options.waitFor;
    }
    const response = await crawler.scrapeUrl(url, params as any);
    if (response && "error" in response && response.error && !("markdown" in response)) {
      throw new Error(`Firecrawl scrape error: ${response.error}`);
    }
    return response;
  } catch (error) {
    throw new Error(`Scraping failed for ${url}: ${(error as Error).message}`);
  }
}

export async function searchWeb(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResultItem[]> {
  const crawler = getCrawlerClient();
  const limit = options.limit || 5;

  try {
    const response = await crawler.search(query, {
      limit,
      timeout: options.timeoutMs,
    });

    if (!response.success || response.error) {
      throw new Error(`Firecrawl search error: ${response.error || "Search failed"}`);
    }

    const items = response.data || [];
    return items
      .map((item) => {
        const rawItem = item as unknown as Record<string, unknown>;
        const metadata = ((item.metadata as unknown) || {}) as Record<string, unknown>;
        const url = (item.url || metadata.sourceURL || metadata.ogUrl || "") as string;
        const title = (metadata.title || rawItem.title || metadata.ogTitle || url) as string;
        let description = (metadata.description || rawItem.description || metadata.ogDescription || "") as string;
        if (!description && item.markdown) {
          description = item.markdown.slice(0, 200).replace(/\s+/g, " ").trim();
        }
        const markdown = item.markdown || undefined;
        const favicon = ((metadata.favicon as string) || (rawItem.favicon as string) || null) as string | null;
        return {
          url,
          title,
          description,
          markdown,
          favicon,
        };
      })
      .filter((item) => Boolean(item.url));
  } catch (error) {
    throw new Error(`Search failed for "${query}": ${(error as Error).message}`);
  }
}
