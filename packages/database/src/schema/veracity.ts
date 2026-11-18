import { pgTable, uuid, text, real, integer, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { scouts } from "./scouts";
import { scoutExecutions } from "./executions";

export const veracityAudits = pgTable("veracity_audits", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }),
  executionId: uuid("execution_id").references(() => scoutExecutions.id, { onDelete: "cascade" }),
  claim: text("claim").notNull(),
  overallConfidence: real("overall_confidence").notNull(),
  independentSourcesCount: integer("independent_sources_count").notNull(),
  citations: jsonb("citations").notNull().default([]),
  hasContradiction: boolean("has_contradiction").default(false),
  contradictionDetails: text("contradiction_details"),
  auditPassed: boolean("audit_passed").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
