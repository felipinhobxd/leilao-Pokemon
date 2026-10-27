# 36 — Auditoria GLM, fase 4: ativação e validação real

Autorizada pelo operador em 27/10/2026: ativar a versão atual e validar as regras da fase 3 no grupo **teste leilão**. O operador realizou os cliques no próprio celular. Todos os itens foram identificados como teste sem venda/prêmio real. Horários abaixo em Brasília.

## Ativação e correção encontrada

Build local atualizado concluído e `npm run start` executado. O bot 0.2.18 conectou usando a sessão existente. Não havia leilão aberto, fila, jogo ou aviso pendente na conferência anterior à partida.

Na primeira partida, limpeza e backup diário disputaram o preparo do backup. A limpeza falhou de modo seguro, com zero exclusões naquele ciclo. Consulta pontual dos logs do PostgreSQL mostrou recusa no advisory lock de `prepare_business_backup`; o outro preparo concluiu, foi transferido e confirmado na nuvem às **14:00:46**, com 35.206.404 bytes de JSON no recibo. Não é o tamanho compactado nem volume de logs.

Causa reproduzida com as funções reais do supervisor: `dailyBackup` testava `backupBusy` antes de `await getTodayKey`, mas não depois. Enquanto esse await cedia a execução, `ensureCloudBackupForCleanup` podia reservar o mesmo slot. O código anterior tentou duas exportações no ensaio isolado. A nova verificação de `backupBusy/shuttingDown` após o await limita os dois caminhos a uma exportação. Três testes cobrem ambas as ordens, dois ciclos diários concorrentes, shutdown, recibo existente e falha sem liberar limpeza.

Bot atualizado para **0.2.19**, com reinício controlado do conjunto local antes da criação da fila. Na nova partida reutilizou o backup confirmado do dia, sem nova exportação pesada, e conectou ao WhatsApp. A manutenção normal removeu uma fila antiga já elegível, sem remover cartas, leilões ou compras nesse ciclo. Não se desativou a proteção da limpeza.

## Fluxo real validado

Fila `87b097b5-7c3d-4b74-96d7-7c20524a9019`, criada pelo cadastro em lote autenticado em `http://localhost:3000`, grupo de teste confirmado, intervalo de 30s, prazo comum **14:24**. Não houve publicação em outro grupo.

- Regras atualizadas enviadas às **14:06:19**; abertura com @all nativo registrada às **14:06:23**.
- Lote 1, “TESTE FASE 4 — retirada (sem venda real)”: publicação registrada às **14:08:05**. Primeiro lance com instante de origem **14:08:14.521**, retirada aceita às **14:08:27.428**: **12,907s**, lance marcado `withdrawn`.
- Novo lance de R$ 1 às **14:08:40.265**. Operador retirou no celular às **14:10:16.558**, após **96,293s**. Banco recusou com `withdrawal_window_expired`, bot registrou `BID_WITHDRAWN_AFTER_WINDOW` e manteve o lance de R$ 1 ativo. Não apagou o estado aceito; diagnóstico confirmou **pending=0/review=0**.
- Quiz enviado às **14:08:34.870**, primeiro acerto confirmado às **14:08:45.924**, anúncio do vencedor entregue às **14:08:46.378**.
- Brinde enviado às **14:09:04.752**, primeiro acerto confirmado às **14:09:11.534**, anúncio do vencedor entregue às **14:09:12.028**. Antes dos jogos não havia compras no projeto; ambos premiaram sem compra anterior e sem cobrança pelos jogos.
- Quarto item identificado como “falha simulada NÃO PUBLICAR” foi marcado `failed` antes de qualquer anúncio/enquete, com filtro por ID, fila, grupo, nome e timestamps nulos. **É simulação controlada de estado terminal, não falha real de rede/Baileys.** Não alterou lotes alheios nem reenviou mensagens.
- Fila ficou `completed` com três publicações e uma falha. `queue_finished` preservou `ends_at=14:24`, `published_count=3`, `failed_count=1`, `not_published_count=1`, e foi entregue às **14:09:11.601**, sem erro. A tela confirmou “3 de 4 publicados” e “Concluída”.

