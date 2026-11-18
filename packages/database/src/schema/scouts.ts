import { pgTable, uuid, text, boolean, integer, timestamp, jsonb } from "drizzle-orm/pg-core";

export const scouts = pgTable("scouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull(),
  title: text("title"),
  description: text("description"),
  goal: text("goal"),
  searchQueries: jsonb("search_queries").default([]),
  location: jsonb("location"),
  frequency: text("frequency", { enum: ["daily", "every_3_days", "weekly"] }),
  isActive: boolean("is_active").default(false),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  consecutiveFailures: integer("consecutive_failures").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const scoutMessages = pgTable("scout_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  scoutId: uuid("scout_id").references(() => scouts.id, { onDelete: "cascade" }).notNull(),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
});
