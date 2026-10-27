# Fase 5 — consultas ociosas (27/10/2026)

Autorização: operador respondeu “sim” à proposta de reduzir consultas ociosas para poupar Log Ingestion. Bot **0.2.20**, com ativação controlada após testes locais. Nenhuma mensagem de teste nova foi enviada ao WhatsApp nesta fase.

## Mudança

O ciclo continua a cada cinco segundos, serializado. Quando o banco confirma ausência de trabalho, uma RPC `bot_has_pending_work` substitui as quatro consultas vazias de abertura, claim de publicação, finalização e publicação de quiz/brinde. A consulta usa `EXISTS`, retorna apenas um booleano e não transfere cartas, imagens ou participantes.

O resultado **ocioso não é guardado em cache**: trabalho criado pelo painel ou outro processo é descoberto no próximo ciclo normal. Resultado ativo fica válido por 60 segundos, durante os quais as rotinas originais continuam rodando a cada ciclo; isso não adia publicações nem o encerramento. A validade usa relógio monotônico local. Filas futuras, dispatches agendados/em envio, leilões abertos e jogos ainda não enviados mantêm o caminho ativo. Dispatch em fila pausada e jogo futuro também conservam o caminho ativo: a otimização é deliberadamente conservadora.

Se a RPC falhar, faltar a migration ou vier uma resposta inválida, o bot mantém o comportamento anterior e tenta a descoberta novamente após 60 segundos. O erro usa o limitador de logs já existente. Não há repetição automática de escritas.

Votos por evento, journal, Redis, comandos do supervisor, heartbeat, backup e limpeza mantêm seu funcionamento. O drain de avisos agora é chamado independentemente de haver trabalho ativo: um resultado, vencedor de quiz/brinde ou conclusão pendente não pode ficar preso porque sua fila já terminou. Seu backoff e espaçamento de resultados de 15 segundos continuam preservados. Abertura continua antes dos lotes e finalização continua depois da drenagem de votos.

## Banco e segurança

Migration local/remota: `20261027182113_bot_idle_work_discovery.sql`, aplicada e conferida. Função `SECURITY INVOKER`, `search_path=''`, somente `service_role`; execução negada para `PUBLIC`, `anon` e `authenticated`. Sem alteração de dados, histórico de migrations, regras de lance ou índices. As consultas usam os estados e índices existentes, e param no primeiro registro encontrado.

Antes da ativação: zero filas scheduled/running, dispatches scheduled/sending, leilões abertos, jogos não enviados e avisos pendentes. Worker anterior 0.2.19 conectado, votos pending/review zero. Reinício controlado via processo pertencente a esta sessão; `npm run start` iniciou site e supervisor 0.2.20, WhatsApp conectado. Backup do dia já existente foi reutilizado, sem nova exportação pesada.

## Validação e limites

- **148 testes bot**, **171 testes raiz**, typecheck e **35 suítes SQL locais** aprovados; varreduras SQL sem função SECURITY DEFINER pública ou nova exposição de tabelas. CI inclui explicitamente o novo teste SQL para PostgreSQL 17.
- Teste do ciclo de produção extraído do código verifica manutenção de votos/avisos/admins/lembretes em modo ocioso e ordem abertura → dispatch / votos → finalização → avisos.
- Testes cobrem descoberta no ciclo seguinte, cache apenas positivo, erros/timeout/migration ausente e respostas inválidas. SQL cobre fila futura/em andamento/pausada, claim travado, leilão aberto antes do prazo e jogo avulso futuro/enviado, além das permissões.
- Uma hora **simulada**, sem chamadas ao Supabase: 720 verificações em lugar de 2.880 consultas vazias nesses quatro caminhos, redução de **75% apenas desses caminhos ociosos**. Não é medição de bytes de log, de tráfego global ou do consumo real da franquia.

O consumo atual de Log Ingestion não foi medido nesta fase. Não se pode converter essa redução em garantia de ficar abaixo de 1 GB: tráfego real, outros serviços e logs do Supabase também contam. Consultas administrativas foram pontuais; não houve exportação ou teste de carga em produção. Não repetir os testes reais da fase 4 sem necessidade.

Conferir CI/deploy e saúde final antes do encerramento. Após esta fase, parar e perguntar ao operador antes de qualquer nova etapa.
