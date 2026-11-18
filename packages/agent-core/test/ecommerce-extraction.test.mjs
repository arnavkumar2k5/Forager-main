import test from "node:test";
import assert from "node:assert/strict";
import {
  isEcommerceOrProductTarget,
  extractJsonLdPrices,
} from "../src/normalization/ecommerce.ts";
import { extractRelevantPassages } from "../src/extraction/passages.ts";

test("isEcommerceOrProductTarget detects major marketplaces and product paths", () => {
  const amazonCheck = isEcommerceOrProductTarget(
    "https://www.amazon.in/dp/B0HGXFFGB3",
    "Track Lenovo IdeaPad price"
  );
  assert.equal(amazonCheck.isEcommerce, true);
  assert.equal(amazonCheck.suggestedWaitMs, 2500);

  const flipkartCheck = isEcommerceOrProductTarget(
    "https://www.flipkart.com/apple-iphone-15-black-128-gb/p/itm6ac6485515ae4",
    "Monitor iPhone 15 price"
  );
  assert.equal(flipkartCheck.isEcommerce, true);

  const shopifyPathCheck = isEcommerceOrProductTarget(
    "https://shop.allbirds.com/products/mens-tree-runners",
    "Track shoe stock"
  );
  assert.equal(shopifyPathCheck.isEcommerce, true);
  assert.equal(shopifyPathCheck.suggestedWaitMs, 2000);

  const genericUrlPriceGoal = isEcommerceOrProductTarget(
    "https://example.com/item-details",
    "Find lowest price and discount for laptop"
  );
  assert.equal(genericUrlPriceGoal.isEcommerce, true);

  const nonEcomCheck = isEcommerceOrProductTarget(
    "https://arxiv.org/abs/2412.19437",
    "Understand DeepSeek MLA architecture"
  );
  assert.equal(nonEcomCheck.isEcommerce, false);
});

test("extractJsonLdPrices extracts Schema.org Product offer prices accurately", () => {
  const htmlWithJsonLd = `
    <!DOCTYPE html>
    <html>
      <head>
        <script type="application/ld+json">
        {
          "@context": "https://schema.org",
          "@type": "Product",
          "name": "Lenovo IdeaPad Slim 3 2026",
          "offers": {
            "@type": "Offer",
            "price": "54990",
            "priceCurrency": "INR",
            "availability": "https://schema.org/InStock"
          }
        }
        </script>
      </head>
      <body><h1>Lenovo IdeaPad</h1></body>
    </html>
  `;

  const extracted = extractJsonLdPrices(htmlWithJsonLd);
  assert.equal(extracted.length, 1);
  assert.equal(extracted[0]?.name, "Lenovo IdeaPad Slim 3 2026");
  assert.equal(extracted[0]?.price, "54990");
  assert.equal(extracted[0]?.currency, "INR");
  assert.equal(extracted[0]?.availability, "InStock");
});

test("extractRelevantPassages boosts and preserves price sections when goal contains price intent", () => {
  const longMarkdown = `
# Lenovo IdeaPad Slim 3 Specifications
Here are the specifications for the laptop.
The laptop has an Intel Core 5 processor with 10 cores and 12 threads.
The RAM is 16GB LPDDR5 and storage is 512GB SSD NVMe.
The display is a 15.6 inch FHD IPS panel with 300 nits brightness.
Battery life is rated up to 8 hours with Rapid Charge technology.
It includes USB-C, HDMI, audio jack, and SD card reader.

## Customer Questions & Answers
Q: Does this have a backlit keyboard?
A: Yes, it has a single-color white backlit keyboard.
Q: Can RAM be upgraded?
A: Yes, one slot is expandable up to 32GB.

## Pricing and Buy Box
[Product Structured Data / Live Price]: Price: INR 54990 (InStock)
M.R.P.: ₹79,990.00
Deal Price: ₹54,990.00 (31% off)
Inclusive of all taxes. EMI starts at ₹2,666 per month.
In Stock. Sold by Appario Retail.
  `.repeat(4);

  const extracted = extractRelevantPassages(
    longMarkdown,
    "Track Lenovo IdeaPad Slim 3 price drop on Amazon India"
  );

  assert.ok(extracted.excerpt.includes("₹54,990.00") || extracted.excerpt.includes("54990"));
  assert.ok(extracted.hasDirectMatch);
});
