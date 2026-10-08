// Log em tempo real do voto recebido. Extraído de index.mjs para ser testável
// (2026-10-08): a re-oferta pós-RETIRADA agora mostra o valor retirado e marca
// a REDUÇÃO. O aviso global é registrado pelo RPC (register_participant_reduction,
// migration 20261007110000); antes o terminal só dizia "🗳️ Voto recebido" e a
// redução ficava invisível até o painel atualizar.
const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value));

export function describeVoteReceived({ displayName = "", contact = "", amount, lot = null, withdrawnAmount = null } = {}) {
  const name = `${displayName}${contact}`;
  if (withdrawnAmount == null) {
    return `🗳️ Voto recebido: ${name} → ${brl(amount)}`;
  }
  const reduced = Number(amount) < Number(withdrawnAmount);
  const lotLabel = lot != null && String(lot).trim() ? String(lot).trim() : "—";
  return `🗳️ Voto após retirada: ${name} → retirou ${brl(withdrawnAmount)} → ${brl(amount)} · lote ${lotLabel}${reduced ? " · ⚠️ redução: aviso global registrado" : ""}`;
}
