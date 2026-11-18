import { z } from "zod";

export const NotificationUrgencySchema = z.enum(["low", "medium", "high"]);
export type NotificationUrgency = z.infer<typeof NotificationUrgencySchema>;

export const ScoutNotificationSchema = z.object({
  id: z.string().uuid(),
  scoutId: z.string().uuid(),
  executionId: z.string().uuid().nullable().optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  urgency: NotificationUrgencySchema.default("medium"),
  read: z.boolean().default(false),
  createdAt: z.string(),
});
export type ScoutNotification = z.infer<typeof ScoutNotificationSchema>;

export const CreateNotificationRequestSchema = z.object({
  scoutId: z.string().uuid(),
  executionId: z.string().uuid().optional(),
  title: z.string().min(1),
  message: z.string().min(1),
  urgency: NotificationUrgencySchema.optional().default("medium"),
});
export type CreateNotificationRequest = z.infer<typeof CreateNotificationRequestSchema>;
