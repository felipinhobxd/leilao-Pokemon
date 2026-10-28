# Revisão completa — fase 1 (28/10/2026)

## Estado da entrega

Código local do bot **0.2.22**, com migration **20261028190535_phase_one_delivery_and_admin_retries.sql** preparada. **Migration ainda não aplicada ao projeto Supabase; supervisor/filho não iniciados nem reiniciados nesta fase.** A versão em disco não prova qual processo está em execução. A implementação depende da migration e recusa conectar ao WhatsApp se ela estiver ausente; o supervisor sinaliza o erro e aguarda Reconectar, sem repetir reinícios por esse motivo.

Autorização: “Ok, começa a fase 1”, após revisão integral e planejamento. Esta fase corrige os cinco problemas confirmados. Parar ao concluir e solicitar autorização antes da fase 2, de economia mais ampla de consultas.

## Correções

- Figurinha de abertura: somente a conta conectada ou os números de `BOT_ADMIN_WA_JIDS` podem cadastrar. Figurinha e comando precisam ter o mesmo autor autorizado na mesma conversa. Identidades de dispositivo são normalizadas; LID exige correspondência PN no mapeamento local do Baileys. Identidade não resolvida não recebe autorização. Mensagens temporárias continuam suportadas. Cache limitado a 100 pares conversa/autor, sem consulta Supabase por mensagem.
- ARREMATE: um trigger insere `buyout_confirmed` na outbox existente na mesma transação da venda. Índice parcial impede duplicação por leilão. Replay financeiro não cria novo aviso; rollback financeiro desfaz o aviso. A entrega usa ID estável, resolve a menção e conserva card/nome/valor/lote do resultado. Falha ou reinício permite nova tentativa independente do estado do voto. Não recupera retroativamente anúncios de arremates antigos. Resultados normais conservam intervalo de 15 segundos; arremate usa o fluxo imediato da outbox.
- Notificações administrativas: claim com bloqueio por linha, `SKIP LOCKED`, lease de dois minutos e finalização vinculada ao worker. Falhas ficam com espera crescente de 30 até 300 segundos e deixam passar avisos novos. Destinatários confirmados são preservados; ID de envio é estável por aviso/destinatário. Confirmação sem `key.id` não marca entrega. Tick vazio não altera registros. As regras de três avisos e reinício do contador continuam nas funções existentes.
- Cancelamento de agendamento: atualização atômica somente de `scheduled`, `failed` ou `cancelled`. Um dispatch que acabou de mudar para `sending` não é sobrescrito. A consulta extra para distinguir 404/409 só ocorre quando não houve atualização.
- Configuração numérica: heartbeat inválido usa 12s; QR inválido usa 90s; intervalo foto/enquete inválido usa 5s. Limites válidos anteriores são preservados. Retenção local/nuvem inválida desativa a poda, preservando inclusive a cópia recém-criada. Valores ausentes mantêm 30 cópias locais e sete na nuvem. Corrigida também a contagem local de arquivos mantidos.

## Banco e ativação futura

Nova migration criada pela CLI; funções com `SECURITY INVOKER`, `search_path=''` e execução somente para `service_role`. Não altera dados financeiros existentes nem apaga históricos. O backup completo inclui automaticamente as novas colunas; a restauração isolada faz parte das verificações existentes.

Ativação deve ser coordenada: **parar supervisor e filho anteriores, aplicar somente esta migration após conferir o histórico remoto, iniciar 0.2.22 e validar conexão/entrega**. Evitar manter o bot antigo ativo após instalar o trigger: ele ainda possui o envio direto de arremate. Não executar `db push` indiscriminado nem reparar divergências históricas automaticamente. Não aplicar nesta fase só porque o arquivo existe.

## Validação

- 173 testes raiz, typecheck e 163 testes do bot aprovados localmente.
- 37 suítes SQL em PGlite descartável, incluindo venda/aviso atômicos, rollback, replay, recuperação de falha, espera, progresso parcial, recuperação de lease e rejeição de confirmação por worker antigo.
- Testes da função real de backup executados com sistema de arquivos e Storage simulados: configuração inválida preserva arquivos novos e antigos; upload continua confirmado sem poda.
- Teste da rota real reproduz a corrida de cancelamento com backend isolado. Testes de mensagens verificam autorização, identidade LID, autores distintos e falha/reinício do anúncio.
- Verificação de exposição SQL sem função SECURITY DEFINER pública ou tabela indevidamente exposta.
- CI inclui explicitamente a nova suíte SQL em PostgreSQL 17, além das verificações já existentes de build, navegador, concorrência e recuperação. Registrar resultado remoto depois do push; resultado local não substitui CI.

Nenhuma consulta ao projeto Supabase, exportação completa, leitura de logs remotos ou envio ao WhatsApp foi feito nesta fase. Último consumo informado pelo usuário: **0,963 GB**, sem medição nova. Isso não significa que processos já ativos pararam de gerar logs.

Esta fase reduz repetição de falhas, não promete uma redução global mensurada em GB: claims duráveis fazem uma escrita por tentativa elegível; uma entrega bem-sucedida usa claim e confirmação. Tick administrativo vazio continua uma leitura a cada 15s. Heartbeat e descoberta a cada 5s não foram desacelerados. A fase 2 tratará consultas redundantes e rotinas ociosas com testes próprios.

Limites: IDs estáveis ajudam no replay de mensagens, mas não garantem ausência absoluta de duplicação no WhatsApp após perda de confirmação. PGlite é validação local; PostgreSQL real e ativação controlada precisam ser distinguidos. Não afirmar que tudo está corrigido em produção antes da instalação/reinício.
