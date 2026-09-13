"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Row = Record<string, any>;

type ScheduleData = {
  groups: Row[];
  dispatches: Row[];
};

type BotWorker = {
  workerId: string;
  status: string;
  heartbeatAt: string | null;
  connectedAt: string | null;
  accountJid: string | null;
  lastError: string | null;
  qrText: string | null;
  qrExpiresAt: string | null;
  groupsSyncedAt: string | null;
  version: string | null;
  sessionActive: boolean;
};

type BotData = {
  worker: BotWorker | null;
  online: boolean;
  canControl: boolean;
};

function localDateTime(value: Date) {
  const offset = value.getTimezoneOffset() * 60000;
  return new Date(value.getTime() - offset).toISOString().slice(0, 16);
}

function statusLabel(status: string) {
  return ({ scheduled: "Programado", sending: "Enviando", sent: "Enviado", failed: "Falhou", cancelled: "Cancelado" } as Record<string, string>)[status] ?? status;
}

function botStatusLabel(status: string) {
  return ({
    starting: "Iniciando",
    waiting_qr: "Aguardando QR",
    connecting: "Conectando",
    connected: "Conectado",
    reconnecting: "Reconectando",
    disconnected: "Desconectado",
    error: "Erro",
  } as Record<string, string>)[status] ?? status;
}

function when(value: string | null | undefined) {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("pt-BR") : "—";
}

