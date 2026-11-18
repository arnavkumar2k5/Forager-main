import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { env } from "@repo/config-env";

let serviceClientInstance: SupabaseClient | null = null;

export function getServiceClient(): SupabaseClient {
  if (serviceClientInstance) {
    return serviceClientInstance;
  }

  const url = env.SUPABASE_URL;
  const serviceRoleKey = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. Cannot initialize service role client."
    );
  }

  serviceClientInstance = createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  return serviceClientInstance;
}

export function resetServiceClientInstance(): void {
  serviceClientInstance = null;
}

export function getPublicClient(): SupabaseClient {
  const url = env.SUPABASE_URL;
  const anonKey = env.SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error("Missing Supabase credentials.");
  }

  return createClient(url, anonKey);
}
