import { Timing } from "./timing";
import { createServerSupabaseClient } from "./supabase-server";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export async function authorize(request: Request, write = false, timing = new Timing()) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Entre na sua conta administrativa.");
  const db = createServerSupabaseClient();
  // getClaims verifies the JWT signature locally against the cached JWKS when
  // the project uses asymmetric signing keys, removing one auth round trip per
  // request. Legacy HS256 projects fall back to getUser() automatically.
  const { data: claimsData, error } = await timing.measure("auth_getClaims", () => db.auth.getClaims(token));
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (error || !userId) throw new HttpError(401, "Sessão inválida ou expirada.");
  const { data: profile, error: profileError } = await timing.measure("admin_profiles", () => db.from("admin_profiles").select("role,active").eq("user_id", userId).single());
  if (profileError || !profile?.active || (write && !["admin", "operator"].includes(profile.role))) {
    throw new HttpError(403, "Conta sem permissão para esta operação.");
  }
  return { db, user: { id: userId }, profile };
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
export async function snapshot(db: ReturnType<typeof createServerSupabaseClient>, dashboard = false): Promise<Snapshot> {
  const { data, error } = await db.rpc(dashboard ? "read_dashboard_snapshot" : "read_auction_snapshot");
  if (error || !data) throw new Error("database_read_failed");
  return data as Snapshot;
}
