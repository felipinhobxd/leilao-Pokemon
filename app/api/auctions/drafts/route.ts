import { authorize, failure, HttpError } from "@/lib/backend";
import { AUCTION_DRAFT_MAX_BYTES, AUCTION_DRAFT_MAX_CARDS } from "@/lib/auction-draft";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// GET  /api/auctions/drafts            → list (id, title, updated_at) — payloads stay in the DB
// GET  /api/auctions/drafts?draftId=…  → full draft (payload included)
export async function GET(request: Request) {
  try {
    const { db, user } = await authorize(request);
    const draftId = new URL(request.url).searchParams.get("draftId") ?? "";
    if (draftId) {
      if (!uuid.test(draftId)) throw new HttpError(400, "Rascunho inválido.");
      const { data, error } = await db.from("auction_drafts")
        .select("id,title,payload,updated_at")
        .eq("id", draftId)
        .eq("created_by", user.id)
        .maybeSingle();
      if (error) throw new Error("draft_read_failed");
      if (!data) throw new HttpError(404, "Rascunho não encontrado.");
      return Response.json({ draft: data }, { headers: { "Cache-Control": "no-store" } });
    }
    const { data, error } = await db.from("auction_drafts")
      .select("id,title,updated_at")
      .eq("created_by", user.id)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) throw new Error("draft_read_failed");
    return Response.json({ drafts: data ?? [] }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

// POST /api/auctions/drafts → save/refresh (upsert by client-generated draftId)
export async function POST(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) throw new HttpError(415, "Envie JSON.");
    const body = await request.json() as Record<string, any>;
    const draftId = String(body.draftId ?? "");
    if (!uuid.test(draftId)) throw new HttpError(400, "Rascunho inválido (identificador).");
    const title = String(body.title ?? "").trim();
    if (!title || title.length > 120) throw new HttpError(400, "O nome do rascunho precisa ter entre 1 e 120 caracteres.");
    const state = body.state;
    if (typeof state !== "object" || state === null || Array.isArray(state)) throw new HttpError(400, "Rascunho inválido.");
    if (!Array.isArray(state.cards) || state.cards.length < 1 || state.cards.length > AUCTION_DRAFT_MAX_CARDS) {
      throw new HttpError(400, `O rascunho precisa ter entre 1 e ${AUCTION_DRAFT_MAX_CARDS} cartas.`);
    }
    if (JSON.stringify(state).length > AUCTION_DRAFT_MAX_BYTES) throw new HttpError(400, "Rascunho muito grande — reduza o número de cartas.");
    const { data, error } = await db.rpc("upsert_auction_draft", { p_payload: { draftId, title, state }, p_admin_user_id: user.id });
    if (error) {
      const message = String(error.message ?? "");
      if (/invalid_draft_id|invalid_draft_title|invalid_draft_state/i.test(message)) throw new HttpError(400, "Rascunho recusado pelo banco — confira as cartas e tente de novo.");
      if (/draft_not_found/i.test(message)) throw new HttpError(404, "Rascunho não encontrado (pode ter sido excluído em outra aba).");
      if (/draft_save_conflict/i.test(message)) throw new HttpError(409, "O rascunho acabou de ser salvo em outra aba — tente de novo.");
      throw new Error("draft_save_failed");
    }
    return Response.json({ draft: data }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

// DELETE /api/auctions/drafts?draftId=… → discard (idempotent: missing row is success)
export async function DELETE(request: Request) {
  try {
    const { db, user } = await authorize(request, true);
    const draftId = new URL(request.url).searchParams.get("draftId") ?? "";
    if (!uuid.test(draftId)) throw new HttpError(400, "Rascunho inválido.");
    const { data, error } = await db.rpc("delete_auction_draft", { p_draft_id: draftId, p_admin_user_id: user.id });
    if (error) throw new Error("draft_delete_failed");
    return Response.json({ deleted: Number((data as { deleted?: number } | null)?.deleted ?? 0) > 0 }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}
