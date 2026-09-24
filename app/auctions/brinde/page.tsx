"use client";

import Link from "next/link";
import type { Session } from "@supabase/supabase-js";
import { useEffect, useRef, useState } from "react";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = { id: string; name: string; is_default: boolean };
type QuickPoll = { id: string; title: string; scheduled_at: string; sent_at: string | null };

function when(value: string | null | undefined) {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("pt-BR") : "—";
}

// Brinde (P-07): enquete livre de texto/emoji publicada pelo bot no horário
// agendado — "quem clicar primeiro leva": os votos aparecem na própria
// enquete do WhatsApp, o painel apenas publica (decisão 2026-09-24).
// Movida da Central WhatsApp para a área de leilões (pedido do operador:
// botão "Brinde" no fluxo de leilões).
export default function BrindePage() {
  const [db] = useState(createPublicSupabaseClient);
  const [ready, setReady] = useState(false);
  const [session, setSession] = useState<Session | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupId, setGroupId] = useState("");
  const [title, setTitle] = useState("");
  const [options, setOptions] = useState("");
  const [whenInput, setWhenInput] = useState("");
  const [polls, setPolls] = useState<QuickPoll[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const identity = useRef<string | null>(null);

  async function authFetch(url: string, init?: RequestInit) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Entre primeiro no painel.");
    return fetch(url, { ...init, cache: "no-store", headers: { ...init?.headers, Authorization: `Bearer ${data.session.access_token}` } });
  }

  async function loadPolls() {
    try {
      const r = await authFetch("/api/quick-polls");
      const b = await r.json();
      if (r.ok) setPolls(Array.isArray(b.data) ? b.data : []);
    } catch { /* lista desatualizada não pode travar a página */ }
  }

  useEffect(() => {
    const { data: listener } = db.auth.onAuthStateChange((_e, next) => {
      identity.current = next?.user.id ?? null;
      setSession(next);
      if (!next) { setReady(true); setGroups([]); setPolls([]); }
    });
    return () => { identity.current = null; listener.subscription.unsubscribe(); };
  }, [db]);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void (async () => {
      const r = await authFetch("/api/whatsapp/groups");
      const b = await r.json();
      if (cancelled) return;
      if (!r.ok) throw new Error(b.error ?? "Falha ao carregar grupos.");
      setGroups(b.groups ?? []);
      setGroupId(b.defaultGroupId ?? b.groups?.[0]?.id ?? "");
      await loadPolls();
      setReady(true);
    })().catch(reason => { if (!cancelled) { setError(reason instanceof Error ? reason.message : "Falha ao carregar."); setReady(true); } });
    return () => { cancelled = true; };
  }, [session?.user.id]);

  async function schedule() {
    setError(""); setNotice("");
    const list = options.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const scheduledAt = whenInput ? new Date(whenInput).toISOString() : new Date().toISOString();
    if (!title.trim()) { setError("Informe o título do brinde."); return; }
    if (list.length < 2 || list.length > 12) { setError("A enquete precisa de 2 a 12 opções (uma por linha)."); return; }
    if (!groupId) { setError("Escolha o grupo do WhatsApp antes de agendar o brinde."); return; }
    setBusy(true);
    try {
      const r = await authFetch("/api/quick-polls", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ eventId: crypto.randomUUID(), groupId, title: title.trim(), options: list, scheduledAt }) });
      const b = await r.json();
      if (!r.ok) throw new Error(b.error ?? "Não foi possível agendar o brinde.");
      setNotice(`🎁 Brinde agendado para ${new Date(b.data?.scheduledAt ?? scheduledAt).toLocaleString("pt-BR")} — o bot publica a enquete automaticamente.`);
      setTitle(""); setOptions(""); setWhenInput("");
      await loadPolls();
    } catch (e) { setError(e instanceof Error ? e.message : "Falha ao agendar o brinde."); }
    finally { setBusy(false); }
  }

  if (!ready) return <main className="shell"><p>Carregando…</p></main>;
  if (!session) return <main className="shell"><section className="panel"><h1>Brinde</h1><p className="muted">Entre primeiro no painel administrativo.</p><Link href="/">Voltar</Link></section></main>;

  return <main className="shell">
    <header className="topbar"><div><p className="eyebrow">BRINDE</p><h1>Enquete rápida de brinde</h1><p className="muted">Título e opções livres (emojis ok). O bot publica a enquete no grupo no horário agendado — "quem clicar primeiro leva": os votos aparecem na própria enquete do WhatsApp.</p></div><div className="actions"><Link className="button-link" href="/auctions/new">＋ Novo leilão</Link><Link className="button-link" href="/">← Painel</Link></div></header>
    {error && <p className="alert" role="alert">{error}</p>}
    {notice && <p className="notice" role="status">{notice}</p>}
    <section className="panel">
      <div className="panel-title"><div><h2>Agendar brinde</h2><p className="muted">Publica no grupo escolhido abaixo. O bot precisa estar rodando no PC para publicar na hora — se estiver desligado, a enquete sai quando ele voltar.</p></div></div>
      <div className="giveaway-form">
        <label className="wide">Título<input value={title} onChange={e => setTitle(e.target.value)} placeholder="🎁 Brinde: quem quiser o cartão, clique primeiro!" /></label>
        <label className="wide">Opções (uma por linha, 2 a 12)<textarea rows={4} value={options} onChange={e => setOptions(e.target.value)} placeholder={"Quero! 🙋\nTô dentro 🔥\nBora! 🎉"} /></label>
        <label>Grupo do WhatsApp<select value={groupId} onChange={e => setGroupId(e.target.value)} disabled={busy || !groups.length}><option value="">Selecione…</option>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
        <label>Publicar em (opcional)<input type="datetime-local" value={whenInput} onChange={e => setWhenInput(e.target.value)} /></label>
        <button type="button" disabled={busy} onClick={() => void schedule()}>🎁 Agendar brinde</button>
      </div>
      {polls.length ? <div className="giveaway-list"><strong>Brindes recentes</strong>{polls.slice(0, 10).map(poll => <span key={poll.id} className={`giveaway-item ${poll.sent_at ? "sent" : "pending"}`}>{poll.sent_at ? "✅" : "⏳"} {poll.title} <small>{poll.sent_at ? `enviado ${when(poll.sent_at)}` : `agendado ${when(poll.scheduled_at)}`}</small></span>)}</div> : null}
    </section>
  </main>;
}
