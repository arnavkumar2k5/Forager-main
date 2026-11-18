import { pgTable, uuid, real, integer, timestamp } from "drizzle-orm/pg-core";
import { scouts } from "./scouts";

export const scentMetrics = pgTable("scent_metrics", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }).notNull(),
  driftScore: real("drift_score").notNull(),
  volatilityFactor: real("volatility_factor").notNull(),
  baseIntervalMinutes: integer("base_interval_minutes").notNull(),
  computedIntervalMinutes: integer("computed_interval_minutes").notNull(),
  nextRunAt: timestamp("next_run_at", { withTimezone: true }).notNull(),
  recordedAt: timestamp("recorded_at", { withTimezone: true }).defaultNow(),
});
