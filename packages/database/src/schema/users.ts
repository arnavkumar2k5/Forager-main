import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const userPreferences = pgTable("user_preferences", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().unique(),
  location: jsonb("location"),
  firecrawlApiKey: text("firecrawl_api_key"),
  firecrawlCustomApiKey: text("firecrawl_custom_api_key"),
  firecrawlKeyStatus: text("firecrawl_key_status", {
    enum: ["pending", "active", "fallback", "failed", "invalid"],
  }).default("pending"),
  firecrawlKeyCreatedAt: timestamp("firecrawl_key_created_at", { withTimezone: true }),
  firecrawlKeyError: text("firecrawl_key_error"),
  lastTestEmailAt: timestamp("last_test_email_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const firecrawlUsageLogs = pgTable("firecrawl_usage_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  scoutId: uuid("scout_id"),
  executionId: uuid("execution_id"),
  usedFallback: boolean("used_fallback").notNull().default(false),
  fallbackReason: text("fallback_reason"),
  apiCallsCount: integer("api_calls_count").default(1),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
