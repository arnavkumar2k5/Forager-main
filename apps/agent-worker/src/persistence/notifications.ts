import { ScoutNotification } from "@repo/types";
import { env } from "@repo/config-env";
import { getServiceClient, NotificationRepository } from "@repo/database";
import { server } from "../server";
import { getNotificationRepoOverride } from "./overrides";
import {
  storeInMemoryNotification,
  getInMemoryNotifications,
  markInMemoryNotificationRead,
} from "./memory-stores";

export async function saveNotificationSafe(
  notification: ScoutNotification
): Promise<{ success: boolean; warning?: string }> {
  storeInMemoryNotification(notification);

  const repoOverride = getNotificationRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.createNotification({
        id: notification.id,
        scoutId: notification.scoutId,
        executionId: notification.executionId || undefined,
        title: notification.title,
        message: notification.message,
        urgency: notification.urgency,
        read: notification.read,
      });
      return { success: true };
    } catch (err) {
      server.log.warn({ err, notificationId: notification.id }, "Overridden notification repository createNotification failed");
      return {
        success: false,
        warning: `Database persistence failed (${(err as Error).message}); notification stored in-memory only.`,
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      success: true,
      warning: "Database credentials unconfigured; notification saved to in-memory store only.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new NotificationRepository(client);
    await repo.createNotification({
      id: notification.id,
      scoutId: notification.scoutId,
      executionId: notification.executionId || undefined,
      title: notification.title,
      message: notification.message,
      urgency: notification.urgency,
      read: notification.read,
    });
    return { success: true };
  } catch (err) {
    server.log.warn({ err, notificationId: notification.id }, "Notification repository createNotification failed; failing open");
    return {
      success: false,
      warning: `Database persistence failed (${(err as Error).message}); notification stored in-memory only.`,
    };
  }
}

export async function getNotificationsSafe(
  scoutId: string
): Promise<{ notifications: ScoutNotification[]; source: "database" | "in_memory_fallback"; warning?: string }> {
  const repoOverride = getNotificationRepoOverride();
  if (repoOverride) {
    try {
      const records = await repoOverride.findByScoutId(scoutId);
      const notifications = records.map((r) => ({
        id: r.id as string,
        scoutId: r.scout_id as string,
        executionId: (r.execution_id as string) || null,
        title: r.title as string,
        message: r.message as string,
        urgency: (r.urgency as "low" | "medium" | "high") || "medium",
        read: Boolean(r.read),
        createdAt: (r.created_at as string) || new Date().toISOString(),
      }));
      return { notifications, source: "database" };
    } catch (err) {
      server.log.warn({ err, scoutId }, "Overridden notification repository findByScoutId failed; using in-memory fallback");
      return {
        notifications: getInMemoryNotifications(scoutId),
        source: "in_memory_fallback",
        warning: `Database unavailable (${(err as Error).message}); returning in-memory notifications.`,
      };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return {
      notifications: getInMemoryNotifications(scoutId),
      source: "in_memory_fallback",
      warning: "Database credentials unconfigured; returning in-memory notifications.",
    };
  }

  try {
    const client = getServiceClient();
    const repo = new NotificationRepository(client);
    const records = await repo.findByScoutId(scoutId);
    const notifications = records.map((r) => ({
      id: r.id as string,
      scoutId: r.scout_id as string,
      executionId: (r.execution_id as string) || null,
      title: r.title as string,
      message: r.message as string,
      urgency: (r.urgency as "low" | "medium" | "high") || "medium",
      read: Boolean(r.read),
      createdAt: (r.created_at as string) || new Date().toISOString(),
    }));
    return { notifications, source: "database" };
  } catch (err) {
    server.log.warn({ err, scoutId }, "Notification repository findByScoutId failed; falling back to in-memory store");
    return {
      notifications: getInMemoryNotifications(scoutId),
      source: "in_memory_fallback",
      warning: `Database unavailable (${(err as Error).message}); returning in-memory notifications.`,
    };
  }
}

export async function markNotificationReadSafe(
  notificationId: string
): Promise<{ success: boolean; warning?: string }> {
  markInMemoryNotificationRead(notificationId);

  const repoOverride = getNotificationRepoOverride();
  if (repoOverride) {
    try {
      await repoOverride.markAsRead(notificationId);
      return { success: true };
    } catch (err) {
      server.log.warn({ err, notificationId }, "Overridden notification repository markAsRead failed");
      return { success: false, warning: (err as Error).message };
    }
  }

  const supabaseUrl = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;
  const isUnconfigured =
    !supabaseUrl ||
    !serviceRoleKey ||
    supabaseUrl.includes("your-project") ||
    serviceRoleKey.includes("your-supabase");

  if (isUnconfigured) {
    return { success: true };
  }

  try {
    const client = getServiceClient();
    const repo = new NotificationRepository(client);
    await repo.markAsRead(notificationId);
    return { success: true };
  } catch (err) {
    server.log.warn({ err, notificationId }, "Notification repository markAsRead failed");
    return { success: false, warning: (err as Error).message };
  }
}
