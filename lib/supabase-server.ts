import "server-only";
import { createClient } from "@supabase/supabase-js";

export function createServerSupabaseClient() {
  if (typeof window !== "undefined") throw new Error("Server-only module");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("supabase_not_configured");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
