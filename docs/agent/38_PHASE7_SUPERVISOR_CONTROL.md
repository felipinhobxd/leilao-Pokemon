# Fase 7 — controle do supervisor em uma consulta

Autorização do operador: “sim” à unificação da leitura de logout e busca de comandos, preservando o intervalo de cinco segundos. Implementação em 27/10/2026, bot **0.2.21 ativado após CI aprovada**. As entradas anteriores dos MDs são histórico.

## Comportamento

`claim_whatsapp_bot_control(worker_id)` consulta o sinal de logout e reserva um comando na mesma transação. A linha do worker é bloqueada durante a decisão; se houver logout, retorna o sinal sem consumir comandos nem apagar a flag. Sem logout, delega à função existente `claim_whatsapp_bot_command`, preservando escopo por worker, ordem, SKIP LOCKED e recuperação de reservas de mais de dois minutos.

O supervisor mantém o timer de cinco segundos, guarda contra ciclos sobrepostos e funcionamento sem o filho conectado. Remove a sessão local antes de confirmar a flag; falha na remoção ou confirmação permanece tratada como erro e permite nova tentativa. O UPDATE de confirmação agora verifica o erro retornado pelo Supabase, antes ignorado. Nenhum logout real foi executado nesta fase.

A resposta da RPC é validada antes de executar qualquer ação, inclusive isolamento por worker. Falha de rede não causa replay imediato do claim nem remoção de sessão baseada em resposta ausente. Se a resposta de um claim confirmado se perder, continua valendo a recuperação antiga de reserva após dois minutos; não houve mudança desse prazo.

## Economia e limites

Antes, cada ciclo ocioso fazia GET do worker para logout e POST para claim. Agora faz uma RPC: **1.440 → 720 chamadas por hora nesse par**, redução de 50% somente desse caminho. Teste de uma hora simulada executa o ciclo real do supervisor extraído do código. Heartbeat, votos, prazos, avisos, backups e limpeza não tiveram intervalos alterados.

A fase 6 constatou no painel 0,91 GB / 1 GB de Log Ingestion, ciclo 12/10–12/11, com arredondamento e atualização horária. A evidência detalhada ficou privada em `outputs/phase6-log-usage-review.md` da conversa, fora do GitHub. Não repetir consultas históricas em loop, nem converter contagem de chamadas em garantia de consumo em GB. O consumo atual após esta ativação ainda não foi medido.

## Banco e testes

Migration `20261027184029_bot_supervisor_control.sql`, criada inicialmente com `supabase migration new`, e nome ajustado à versão efetivamente aplicada pelo conector. Aplicação/remota e permissões conferidas: `SECURITY INVOKER`, `search_path=''`, execução somente `service_role`; `PUBLIC`, `anon`, `authenticated` sem acesso. Sem alteração de dados de negócio ou reparação de histórico. A função anterior permanece compatível com o bot anterior durante a atualização.

Preflight: 0 filas ativas, dispatches pendentes/em envio, leilões abertos, jogos pendentes e comandos pending/running. Worker 0.2.20 conectado, logout falso e votos pending/review zero.

- **154 testes bot, 171 raiz, typecheck e 36 suítes SQL locais aprovados**.
- VM do supervisor testa ocioso, prioridade de logout, falha na remoção/ack, resposta perdida/inválida, execução desconectado, exclusão mútua e shutdown.
- SQL testa permissões, worker isolation, flag durável, ordem e reserva única, recuperação de claim antigo e IDs inválidos.
- CI inclui PostgreSQL 17 e teste com oito claims concorrentes: um único comando reservado; logout tem prioridade em todas as respostas sem perder flag/comando pendente. A execução concorrente é exclusiva do banco descartável `leilao_test`, sem tráfego de teste ao projeto real.

Advisor de segurança antes da aplicação: quatro INFO de RLS sem policy em tabelas intencionalmente privadas e WARN preexistente de proteção contra senhas vazadas desativada. Não alterados nesta fase. Referências: [tabelas privadas sem policy](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Ativação

Código enviado em `42327881`; [CI aprovada](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40562286996), inclusive 171 testes raiz, 154 bot, 60 navegador, PostgreSQL 17, oito claims concorrentes, restauração, build, scripts Windows e guards. Deploy Vercel aprovado. Advisor após a migration manteve apenas os avisos preexistentes citados acima.

Antes de reiniciar, nova conferência confirmou `has_work=false`, logout falso, zero comandos pendentes/running e votos pending/review zero. Encerrado apenas o processo pertencente a esta sessão; `npm run start` voltou com supervisor 0.2.21 e WhatsApp conectado, reutilizando o backup do dia sem exportação pesada. Sessão do terminal desta rodada: 56311. Nenhum logout real, mensagem de teste ou remoção de sessão foi executado.

Às **15:46:14 BRT**, worker 0.2.21 conectado, heartbeat das 15:46:10, logout falso e votos pending/review zero. Nenhum novo evento de queda inesperada desde a partida das 15:44:45; console sem novos erros na janela observada. É uma observação curta, não garantia de estabilidade futura.

Uma consulta agregada e limitada aos caminhos de controle, janela **15:45–15:46 BRT**: **12 POST claim_whatsapp_bot_control, zero POST claim_whatsapp_bot_command e zero GET whatsapp_bot_workers**. O heartbeat manteve **5 POST whatsapp_bot_workers** nessa janela. Isso confirma a troca de duas leituras por uma no tráfego real, sem reduzir a cadência de controle. Não houve polling de logs nem medição nova do saldo de Log Ingestion.

O commit posterior registra apenas README/MDs e estas evidências; não altera o runtime já aprovado pela CI. Fase concluída. Parar e perguntar ao operador antes de outra fase.