O prazo das 14:24 foi mantido; não se adiantou o relógio nem se apagou o lance para tornar o teste verde. Os registros são de simulação identificada, sem venda/prêmio efetivo. A retirada recusada não depende de o WhatsApp continuar mostrando o voto marcado: a autoridade é o lance aceito no banco.

A fila para de consultar automaticamente após concluir a publicação. Vencedor que chega depois desse momento aparece ao recarregar a página; isso foi feito para conferir ambos. Evidência visual local, fora do Git: `outputs/phase4-live-queue.jpg` na pasta de trabalho da revisão, sem dados de outros participantes.

## Verificação, limites e operação

- **144 testes bot** aprovados localmente (incluindo os três novos de concorrência do backup); build web local aprovado. Os 171 testes raiz e os testes SQL da fase 3 continuam na CI.
- Histórico local sem nova queda inesperada após a partida corrigida; paradas de manutenção/ativação são planejadas e não são evidência de indisponibilidade espontânea. A duração observada e o estado final devem ser conferidos no encerramento da rodada; não é garantia de disponibilidade futura.
- A abertura coletiva foi exercitada em grupo pequeno. O fallback por falta de administrador e perdas de confirmação continuam cobertos pelos testes isolados da fase 2, sem remover permissões reais do grupo para forçar erro.
- Foram usadas consultas pontuais de estado/catálogo e uma consulta de logs limitada à janela de 20s da falha, sem loop de logs. Houve o backup diário normal da primeira partida; nenhuma repetição pesada forçada após a correção. Não se mediu a quota e não se garante consumo mensal abaixo de 1GB. O polling normal do bot permanece ativo enquanto conectado.
- Advisors preservaram os avisos preexistentes: quatro INFO de [RLS sem policy nas tabelas privadas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) e WARN de [proteção de senhas vazadas desativada](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection). Nenhuma configuração de Auth/RLS foi alterada nesta fase.
- Mensagens históricas de enquetes já excluídas chegaram na sincronização e foram diagnosticadas como desconhecidas; isso não é queda do socket nem confirmação de votos novos. Os testes acima têm IDs próprios e auditoria no banco.

Nenhuma migration nova nesta fase. Bot **0.2.19 ativo**, painel local no ar, sessão preservada. Conferir CI/deploy do commit da correção antes de declarar aprovação remota. Depois, apresentar os resultados e parar; qualquer próxima fase depende de nova autorização.

## Conferência final — 14h24

O prazo não foi alterado. O banco encerrou o lote às **14:24:07.522**, apurando o lance de teste de **R$ 1** por maior lance; criou exatamente uma compra de simulação vinculada à carta identificada como “sem venda real”. O resultado individual foi entregue às **14:24:08.452**, uma tentativa, sem erro. Não é venda/pagamento efetivo. Esse registro de teste foi preservado para a trilha de validação e segue a política de limpeza automática com backup; não houve exclusão manual nem baixa de pagamento fictícia.

Às **14:24:45**, worker **0.2.19 conectado**, backup confirmado, votos **pending=0/review=0**, sem nova queda inesperada desde a partida corrigida (aproximadamente 22 minutos). Isso é a janela observada, não certificação de estabilidade futura.

CI da correção `702a2482` aprovada: [execução 590](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40548647069). **171 testes raiz, 144 bot, 60 navegador**, PostgreSQL 17, restauração, concorrência, build, scripts Windows e guards aprovados; deploy Vercel aprovado. A instalação do Chromium na CI demorou mais nesta execução, mas concluiu sem alteração de produto. O commit posterior registra apenas esta evidência em Markdown; não altera o runtime já validado.
