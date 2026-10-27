import { createErrorReporter } from "./supabase-resilience.mjs";
const reportServiceError=createErrorReporter();
// Avisos globais: disparo da notificação aos administradores.
//
// O CONTADOR é global por participante e vive no banco
// (public.participant_warnings, idempotente por external_event_id): o RPC
// process_auction_command grava 1 aviso por redução REAL de valor e, quando o
// participante chega a EXATAMENTE 3, insere UMA linha em admin_notifications
// (também idempotente). Este módulo apenas ENTREGA a mensagem via WhatsApp:
// - marca sent_at só depois de enviar para TODOS os administradores;
// - rastreia payload.sent_to para um retry não reenviar a quem já recebeu
//   (reduz reenvios após falhas parciais confirmadas);
// - in-flight guard + intervalo mínimo para não bombardear o banco.

export function parseAdminJids(raw) {
  const value = String(raw ?? process.env.BOT_ADMIN_WA_JIDS ?? "");
  const jids = [...new Set(value.split(/[,\s]+/).map(item => item.trim()).filter(Boolean))];
  if (jids.some(jid => !/^\d{8,15}@s\.whatsapp\.net$/.test(jid))) {
    throw new Error("BOT_ADMIN_WA_JIDS inválido: use números com DDI@s.whatsapp.net separados por vírgula.");
  }
  return jids;
}

const brl = value => new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
  .format(Number(value ?? 0))
  .replace(/[\u00A0\u202F]/g, " ");
const dateTime = value => {
  const date = new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "medium", timeZone: "America/Sao_Paulo" }).format(date);
};

export function formatWarningNotification(payload) {
  const data = payload ?? {};
  const name = String(data.participant_name ?? "Participante").trim() || "Participante";
  const total = Number(data.total_warnings ?? 0);
  const lines = [
    "⚠️ USUÁRIO ATINGIU 3 AVISOS",
    "",
    `Usuário: ${name}`,
    `Total de avisos: ${total} (ciclo atual — o contador reinicia após esta notificação)`,
    "",
    "Última ocorrência:",
    `Carta: ${String(data.card_name ?? "—")}`,
    data.lot_number != null ? `Enquete / Lote: ${data.lot_number}` : "Enquete / Lote: —",
    `Valor anterior: ${brl(data.previous_amount)}`,
    `Novo valor: ${brl(data.new_amount)}`,
    `Horário: ${dateTime(data.event_at)}`,
  ];
  const history = Array.isArray(data.warnings) ? data.warnings : [];
  if (history.length > 1) {
    lines.push("", "Avisos anteriores:");
    history.slice(0, -1).forEach((warning, index) => {
      lines.push(`${index + 1}º — ${String(warning.card_name ?? "Carta")} — ${brl(warning.previous_amount)} → ${brl(warning.new_amount)}`);
    });
  }
  return lines.join("\n");
}

/** Lote que falhou de vez — DM operacional aos admins (não é aviso de usuário). */
export function formatDispatchFailedNotification(payload) {
  const data = payload ?? {};
  const lines = [
    "🚨 PUBLICAÇÃO DE LOTE FALHOU",
    "",
    data.lot_number != null ? `Lote: ${data.lot_number}` : "Lote: —",
    data.card_name ? `Carta: ${String(data.card_name)}` : null,
    data.attempts != null ? `Tentativas: ${data.attempts}` : null,
    `Erro: ${String(data.error ?? "desconhecido")}`,
    "",
    "O lote NÃO volta para a fila — verifique a tela da fila no painel e publique novamente se quiser.",
  ].filter(Boolean);
  return lines.join("\n");
}

