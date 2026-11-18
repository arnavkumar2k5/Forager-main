import { customType, pgTable, uuid, text, real, timestamp } from "drizzle-orm/pg-core";
import { scouts } from "./scouts";
import { scoutExecutions } from "./executions";

export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1024)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    return typeof value === "string" ? JSON.parse(value) : value;
  },
});

export const propositions = pgTable("propositions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }).notNull(),
  executionId: uuid("execution_id").references(() => scoutExecutions.id, { onDelete: "set null" }),
  content: text("content").notNull(),
  sourceUrl: text("source_url").notNull(),
  domSelector: text("dom_selector"),
  confidence: real("confidence").default(1.0),
  embedding: vector("embedding"),
  status: text("status", { enum: ["active", "deprecated", "contradicted"] }).default("active"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
