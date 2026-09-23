// Lembrete de pagamento pós-leilão: DM ao arrematante a cada N dias (padrão 7,
// BOT_PAYMENT_REMINDER_DAYS) enquanto a compra seguir sem pagamento marcado.
// SEM aviso nem punição (decisão do operador 2026-09-24): é apenas um
// lembrete em conversa privada. O ciclo para quando o painel marca
// "Pagamento recebido" (mark_purchase_paid) — a entrega sai de
// waiting_payment e a consulta não acha mais pendência.
// Idempotência: uma linha por compra em payment_reminders (purchase_id
// UNIQUE); o UPSERT incrementa reminded_count/last_reminded_at apenas
// depois do DM confirmado. Botão de parada: BOT_PAYMENT_REMINDER_MAX
// (default 5; 0 = ilimitado).
const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  .format(Number(value ?? 0)).replace(/[\u00A0\u202F]/g, " ");
const dateTime = value => {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
};

export function formatPaymentReminder(payload) {
  const data = payload ?? {};
  const name = String(data.participant_name ?? "Participante").trim() || "Participante";
  const handle = data.jid ? `@${String(data.jid).split("@")[0]}` : name;
  const lines = [
    `Olá ${handle}! 😊`,
    "",
    `Passando para lembrar do pagamento do seu arremate:`,
    `🃏 ${String(data.card_name ?? "Carta")}${data.lot_number != null ? ` — Lote ${data.lot_number}` : ""}`,
    `💰 ${brl(data.amount)}`,
    `🏆 Arrematado em ${dateTime(data.confirmed_at)}`,
    "",
    "Assim que o pagamento for confirmado aqui no painel, os lembretes param automaticamente.",
    "Qualquer dúvida, é só responder aqui. Obrigado! 🙏",
  ];
  return { text: lines.join("\n"), mentions: data.jid ? [data.jid] : [] };
}

export function createPaymentReminderDrain({ db, getSocket, resolveJid, intervalMs = 60 * 60_000, reminderDays = Number(process.env.BOT_PAYMENT_REMINDER_DAYS || 7), maxReminders = Number(process.env.BOT_PAYMENT_REMINDER_MAX ?? 5), now = () => Date.now() }) {
  let inFlight = false;
  let lastTick = 0;
  return {
    async tick(nowMs = now()) {
      if (inFlight || nowMs - lastTick < intervalMs) return 0;
      inFlight = true;
      lastTick = nowMs;
      try {
        const sock = getSocket?.();
        if (!sock) return 0;
        const days = Number.isFinite(reminderDays) && reminderDays > 0 ? reminderDays : 7;
        const cutoff = new Date(nowMs - days * 86_400_000).toISOString();
        // Pendências: entrega ainda em waiting_payment (nunca marcada paga).
        const { data: waiting, error: waitingError } = await db
          .from("deliveries").select("purchase_id").eq("status", "waiting_payment").limit(200);
        if (waitingError) throw new Error(waitingError.message);
        const purchaseIds = (waiting ?? []).map(row => String(row.purchase_id)).filter(Boolean);
        if (!purchaseIds.length) return 0;
        // Compras confirmadas fora do prazo de pagamento.
        const { data: purchases, error: purchasesError } = await db
          .from("purchases")
          .select("id,participant_id,card_id,auction_id,amount,confirmed_at")
          .eq("status", "confirmed")
          .lte("confirmed_at", cutoff)
          .in("id", purchaseIds)
          .limit(50);
        if (purchasesError) throw new Error(purchasesError.message);
        if (!purchases?.length) return 0;
        // Pagamentos já dados de baixa excluem a compra do ciclo.
        const { data: paid, error: paidError } = await db
          .from("payments").select("purchase_id").eq("status", "paid").in("purchase_id", purchaseIds).limit(200);
        if (paidError) throw new Error(paidError.message);
        const paidIds = new Set((paid ?? []).map(row => String(row.purchase_id)));
        // Estado do ciclo de lembretes (último envio + contagem).
        const { data: reminderRows, error: reminderError } = await db
          .from("payment_reminders").select("purchase_id,reminded_count,last_reminded_at").in("purchase_id", purchaseIds).limit(200);
        if (reminderError) throw new Error(reminderError.message);
        const reminders = new Map((reminderRows ?? []).map(row => [String(row.purchase_id), row]));
        const nextCutoff = new Date(nowMs - days * 86_400_000).toISOString();
        const limit = Number.isFinite(maxReminders) ? Math.max(0, maxReminders) : 5;
        let sent = 0;
        for (const purchase of purchases) {
          const id = String(purchase.id);
          if (paidIds.has(id)) continue;
          const state = reminders.get(id);
          if (state && (state.last_reminded_at ?? "") > nextCutoff) continue; // ainda dentro do intervalo de 7 dias
          if (limit > 0 && (state?.reminded_count ?? 0) >= limit) continue;   // limite atingido (0 = ilimitado)
          const jid = await resolveJid?.(purchase.participant_id);
          if (!jid) {
            console.warn(`Lembrete de pagamento: sem JID de telefone para o participante ${purchase.participant_id} (compra ${id}) — DM ignorada.`);
            continue;
          }
          const { data: person } = await db.from("participants").select("display_name").eq("id", purchase.participant_id).maybeSingle();
          const { data: card } = await db.from("cards").select("name").eq("id", purchase.card_id).maybeSingle();
          const { data: auction } = await db.from("auctions").select("lot_number").eq("id", purchase.auction_id).maybeSingle();
          const message = formatPaymentReminder({
            participant_name: person?.display_name,
            card_name: card?.name,
            lot_number: auction?.lot_number ?? null,
            amount: purchase.amount,
            confirmed_at: purchase.confirmed_at,
            jid,
          });
          await sock.sendMessage(jid, message);
          const { error: upsertError } = await db.from("payment_reminders")
            .upsert({
              purchase_id: purchase.id,
              participant_id: purchase.participant_id,
              reminded_count: (state?.reminded_count ?? 0) + 1,
              last_reminded_at: new Date(nowMs).toISOString(),
            }, { onConflict: "purchase_id" });
          if (upsertError) throw new Error(upsertError.message);
          sent += 1;
          console.log(`💌 Lembrete de pagamento enviado (compra ${id}, ${(state?.reminded_count ?? 0) + 1}º lembrete) para ${jid}.`);
        }
        return sent;
      } catch (error) {
        console.error("Lembrete de pagamento: falha no ciclo:", error?.message || error);
        return 0;
      } finally {
        inFlight = false;
      }
    },
  };
}