/** Formato por tipo de notificação (o dreno entrega tudo que está pendente). */
export function formatAdminNotification(notification) {
  const kind = String(notification?.kind ?? "");
  if (kind === "DISPATCH_FAILED") return formatDispatchFailedNotification(notification.payload);
  if (kind === "NOTICE_MENTION_DENIED" || kind === "NOTICE_DELIVERY_DELAYED") {
    const data=notification.payload??{};
    const lines=[kind === "NOTICE_MENTION_DENIED" ? "⚠️ AVISO DE ENCERRAMENTO SEM @all" : "🚨 AVISO DE LEILÃO AINDA PENDENTE",
      "",`Grupo: ${String(data.group_jid??"—")}`,`Aviso: ${String(data.notice_id??"—")}`,
      kind === "NOTICE_MENTION_DENIED"
        ? "O bot não tem permissão para marcar todos. A conclusão será enviada sem @all; confirme a entrega no grupo."
        : "A entrega não foi confirmada após pelo menos dez tentativas. O aviso permanece na fila; confira a conexão e a permissão de envio no grupo.",
      data.ends_at ? `Prazo dos lances: ${dateTime(data.ends_at)} (Brasília)` : null,
      "Confira Saúde da operação no painel. Não é necessário republicar as cartas."];
    return lines.filter(line=>line!==null).join("\n");
  }
  return formatWarningNotification(notification.payload);
}

export function createAdminNotificationDrain({ db, getSocket, adminJids = parseAdminJids(), intervalMs = 15_000 }) {
  if (!adminJids.length) throw new Error("Configure BOT_ADMIN_WA_JIDS no bot/.env antes de iniciar o bot.");
  let inFlight = false;
  let lastTick = 0;
  return {
    async tick(nowMs = Date.now()) {
      if (inFlight || nowMs - lastTick < intervalMs) return 0;
      inFlight = true;
      lastTick = nowMs;
      try {
        const sock = getSocket?.();
        if (!sock || !adminJids.length) return 0;
        const { data: pending, error } = await db.from("admin_notifications")
          .select("id,participant_id,kind,payload,external_event_id,created_at")
          .is("sent_at", null)
          .order("created_at", { ascending: true })
          .limit(3);
        if (error) throw new Error(error.message);
        let delivered = 0;
        for (const notification of pending ?? []) {
          const payload = notification.payload ?? {};
          const alreadySent = new Set(Array.isArray(payload.sent_to) ? payload.sent_to : []);
          const remaining = adminJids.filter(jid => !alreadySent.has(jid));
          const sentNow = [];
          for (const jid of remaining) {
            try {
              await sock.sendMessage(jid, { text: formatAdminNotification(notification) });
              sentNow.push(jid);
            } catch (error) {
              console.error(`Aviso global: falha ao notificar ${jid}:`, error?.message || error);
            }
          }
          // Persiste progressivamente: um retry reenvia APENAS para quem não
          // recebeu com confirmação persistida. Resposta perdida ainda pode duplicar DM.
          const sentTo = [...alreadySent, ...sentNow];
          const everyone = adminJids.every(jid => sentTo.includes(jid));
          const { error: updateError } = await db.from("admin_notifications")
            .update({ payload: { ...payload, sent_to: sentTo }, sent_at: everyone ? new Date().toISOString() : null })
            .eq("id", notification.id);
          if (updateError) throw new Error(updateError.message);
          if (everyone) {
            delivered += 1;
            // Terminal: QUEM, em qual enquete/lote e quais valores — o operador
            // acompanha ao vivo sem abrir o painel.
            if (notification.kind === "NOTICE_MENTION_DENIED" || notification.kind === "NOTICE_DELIVERY_DELAYED") {
              console.log(`Aviso operacional ${notification.kind}: DM enviada a ${sentTo.length} admin(s).`);
            } else {
              console.log(`⚠️ 3 AVISOS: ${String(payload.participant_name ?? "Participante")} — última redução no lote ${payload.lot_number ?? "—"} (${payload.card_name ?? "Carta"}): ${brl(payload.previous_amount)} → ${brl(payload.new_amount)} · DM enviada a ${sentTo.length} admin(s).`);
            }
          }
        }
        return delivered;
      } catch (error) {
        reportServiceError("Aviso global: falha ao processar notificações",error);
        return 0;
      } finally {
        inFlight = false;
      }
    },
  };
}
