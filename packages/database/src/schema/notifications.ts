import { pgTable, uuid, text, boolean, timestamp } from "drizzle-orm/pg-core";
import { scouts } from "./scouts";
import { scoutExecutions } from "./executions";

export const scoutNotifications = pgTable("scout_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }).notNull(),
  executionId: uuid("execution_id").references(() => scoutExecutions.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  message: text("message").notNull(),
  urgency: text("urgency", { enum: ["low", "medium", "high"] }).default("medium").notNull(),
  read: boolean("read").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
