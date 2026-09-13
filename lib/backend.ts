import { createServerSupabaseClient } from "./supabase-server";

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export type AuthorizationTiming = {
  claimsMs: number;
  profileMs: number;
};

export async function authorize(request: Request, write = false) {
  const token = request.headers.get("authorization")?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw new HttpError(401, "Entre na sua conta administrativa.");
  const db = createServerSupabaseClient();

  const claimsStarted = performance.now();
  const { data: claimsData, error } = await db.auth.getClaims(token);
  const claimsMs = performance.now() - claimsStarted;
  const userId = typeof claimsData?.claims?.sub === "string" ? claimsData.claims.sub : null;
  if (error || !userId) throw new HttpError(401, "Sessão inválida ou expirada.");

  const profileStarted = performance.now();
  const { data: profile, error: profileError } = await db
    .from("admin_profiles")
    .select("role,active")
    .eq("user_id", userId)
    .single();
  const profileMs = performance.now() - profileStarted;

  if (profileError || !profile?.active || (write && !["admin", "operator"].includes(profile.role))) {
    throw new HttpError(403, "Conta sem permissão para esta operação.");
  }
  return { db, user: { id: userId }, profile, timing: { claimsMs, profileMs } satisfies AuthorizationTiming };
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

// Keep the dashboard on one database round trip while returning only fields it renders.
export async function snapshot(db: ReturnType<typeof createServerSupabaseClient>): Promise<Snapshot> {
  const { data, error } = await db.rpc("read_dashboard_snapshot");
  if (error || !data) throw new Error("database_read_failed");
  return data as Snapshot;
}
