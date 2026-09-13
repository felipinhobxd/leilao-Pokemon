import { authorize, failure, HttpError } from "@/lib/backend";

export const runtime = "nodejs";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request);
    const { data, error } = await db
      .from("whatsapp_groups")
      .select("id,name,group_jid,active,is_default,last_synced_at,updated_at")
      .eq("active", true)
      .order("name");
    if (error) throw new Error("whatsapp_groups_read_failed");
    const groups = data ?? [];
    return Response.json({
      groups,
      defaultGroupId: groups.find(group => group.is_default)?.id ?? null,
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  try {
    const { db } = await authorize(request, true);
    if (!request.headers.get("content-type")?.includes("application/json")) {
      throw new HttpError(415, "Envie JSON.");
    }
    const body = await request.json() as Record<string, unknown>;
    const groupId = String(body.groupId ?? "");
    if (!uuid.test(groupId)) throw new HttpError(400, "Grupo inválido.");

    const { data, error } = await db.rpc("set_whatsapp_default_group", { p_group_id: groupId });
    if (error) {
      if (String(error.message).includes("whatsapp_group_not_found")) {
        throw new HttpError(404, "Grupo do WhatsApp não encontrado ou inativo.");
      }
      throw new Error("whatsapp_default_group_write_failed");
    }

    return Response.json({ defaultGroupId: data });
  } catch (error) {
    return failure(error);
  }
}
