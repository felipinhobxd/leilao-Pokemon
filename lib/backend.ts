import { createServerSupabaseClient } from "./supabase-server";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function authorize(request: Request, write = false) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Entre na sua conta administrativa.");
  const db = createServerSupabaseClient();
  const { data: { user }, error } = await db.auth.getUser(token);
  if (error || !user) throw new HttpError(401, "Sessão inválida ou expirada.");
  const { data: profile, error: profileError } = await db.from("admin_profiles").select("role,active").eq("user_id", user.id).single();
  if (profileError || !profile?.active || (write && !["admin", "operator"].includes(profile.role))) {
    throw new HttpError(403, "Conta sem permissão para esta operação.");
  }
  return { db, user, profile };
}
export function failure(error: unknown) {
  if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status });
  const unconfigured = error instanceof Error && error.message === "supabase_not_configured";
  return Response.json({ error: unconfigured ? "Supabase ainda não configurado no servidor." : "Não foi possível concluir a operação." }, { status: unconfigured ? 503 : 500 });
}
export const tables = ["cards", "participants", "auctions", "bids", "auction_events", "purchases", "payments", "deliveries", "warnings"] as const;
export type Table = typeof tables[number];
export type Row = Record<string, string | number | boolean | null | Record<string, unknown>>;
export type Snapshot = Record<Table, Row[]>;
// A JSON RPC avoids PostgREST row caps and reads a consistent database snapshot.
export async function snapshot(db: ReturnType<typeof createServerSupabaseClient>): Promise<Snapshot> {
  const { data, error } = await db.rpc("read_auction_snapshot");
  if (error || !data) throw new Error("database_read_failed");
  return data as Snapshot;
}
