export async function syncParticipatingGroups(sock, db) {
  if (!sock?.groupFetchAllParticipating) {
    throw new Error("Baileys não expõe groupFetchAllParticipating nesta versão.");
  }

  const groups = await sock.groupFetchAllParticipating();
  const payload = Object.values(groups ?? {}).map(group => ({
    id: String(group.id),
    name: String(group.subject || group.id),
  }));

  const { data, error } = await db.rpc("sync_whatsapp_groups", { p_groups: payload });
  if (error) throw new Error(error.message || "whatsapp_group_sync_failed");

  return {
    count: Number(data?.count ?? payload.length),
    syncedAt: String(data?.synced_at ?? new Date().toISOString()),
  };
}
