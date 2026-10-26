'use client';
import Link from 'next/link';
import BackupProtectionCard from './backup-protection';
import { useRef, useState } from 'react';
import type { OperationHealth } from '@/lib/operation-health';
import { formatBrasiliaDateTime } from '@/lib/brasilia-time';

type Props = { request: (url: string, init?: RequestInit) => Promise<Response>; writable: boolean; onBackup: () => void; backupBusy: boolean };
const voteIssues: Record<string,string> = { storage_error: 'Não foi possível guardar ou atualizar votos no disco do computador. Confira espaço e permissões antes de reiniciar o bot.', capacity: 'A fila local atingiu seu limite. Há votos que precisam de atenção no computador do bot.', corrupt: 'Há um arquivo de voto ilegível. O processamento foi suspenso para preservar a ordem; não apague a fila local.', review: 'Há votos aguardando revisão. Votos sem confirmação podem reter o resultado das enquetes afetadas, sem alterar o prazo de lances.', retrying: 'O bot tentará confirmar os votos novamente, preservando a ordem de cada enquete e o prazo dos lances.' };
const when = (value?: string | null) => value ? formatBrasiliaDateTime(value, false) : 'Ainda não informado';

export default function OperationHealthPanel({ request, writable, onBackup, backupBusy }: Props) {
  const [data, setData] = useState<OperationHealth | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const lock = useRef(false);
  async function load() {
    const response = await request('/api/operations',{signal:AbortSignal.timeout(20_000)});
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.checkedAt) throw new Error(body?.error ?? 'O diagnóstico não respondeu. Tente novamente mais tarde.');
    setData(body);
  }
  async function update(id?: string, nextAttempt?: string) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      if (id) {
        const response = await request('/api/operations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id, nextAttempt }) });
        const body = await response.json().catch(() => null);
        if (!response.ok) throw new Error(body?.error ?? 'Não foi possível liberar a tentativa.');
        setNotice(body.message);
      }
      await load();
    } catch (issue) { setError(issue instanceof Error ? issue.message : 'Falha ao consultar a operação.'); }
    finally { lock.current = false; setBusy(false); }
  }
  return <section className="panel health-panel" id="operation-health" aria-labelledby="health-title" aria-busy={busy}>
    <div className="panel-title"><div><p className="eyebrow">ACOMPANHAMENTO E RECUPERAÇÃO</p><h2 id="health-title">Saúde da operação</h2><p className="muted">Entenda o que precisa de atenção e qual é o próximo passo.</p></div><button className="secondary" disabled={busy} onClick={() => void update()}>{busy ? 'Consultando…' : data ? 'Atualizar diagnóstico' : 'Verificar agora'}</button></div>
    <p className="health-caption">Consulta somente ao clicar, para economizar recursos. {data ? `Última verificação: ${when(data.checkedAt)} (Brasília). Os dados abaixo são dessa consulta.` : 'Nenhuma consulta adicional é feita ao abrir o painel.'}</p>
    {error && <p className="alert" role="alert">{error}</p>}
    <p role="status" className={notice ? 'notice' : 'sr-only'}>{notice}</p>
    {data && <>
      {data.sectionsUnavailable.length > 0 && <p className="alert" role="alert">Não foi possível consultar: {data.sectionsUnavailable.join(', ')}. Os demais resultados continuam disponíveis.</p>}
      <div className="health-grid">
        <article className="health-card"><h3>Conexão e banco de dados</h3><span className={`health-tag ${data.worker?.online && data.worker.status === 'connected' ? 'good' : 'attention'}`}>{data.worker?.online ? data.worker.status === 'connected' ? 'WhatsApp conectado' : 'Bot em reconexão' : 'Bot sem sinal recente'}</span><p>{data.worker ? `Último sinal: ${when(data.worker.heartbeat)} · versão ${data.worker.version ?? 'não informada'}` : 'Nenhum bot encontrado. Confira o programa no computador.'}</p>{data.worker?.version && data.worker.version.localeCompare("0.2.8", undefined, {numeric:true}) < 0 && <p className="health-issue">Reabra o bot atualizado para registrar diagnósticos detalhados da versão 0.2.8.</p>}{data.worker?.mention?.issue && <p className="health-issue">@all: {data.worker.mention.issue} · {when(data.worker.mention.at)}. Confira se a conta do bot é administradora do grupo.</p>}{data.worker?.issue && <p className="health-issue">{data.worker.issue}</p>}{data.worker?.database.failedAt && <p>Falha de acesso ao Supabase: {when(data.worker.database.failedAt)}. {data.worker.database.recoveredAt ? `Recuperação registrada: ${when(data.worker.database.recoveredAt)}.` : 'Aguardando recuperação confirmada.'}</p>}<p className="muted">Sem sinal recente pode indicar computador desligado, rede ou Supabase indisponível. A conexão atual do WhatsApp não pode ser confirmada nesse caso.</p><Link className="button-link secondary" href="/whatsapp">Abrir Central WhatsApp</Link></article>
        <article className="health-card"><h3>Proteção dos votos</h3>{data.worker?.votes ? <><span className={`health-tag ${data.worker.votes.review || data.worker.votes.pending || data.worker.votes.issue ? 'attention' : 'good'}`}>{data.worker.votes.review ? 'Revisão necessária' : data.worker.votes.pending || data.worker.votes.issue ? 'Atenção à fila de votos' : 'Fila local sem pendências'}</span><p>{data.worker.votes.pending} voto(s) pendente(s) · {data.worker.votes.review} para revisão.</p>{voteIssues[data.worker.votes.issue] && <p className="health-issue">{voteIssues[data.worker.votes.issue]}</p>}<p className="muted">Última informação: {when(data.worker.votes.at)}. O diagnóstico mostra o último estado informado pelo bot; consulte a fila local antes de decidir um resultado em disputa.</p></> : <p className="muted">O bot ainda não informou a proteção local de votos. A versão 0.2.11 ou superior precisa estar carregada no computador.</p>}</article>
        <BackupProtectionCard data={data} writable={writable} onBackup={onBackup} backupBusy={backupBusy} />
      </div>
      <div className="health-columns"><div><h3>Avisos de encerramento pendentes</h3><p className="muted">Até 50 avisos mais antigos. O bot tenta novamente sozinho, com intervalo mínimo de 15 segundos entre resultados do mesmo grupo.</p>{!data.notices.length && !data.sectionsUnavailable.includes('Avisos de encerramento') && <p className="empty-state">Nenhum aviso pendente nesta consulta.</p>}<ul className="health-list">{data.notices.map(row => <li key={row.id}><div><strong>{row.kind === 'queue_finished' ? 'Resumo da fila · @all' : row.kind === 'quick_poll_winner' ? 'Prêmio de quiz/brinde' : 'Resultado individual'}</strong><p>{row.locked ? 'Envio em andamento ou aguardando liberação do bot.' : `${row.attempts} tentativa(s) · próxima a partir de ${when(row.nextAttempt)}`}</p>{row.issue && <p className="health-issue">{row.issue}</p>}</div>{writable && row.retryable && <button className="secondary" disabled={busy} onClick={() => void update(row.id, row.nextAttempt)}>Tentar novamente<span className="sr-only"> {row.kind === 'queue_finished' ? 'o resumo da fila' : 'o resultado individual'} {row.id.slice(0, 8)}</span></button>}</li>)}</ul></div>
      <div><h3>Cartas com falha de publicação</h3><p className="muted">Até 30 falhas mais recentes. Confira prazo e publicação no grupo antes de criar outra fila, para evitar duplicatas.</p>{!data.failures.length && !data.sectionsUnavailable.includes('Publicações') && <p className="empty-state">Nenhuma publicação com falha nesta consulta.</p>}<ul className="health-list">{data.failures.map(row => <li key={row.id}><div><strong>{row.cardName || "Carta"} · lote {row.lot ?? "—"}</strong><p>{row.attempts} tentativa(s) · {when(row.at)}</p><p className="health-issue">{row.issue || 'Motivo não registrado pelo bot.'}</p><Link href={`/?auction=${row.auctionId}#current-auction`}>Examinar este leilão</Link></div></li>)}</ul></div></div>
    </>}
  </section>;
}
