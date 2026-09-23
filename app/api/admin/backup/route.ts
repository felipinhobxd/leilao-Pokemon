import { authorize, failure } from "@/lib/backend";

// Download manual do backup completo (mesma fonte da cópia diária automática
// do bot). Idempotente por natureza (leitura), service_role-only via authorize.
export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const { db } = await authorize(request, true);
    const { data, error } = await db.rpc("export_business_backup");
    if (error) throw new Error("backup_read_failed");
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, "0");
    const filename = `leilao-backup-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}.json`;
    const payload = JSON.stringify({ exported_at: now.toISOString(), tables: data ?? {} }, null, 1);
    return new Response(payload, {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return failure(error);
  }
}
