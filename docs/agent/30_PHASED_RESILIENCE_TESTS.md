# 30 — Testes de recuperação em três fases

Em 26/10/2026, o operador autorizou executar em fases, com apresentação do resultado e autorização antes da próxima.

| Fase | Escopo | Estado |
|---|---|---|
| 1 | Reinício durante fila e votos pendentes entre processos | Executada; evidência abaixo |
| 2 | Restauração de backup em banco isolado | Aguardar autorização específica após fase 1 |
| 3 | Limpeza de 12h condicionada à cobertura do backup | Aguardar conclusão da fase 2 e autorização |

## Fase 1 — fila real e recuperação do filho

Bot 0.2.15 conectado. Antes do ensaio: zero leilões abertos, zero filas ativas e votos pending=0/review=0. Cadastro feito pela interface autenticada, com três leilões sem imagem e nomes **TESTE REINÍCIO 1/2/3 — sem venda real**, exclusivamente no grupo **teste leilão**. Lotes 4/5/6, sem arremate, intervalo de 60s, prazo comum às 22h28 de 26/10/2026 (Brasília).

Fila `02ea4d50-3fe0-4e01-a56a-3fe42cdea41f`.

Após confirmar o primeiro dispatch como enviado e os demais ainda agendados, foi encerrado à força somente o filho Baileys identificado por PID, pai e caminho. Supervisor e painel permaneceram em execução; sessão, journal e arquivos pessoais não foram alterados.

| Ocorrência | Horário de Brasília |
|---|---|
| Primeira enquete enviada | 22:21:16.436 |
| Filho encerrado para o ensaio | 22:21:46.171 |
| Novo filho iniciado automaticamente | 22:21:51 |
| WhatsApp reconectado | 22:21:53.334 |
| Segunda enquete enviada | 22:22:09.415 |
| Terceira enquete enviada | 22:23:09.498 |

Recuperação de conexão em **7.163ms** (7,163 segundos), com processo novo após aproximadamente cinco segundos. Supervisor permaneceu o mesmo. O diagnóstico local e o resumo persistido registraram **uma interrupção, um reinício confirmado, recuperação concluída**, sem erro de armazenamento. Essa ocorrência foi provocada pelo ensaio; não indica nova queda espontânea.

Resultado: fila **completed, 3/3 enviados**, uma tentativa por dispatch, três IDs de enquete distintos. Primeiro ID `3EB025B63C9C5062A739` e horários originais permaneceram iguais antes/depois. Logs locais mostraram uma linha de envio por item e uma abertura completa da fila. O painel autenticado confirmou visualmente 3/3 concluídos. Votos reais permaneceram pending=0/review=0; não foi necessário pedir novos votos ao operador.

Essa é evidência de retomada **entre publicações**, após confirmação do primeiro envio. Não simula morte exatamente entre envio ao WhatsApp e commit no banco, falha física do PC, nem certifica ausência de duplicatas em todo cenário possível de terceiros. Mensagens já entregues não foram apagadas. Os leilões de teste seguem o prazo registrado e a limpeza padrão com cobertura de backup.

## Fase 1 — journal em dois processos isolados

Novo teste automatizado `bot/vote-inbox-restart.test.mjs`, incluído no check do bot. Usa o módulo real do journal, pasta temporária própria, dois processos Node distintos e eventos sintéticos; não abre sessão WhatsApp nem acessa Supabase.

1. O primeiro processo persiste dois votos da mesma enquete e simula confirmação idempotente do primeiro comando.
2. Encerra imediatamente com código 23 antes de o journal receber confirmação/remover o voto.
3. O segundo processo restaura a fila e retoma primeiro e segundo, nesta ordem.
4. Verifica mesmos IDs, horário original e bytes cifrados. O ledger simulado tem dois efeitos únicos, embora o primeiro comando seja tentado novamente; fila final pending=0, guard liberado.

Isso comprova preservação e replay entre processos do journal real. A idempotência do ledger é simulada; o teste não substitui os cenários de RPC/SQL nem afirma que foi criada uma falha de confirmação financeira em produção.

**124 testes do bot aprovados**, incluindo esse novo ensaio. Somente teste, comando de check e documentação foram alterados; sem migration, nova versão/runtime ou mudanças na lógica de negócio. Consultar CI do commit publicado para validação remota.

Captura local da fila: `outputs/restart-queue-phase1-20261026.png`, na pasta de trabalho da sessão e fora do Git. Consumo de produção limitado à pequena fila autorizada e consultas pontuais; sem teste de carga, backup grande adicional ou sondagem extra no Supabase. Não foi medido delta de Log Ingestion.

**Parar ao concluir esta fase e perguntar se o operador autoriza a fase 2.** Não executar restauração ou exclusão de dados apenas com base neste documento.
