"use server";

import { createClient } from "@/lib/supabase/server";

export interface NotificationPreferences {
  email: string;
  notifyOnComplete: boolean;
  notifyOnDrift: boolean;
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      email: "",
      notifyOnComplete: true,
      notifyOnDrift: true,
    };
  }

  const metadata = user.user_metadata || {};
  const notificationEmail =
    (metadata.notification_email as string) ||
    user.email ||
    "";

  return {
    email: notificationEmail,
    notifyOnComplete:
      typeof metadata.notify_on_complete === "boolean"
        ? metadata.notify_on_complete
        : true,
    notifyOnDrift:
      typeof metadata.notify_on_drift === "boolean"
        ? metadata.notify_on_drift
        : true,
  };
}

export async function saveNotificationPreferences(input: {
  email: string;
  notifyOnComplete: boolean;
  notifyOnDrift: boolean;
}): Promise<{ success: boolean; email: string }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    throw new Error("Unauthorized: Please sign in to save notification settings.");
  }

  const cleanEmail = input.email.trim();

  const { error } = await supabase.auth.updateUser({
    data: {
      notification_email: cleanEmail,
      notify_on_complete: input.notifyOnComplete,
      notify_on_drift: input.notifyOnDrift,
    },
  });

  if (error) {
    throw new Error(`Failed to save notification preferences: ${error.message}`);
  }

  return {
    success: true,
    email: cleanEmail,
  };
}

export interface ApiSettings {
  firecrawlApiKey: string;
  preferredProvider: string;
}

export async function getApiSettings(): Promise<ApiSettings> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return {
      firecrawlApiKey: "",
      preferredProvider: "gemini",
    };
  }

  const metadata = user.user_metadata || {};
  return {
    firecrawlApiKey: (metadata.firecrawl_api_key as string) || "",
    preferredProvider: (metadata.preferred_provider as string) || "gemini",
  };
}

export async function saveApiSettings(input: {
  firecrawlApiKey?: string;
  preferredProvider?: string;
}): Promise<{ success: boolean }> {
  const supabase = await createClient();
  const {
    data: { user },
    error: userErr,
  } = await supabase.auth.getUser();

  if (userErr || !user) {
    throw new Error("Unauthorized: Please sign in to save API settings.");
  }

  const { error } = await supabase.auth.updateUser({
    data: {
      firecrawl_api_key: input.firecrawlApiKey?.trim() || "",
      preferred_provider: input.preferredProvider?.trim() || "gemini",
    },
  });

  if (error) {
    throw new Error(`Failed to save API settings: ${error.message}`);
  }

  return { success: true };
}
