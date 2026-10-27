import { connectionCause, type ConnectionHealth } from '@/lib/operation-health';
import { formatBrasiliaDateTime } from '@/lib/brasilia-time';

const when = (value: string) => formatBrasiliaDateTime(value, false);
export default function ConnectionHealthCard({ value, online }: { value?: ConnectionHealth | null; online: boolean }) {
  const last = value?.last;
  return <article className="health-card" aria-labelledby="connection-history-title">
    <h3 id="connection-history-title">Histórico de conexão</h3>
    {!value ? <p className="muted">O bot ainda não informou este diagnóstico. Disponível após carregar a versão 0.2.15 ou superior.</p> : <>
      <span className={`health-tag ${value.ongoing || value.storageIssue || !online ? 'attention' : 'good'}`}>{value.ongoing ? 'Recuperação pendente' : 'Histórico disponível'}</span>
      <p><strong>{value.countLimited ? 'Pelo menos ' : ''}{value.count24h} interrupção(ões)</strong> nas últimas 24 horas · {value.processRestarts24h} com reinício inesperado do processo.</p>
      <p className="muted">Monitoramento desde {when(value.monitoredSince)} (Brasília). Paradas planejadas não entram na contagem. O histórico anterior à ativação não é reconstruído.</p>
      {last ? <>
        <p>Última interrupção: <strong>{when(last.at)}</strong> (Brasília).</p>
        <p>{connectionCause[last.cause]}{last.code !== null ? ` · código ${last.code}` : ''}. {last.processRestart ? 'Houve reinício inesperado do processo.' : last.processExited ? 'Processo encerrado; reinício ainda não confirmado.' : 'Sem encerramento inesperado do processo registrado.'}{last.exitCode !== null ? ` · saída do processo: ${last.exitCode}` : ''}</p>
        {last.recoveredAt ? <p>Conexão recuperada: {when(last.recoveredAt)}. Duração{last.estimated ? ' estimada' : ''}: {last.durationMs === null ? 'não registrada' : `${Math.round(last.durationMs / 1000)} s`}.</p> : <p>{value.ongoing ? 'Aguardando confirmação de reconexão.' : 'Recuperação não registrada; uma parada planejada pode ter encerrado o acompanhamento.'}</p>}
      </> : <p>Nenhuma interrupção registrada nos últimos sete dias.</p>}
      {value.storageIssue && <p className="health-issue">Falha no arquivo local de diagnóstico. O histórico pode estar incompleto. Confira disco e permissões no computador do bot.</p>}
      {!online && <p className="health-issue">Bot sem sinal recente: este histórico não confirma a conexão atual.</p>}
      <p className="muted">Um timeout não identifica sozinho se a causa foi rede, WhatsApp ou pausa do computador. Os detalhes ficam no computador; o painel recebe somente este resumo no status existente.</p>
    </>}
  </article>;
}