export default function WhatsAppPage() {
  const [db] = useState(createPublicSupabaseClient);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<any>(null);
  const [auctions, setAuctions] = useState<Row[]>([]);
  const [cards, setCards] = useState<Row[]>([]);
  const [scheduleData, setScheduleData] = useState<ScheduleData>({ groups: [], dispatches: [] });
  const [botData, setBotData] = useState<BotData>({ worker: null, online: false, canControl: false });
  const [selectedAuction, setSelectedAuction] = useState("");
  const [scheduledAt, setScheduledAt] = useState(localDateTime(new Date(Date.now() + 60_000)));
  const [values, setValues] = useState("5, 7, 10");
  const [pollTitle, setPollTitle] = useState("💰 Para dar o seu lance, selecione um dos valores:");
  const [includeBuyout, setIncludeBuyout] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function authFetch(url: string, init?: RequestInit) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Entre no painel administrativo primeiro.");
    return fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...init?.headers, Authorization: `Bearer ${data.session.access_token}` },
    });
  }

  async function loadBot() {
    const response = await authFetch("/api/whatsapp/bot");
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? "Falha ao carregar status do bot.");
    setBotData(body);
  }

  async function load() {
    const { data: auth } = await db.auth.getSession();
    setSession(auth.session);
    setReady(true);
    if (!auth.session) return;
    const [dashboard, schedules, bot] = await Promise.all([
      authFetch("/api/dashboard"),
      authFetch("/api/whatsapp/schedules"),
      authFetch("/api/whatsapp/bot"),
    ]);
    const dashboardBody = await dashboard.json();
    const scheduleBody = await schedules.json();
    const botBody = await bot.json();
    if (!dashboard.ok) throw new Error(dashboardBody.error ?? "Falha ao carregar leilões.");
    if (!schedules.ok) throw new Error(scheduleBody.error ?? "Falha ao carregar WhatsApp.");
    if (!bot.ok) throw new Error(botBody.error ?? "Falha ao carregar status do bot.");
    setAuctions((dashboardBody.data?.auctions ?? []).filter((a: Row) => a.status === "draft"));
    setCards(dashboardBody.data?.cards ?? []);
    setScheduleData(scheduleBody);
    setBotData(botBody);
    const first = (dashboardBody.data?.auctions ?? []).find((a: Row) => a.status === "draft");
    setSelectedAuction((current: string) => current || first?.id || "");
  }

  useEffect(() => {
    void load().catch(e => setError(e instanceof Error ? e.message : "Falha ao carregar."));
    const { data: listener } = db.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => listener.subscription.unsubscribe();
  }, [db]);

  useEffect(() => {
    if (!session) return;
    const timer = setInterval(() => {
      void loadBot().catch(() => undefined);
    }, 5_000);
    return () => clearInterval(timer);
  }, [session]);

  const auction = useMemo(() => auctions.find(a => a.id === selectedAuction), [auctions, selectedAuction]);
  const card = cards.find(c => c.id === auction?.card_id);
  const dispatch = scheduleData.dispatches.find(d => d.auction_id === selectedAuction);
  const worker = botData.worker;
  const botDot = botData.online && worker?.status === "connected" ? "🟢" : botData.online ? "🟡" : "🔴";

  async function sendBotCommand(action: "reconnect" | "disconnect" | "sync_groups") {
    if (!worker) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await authFetch("/api/whatsapp/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, workerId: worker.workerId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível enviar o comando ao bot.");
      setNotice(action === "sync_groups" ? "Sincronização solicitada ao worker." : "Comando enviado ao worker.");
      setTimeout(() => void load().catch(() => undefined), action === "sync_groups" ? 4_000 : 1_500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao controlar o bot.");
    } finally {
      setBusy(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAuction) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const parsed = values.split(/[,;\n]/).map(v => Number(v.trim().replace(",", "."))).filter(v => Number.isFinite(v));
      const group = scheduleData.groups[0];
      if (!group) throw new Error("Nenhum grupo ativo do WhatsApp foi configurado.");
      const response = await authFetch("/api/whatsapp/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          auctionId: selectedAuction,
          groupId: group.id,
          scheduledAt: new Date(scheduledAt).toISOString(),
          values: parsed,
          includeBuyout,
          pollTitle,
        }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível programar.");
      setNotice("Enquete programada. O bot enviará quando chegar o horário.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao programar.");
    } finally {
      setBusy(false);
    }
  }

  async function cancel() {
    if (!selectedAuction || !confirm("Cancelar o disparo programado?")) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await authFetch("/api/whatsapp/schedules", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ auctionId: selectedAuction }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível cancelar.");
      setNotice("Agendamento cancelado.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Falha ao cancelar.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <main className="shell"><p>Carregando…</p></main>;
  if (!session) return <main className="shell"><section className="panel"><h1>WhatsApp</h1><p className="muted">Entre primeiro no painel administrativo.</p><Link href="/">Voltar para o login</Link></section></main>;

  return <main className="shell">
    <header className="topbar">
      <div><p className="eyebrow">AUTOMAÇÃO DO WHATSAPP</p><h1>Programar enquete</h1><p className="muted">Escolha um leilão em rascunho e o bot fará o disparo no horário definido.</p></div>
      <div className="actions"><Link href="/">← Painel</Link><button onClick={() => void load()} disabled={busy}>Atualizar</button></div>
    </header>

    {error && <p role="alert" className="alert">{error}</p>}
    {notice && <p role="status" className="notice">{notice}</p>}

    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">
        <div>
          <p className="eyebrow">WHATSAPP BOT</p>
          <h2>{botDot} {worker ? botStatusLabel(worker.status) : "Worker não instalado"}</h2>
          {!botData.online && <p className="muted">O worker está offline. O painel não consegue iniciar um PC desligado.</p>}
        </div>
        <span className="status-pill">{worker?.version ? `v${worker.version}` : "sem versão"}</span>
      </div>

      {worker ? <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(210px,1fr))", gap: 12 }}>
        <div className="stat-card"><span>Conta</span><strong style={{ fontSize: "1rem" }}>{worker.accountJid ?? "Aguardando conexão"}</strong></div>
        <div className="stat-card"><span>Worker</span><strong style={{ fontSize: "1rem" }}>{worker.workerId}</strong></div>
        <div className="stat-card"><span>Última atividade</span><strong style={{ fontSize: "1rem" }}>{when(worker.heartbeatAt)}</strong></div>
        <div className="stat-card"><span>Sessão</span><strong style={{ fontSize: "1rem" }}>{worker.sessionActive ? "Ativa" : "Não autenticada"}</strong></div>
      </div> : <p className="muted">Instale o serviço local para que o worker apareça aqui.</p>}

      {worker?.groupsSyncedAt && <p className="muted">Grupos sincronizados em: {when(worker.groupsSyncedAt)}</p>}
      {worker?.lastError && <p className="alert" style={{ marginTop: 14 }}>{worker.lastError}</p>}

      {botData.canControl && worker && <div className="actions" style={{ marginTop: 16 }}>
        <button disabled={busy || !botData.online} onClick={() => void sendBotCommand("reconnect")}>Reconectar</button>
        <button disabled={busy || !botData.online} onClick={() => void sendBotCommand("disconnect")}>Desconectar</button>
        <button disabled={busy || !botData.online} onClick={() => void sendBotCommand("sync_groups")}>Sincronizar grupos</button>
      </div>}

      {worker?.qrText && botData.canControl && <div style={{ marginTop: 18 }}>
        <h2>QR CODE</h2>
        <p className="muted">Expira em {when(worker.qrExpiresAt)}. Escaneie em WhatsApp → Aparelhos conectados.</p>
        <div style={{ overflowX: "auto", marginTop: 12, borderRadius: 14, background: "#000", padding: 18, width: "fit-content", maxWidth: "100%" }}>
          <pre aria-label="QR Code do WhatsApp" style={{ margin: 0, color: "#fff", background: "#000", fontFamily: "Consolas, monospace", fontSize: 11, lineHeight: 0.9, letterSpacing: 0, whiteSpace: "pre" }}>{worker.qrText}</pre>
        </div>
      </div>}
    </section>

    <section className="main-grid">
      <form className="panel form-grid" onSubmit={save}>
        <h2>Novo disparo</h2>
        <label>Leilão
          <select value={selectedAuction} onChange={e => setSelectedAuction(e.target.value)} required>
            <option value="">Selecione…</option>
            {auctions.map(a => {
              const c = cards.find(x => x.id === a.card_id);
              return <option key={a.id} value={a.id}>{c?.name ?? "Carta"} · inicial R$ {Number(a.starting_price).toFixed(2)}</option>;
            })}
          </select>
        </label>
        <label>Grupo
          <select disabled value={scheduleData.groups[0]?.id ?? ""}>
            {scheduleData.groups.map(g => <option key={g.id} value={g.id}>{g.name} · {g.group_jid}</option>)}
          </select>
        </label>
        <label>Horário do disparo<input type="datetime-local" value={scheduledAt} onChange={e => setScheduledAt(e.target.value)} required /></label>
        <label>Valores da enquete<input value={values} onChange={e => setValues(e.target.value)} placeholder="5, 7, 10" required /></label>
        <small className="muted">Separe por vírgula. O ARREMATE da carta pode ser acrescentado automaticamente. Máximo total: 12 opções.</small>
        <label>Título da enquete<input value={pollTitle} onChange={e => setPollTitle(e.target.value)} maxLength={200} required /></label>
        <label><input type="checkbox" checked={includeBuyout} onChange={e => setIncludeBuyout(e.target.checked)} /> Incluir ARREMATE quando a carta tiver valor de arremate</label>
        {card && <div className="bid-box"><span>Carta selecionada</span><strong>{card.name}</strong><span>Inicial: R$ {Number(auction?.starting_price).toFixed(2)} · ARREMATE: {auction?.buyout_price == null ? "não definido" : `R$ ${Number(auction.buyout_price).toFixed(2)}`}</span></div>}
        <div className="actions"><button disabled={busy || !selectedAuction}>{dispatch?.status === "scheduled" ? "Atualizar programação" : "Programar enquete"}</button>{dispatch && !["sending", "sent"].includes(dispatch.status) && <button type="button" disabled={busy} onClick={() => void cancel()}>Cancelar</button>}</div>
      </form>

      <aside className="panel">
        <h2>Status</h2>
        {!dispatch ? <p className="muted">Nenhum disparo programado para este leilão.</p> : <div className="events">
          <div className="event"><div><strong>{statusLabel(dispatch.status)}</strong><p>{new Date(dispatch.scheduled_at).toLocaleString("pt-BR")}</p></div></div>
          {dispatch.poll_message_id && <div className="event"><div><strong>Enquete enviada</strong><p>ID {dispatch.poll_message_id}</p></div></div>}
          {dispatch.last_error && <div className="event"><div><strong>Último erro</strong><p>{dispatch.last_error}</p></div></div>}
          <div className="event"><div><strong>Tentativas</strong><p>{dispatch.attempts}</p></div></div>
        </div>}
        <hr />
        <p className="muted">Fluxo: painel → banco → bot no PC → WhatsApp → votos → banco → painel.</p>
      </aside>
    </section>
  </main>;
}
