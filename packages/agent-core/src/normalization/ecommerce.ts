import { extractRootDomain } from "../explore-critic/frontier";

export interface EcommerceTargetCheck {
  isEcommerce: boolean;
  reason: string;
  suggestedWaitMs?: number;
}

const ECOMMERCE_PATH_REGEX =
  /\/(dp|gp\/product|gp\/aw\/d|product|products|item|items|p|pd|buy|shop|catalog)\/|[?&](pid|sku|variant|asin|product_id)=/i;

const ECOMMERCE_GOAL_TERMS =
  /\b(price|pricing|cost|rate|drop|discount|deal|deals|buy|stock|inventory|in-stock|mrp|cheapest|sale)\b|[₹$€£]|(\brs\.?\b)|(\binr\b)|(\busd\b)/i;

const MAJOR_MARKETPLACE_DOMAINS = new Set([
  "amazon.in",
  "amazon.com",
  "amazon.co.uk",
  "amazon.de",
  "amazon.ca",
  "flipkart.com",
  "walmart.com",
  "ebay.com",
  "bestbuy.com",
  "target.com",
  "newegg.com",
  "aliexpress.com",
  "myntra.com",
  "ajio.com",
  "croma.com",
  "reliancedigital.in",
  "tatacliq.com",
  "costco.com",
]);

export function isEcommerceOrProductTarget(
  url?: string,
  goal?: string
): EcommerceTargetCheck {
  const goalHasPriceIntent = Boolean(goal && ECOMMERCE_GOAL_TERMS.test(goal));

  if (!url) {
    return {
      isEcommerce: goalHasPriceIntent,
      reason: goalHasPriceIntent ? "Goal specifies price or product purchase intent" : "Non-ecommerce target",
    };
  }

  const rootDomain = extractRootDomain(url);
  if (MAJOR_MARKETPLACE_DOMAINS.has(rootDomain)) {
    return {
      isEcommerce: true,
      reason: `Known retail marketplace domain (${rootDomain})`,
      suggestedWaitMs: 2500,
    };
  }

  if (ECOMMERCE_PATH_REGEX.test(url)) {
    return {
      isEcommerce: true,
      reason: "URL path matches standard e-commerce product schema (/dp/, /product/, /item/, sku)",
      suggestedWaitMs: 2000,
    };
  }

  if (goalHasPriceIntent) {
    return {
      isEcommerce: true,
      reason: "Goal specifies pricing metrics across target domain",
      suggestedWaitMs: 1500,
    };
  }

  return {
    isEcommerce: false,
    reason: "Standard informational page",
  };
}

export function extractJsonLdPrices(htmlOrRawText: string): Array<{
  name?: string;
  price: string;
  currency?: string;
  availability?: string;
}> {
  if (!htmlOrRawText) return [];

  const extracted: Array<{
    name?: string;
    price: string;
    currency?: string;
    availability?: string;
  }> = [];

  const scriptMatches = htmlOrRawText.matchAll(
    /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  );

  for (const m of scriptMatches) {
    const rawContent = m[1]?.trim();
    if (!rawContent) continue;

    try {
      const data = JSON.parse(rawContent);
      const objects = Array.isArray(data) ? data : [data];

      for (const item of objects) {
        if (!item || typeof item !== "object") continue;

        const isProduct =
          item["@type"] === "Product" ||
          (Array.isArray(item["@type"]) && item["@type"].includes("Product"));

        if (!isProduct) continue;

        const productName = typeof item.name === "string" ? item.name : undefined;
        const offers = item.offers;

        if (offers && typeof offers === "object") {
          const offerList = Array.isArray(offers) ? offers : [offers];
          for (const off of offerList) {
            const rawPrice = off.price ?? off.lowPrice ?? off.highPrice;
            if (rawPrice !== undefined && rawPrice !== null && String(rawPrice).trim().length > 0) {
              const currency = typeof off.priceCurrency === "string" ? off.priceCurrency : undefined;
              const availability =
                typeof off.availability === "string"
                  ? off.availability.split("/").pop()
                  : undefined;

              extracted.push({
                name: productName,
                price: String(rawPrice),
                currency,
                availability,
              });
            }
          }
        }
      }
    } catch {
      // Non-parseable or malformed JSON-LD block
    }
  }

  return extracted;
}
