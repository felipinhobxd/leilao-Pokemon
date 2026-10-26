import type {OperationHealth} from '@/lib/operation-health';
import {cleanupReason} from '@/lib/operation-health';
import {formatBrasiliaDateTime} from '@/lib/brasilia-time';

const when = (value?: string | null) => value ? formatBrasiliaDateTime(value,false) : 'Ainda não informado';
const labels = {
  confirmed: 'Cópia confirmada na nuvem',
  expired: 'Cópia confirmada vencida',
  object_unavailable: 'Cópia removida ou substituída',
  awaiting_confirmation: 'Aguardando confirmação do upload',
  missing: 'Nenhuma cópia com confirmação',
};
const explanations = {
  confirmed: 'A cópia foi enviada e confirmada. A limpeza ainda confere a cobertura dos registros antes de excluir.',
  expired: 'A última confirmação passou da janela de 48 horas. A limpeza aguarda uma nova cópia válida.',
  object_unavailable: 'O arquivo da confirmação não está mais disponível na mesma versão. A limpeza aguarda outra cópia válida.',
  awaiting_confirmation: 'O preparo foi registrado, mas não há upload confirmado e válido. Isso não comprova que a cópia chegou à nuvem.',
  missing: 'Arquivos antigos podem existir, mas ainda não há confirmação válida para liberar a limpeza automática.',
};

export default function BackupProtectionCard({data,writable,onBackup,backupBusy}:{data:OperationHealth;writable:boolean;onBackup:()=>void;backupBusy:boolean}) {
  const backup=data.backupProtection, worker=data.worker, cleanup=worker?.cleanup;
  const state=backup?.state;
  const known=state && Object.hasOwn(labels,state) && !data.backupReadFailed;
  return <article className="health-card backup-protection" aria-labelledby="backup-protection-title">
    <p className="eyebrow">PROTEÇÃO DOS DADOS</p><h3 id="backup-protection-title">Backup e limpeza automática</h3>
    <span className={`health-tag ${known && state==='confirmed' ? 'good' : 'attention'}`}>{known ? labels[state] : 'Confirmação indisponível'}</span>
    <p>{known ? explanations[state] : 'Não foi possível consultar a confirmação do backup. Um arquivo encontrado ou o status do bot não substitui essa conferência.'}</p>
    {known && <dl className="backup-facts">
      <div><dt>Última cópia válida</dt><dd>{backup.validSnapshotAt ? when(backup.validSnapshotAt) : 'Sem cópia válida nesta consulta'}</dd></div>
      <div><dt>Confirmação dessa cópia</dt><dd>{when(backup.validConfirmedAt)}</dd></div>
      <div><dt>Válida até</dt><dd>{when(backup.validUntil)}</dd></div>
    </dl>}
    {known && !backup.validSnapshotAt && backup.latestConfirmedAt && <p>Última confirmação registrada: {when(backup.latestConfirmedAt)}.</p>}
    <div className="cleanup-report"><h4>Última tentativa de limpeza</h4>
      <p className="muted">A limpeza automática inclui vendas, arremates e seus pagamentos após 12 horas do envio, com cobertura confirmada no backup. Itens abertos ou em revisão e avisos pendentes aguardam.</p>
      <span className={`health-tag ${cleanup?.status==='completed' && worker?.online ? 'good' : 'attention'}`}>
        {cleanup?.status==='blocked' ? 'Limpeza adiada' : cleanup?.status==='completed' ? 'Tentativa concluída' : cleanup?.status==='failed' ? 'Falha na tentativa' : 'Ainda não informada'}
      </span>
      {cleanup ? <><p>{when(cleanup.at)} · {cleanup.status==='completed' ? `${cleanup.deleted} registro(s) removido(s) nessa tentativa.` : cleanupReason(cleanup.reason)}</p><p className="muted">Esse é o resultado registrado naquele momento; não confirma a cobertura dos dados atuais.</p></> : <p className="muted">O supervisor atualizado informará o resultado no sinal que já envia ao painel.</p>}
      {!worker?.online && <p className="health-issue">Supervisor sem sinal recente. O andamento atual da limpeza não pode ser confirmado.</p>}
      {worker && worker.protectionVersion!==1 && <p className="health-issue">O supervisor ainda não informou esta proteção. Carregue a atualização na próxima manutenção planejada, sem interromper leilões.</p>}
    </div>
    {worker?.backup.at && <p>Verificação ou tentativa de backup do bot: {when(worker.backup.at)} · {worker.backup.status==='success' ? 'concluída' : worker.backup.status==='running' ? 'em preparo' : 'falhou'}.</p>}
    {worker?.backup.error && <p className="health-issue">{worker.backup.error}</p>}
    <p className="muted">Horários de Brasília. Uma cópia confirmada não certifica uma restauração. O backup manual prepara um download separado e não libera a limpeza automática.</p>
    {writable && <button className="secondary" disabled={backupBusy} onClick={onBackup}>Preparar backup manual</button>}
  </article>;
}
