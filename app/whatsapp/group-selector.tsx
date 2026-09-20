"use client";

import { useEffect, useRef, useState } from "react";
import { createPublicSupabaseClient } from "@/lib/supabase";

type Group = {
  id: string;
  name: string;
  group_jid: string;
  active: boolean;
  is_default: boolean;
  last_synced_at: string | null;
};

type Worker = {
  workerId: string;
  status: string;
  groupsSyncedAt: string | null;
} | null;

function when(value: string | null | undefined) {
  if (!value) return "—";
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toLocaleString("pt-BR") : "—";
}

export default function WhatsAppGroupSelector() {
  const [db] = useState(createPublicSupabaseClient);
  const [groups, setGroups] = useState<Group[]>([]);
  const [selected, setSelected] = useState("");
  const [worker, setWorker] = useState<Worker>(null);
  const [online, setOnline] = useState(false);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [message, setMessage] = useState("");

  async function authFetch(url: string, init?: RequestInit) {
    const { data } = await db.auth.getSession();
    if (!data.session) throw new Error("Entre no painel administrativo primeiro.");
    return fetch(url, {
      ...init,
      cache: "no-store",
      headers: { ...init?.headers, Authorization: `Bearer ${data.session.access_token}` },
    });
  }

  async function load() {
    const [groupsResponse, botResponse] = await Promise.all([
      authFetch("/api/whatsapp/groups"),
      authFetch("/api/whatsapp/bot"),
    ]);
    const groupsBody = await groupsResponse.json();
    const botBody = await botResponse.json();
    if (!groupsResponse.ok) throw new Error(groupsBody.error ?? "Falha ao carregar grupos.");
    if (!botResponse.ok) throw new Error(botBody.error ?? "Falha ao carregar bot.");
    setGroups(groupsBody.groups ?? []);
    setSelected(groupsBody.defaultGroupId ?? "");
    setWorker(botBody.worker ?? null);
    setOnline(Boolean(botBody.online));
  }

  useEffect(() => {
    // O painel só existe com o WhatsApp conectado pelo terminal (bot/CMD):
    // sem conexão ele não renderiza nada. O status é reavaliado a cada 15s
    // (e no foco da janela) para o painel aparecer sozinho assim que a
    // conexão for detectada, sem precisar recarregar a página.
    const reload = (verbose: boolean) => {
      if (document.hidden || busyRef.current) return;
      void load().catch(error => {
        if (verbose) setMessage(error instanceof Error ? error.message : "Falha ao carregar grupos.");
      });
    };
    reload(true);
    const timer = window.setInterval(() => reload(false), 15000);
    const onFocus = () => reload(false);
    window.addEventListener("focus", onFocus);
    return () => { window.clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, []);

  async function choose(groupId: string) {
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await authFetch("/api/whatsapp/groups", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ groupId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Falha ao salvar grupo padrão.");
      setSelected(groupId);
      setGroups(current => current.map(group => ({ ...group, is_default: group.id === groupId })));
      setMessage("Grupo padrão salvo.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao salvar grupo padrão.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function refreshGroups() {
    if (!worker) return;
    busyRef.current = true;
    setBusy(true);
    setMessage("");
    try {
      const response = await authFetch("/api/whatsapp/bot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "sync_groups", workerId: worker.workerId }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Não foi possível atualizar os grupos.");
      setMessage("Atualização solicitada ao bot.");
      window.setTimeout(() => void load().catch(() => undefined), 5000);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Falha ao atualizar grupos.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const current = groups.find(group => group.id === selected);
  const connected = online && worker?.status === "connected";
  // Sem WhatsApp conectado pelo terminal (CMD) o seletor não mostra nada.
  if (!connected) return null;

  return <div className="shell" style={{ paddingBottom: 0 }}>
    <section className="panel" style={{ marginBottom: 14 }}>
      <div className="panel-title">
        <div>
          <p className="eyebrow">GRUPO DO WHATSAPP</p>
          <h2>Grupo padrão</h2>
        </div>
        <button type="button" disabled={busy} onClick={() => void refreshGroups()}>Atualizar grupos</button>
      </div>

      <label>Grupo padrão
        <select value={selected} onChange={event => void choose(event.target.value)} disabled={busy}>
          <option value="">Selecione um grupo…</option>
          {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
        </select>
      </label>

      {!groups.length && <p className="muted">Nenhum grupo sincronizado ainda. Clique em “Atualizar grupos” para sincronizar.</p>}
      {worker?.groupsSyncedAt && <p className="muted">Última sincronização: {when(worker.groupsSyncedAt)}</p>}
      {message && <p className="muted">{message}</p>}

      {current && <details style={{ marginTop: 12 }}>
        <summary>Detalhes avançados</summary>
        <div className="bid-box" style={{ marginTop: 10 }}>
          <span>Nome</span>
          <strong>{current.name}</strong>
          <span>JID: {current.group_jid}</span>
          <span>Última sincronização: {when(current.last_synced_at)}</span>
        </div>
      </details>}
    </section>
  </div>;
}
