import { pgTable, uuid, text, integer, timestamp, jsonb } from "drizzle-orm/pg-core";
import { scouts } from "./scouts";

export const scoutExecutions = pgTable("scout_executions", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }).notNull(),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  resultsSummary: jsonb("results_summary"),
  summaryText: text("summary_text"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});

export const scoutExecutionSteps = pgTable("scout_execution_steps", {
  id: uuid("id").primaryKey().defaultRandom(),
  executionId: uuid("execution_id").references(() => scoutExecutions.id, { onDelete: "cascade" }).notNull(),
  stepNumber: integer("step_number").notNull(),
  stepType: text("step_type", {
    enum: ["search", "scrape", "analyze", "summarize", "tool_call", "navigate", "extract", "finish"],
  }).notNull(),
  description: text("description").notNull(),
  inputData: jsonb("input_data"),
  outputData: jsonb("output_data"),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull(),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
