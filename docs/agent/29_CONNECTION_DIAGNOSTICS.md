# 29 — Diagnóstico de desconexões

Implementação autorizada em 26/10/2026. Bot **0.2.15** carregado e conectado; painel local reconstruído e executando com `npm run start`. Nenhuma migration ou mudança na lógica de lances/publicação/finalização.

## O que foi acrescentado

O filho emite um marcador estruturado com código e categoria quando o socket fecha. O supervisor registra uma interrupção contínua, sem contar cada tentativa de reconexão como nova queda. Ao reconectar, registra recuperação e duração. Encerramento inesperado do filho registra código de saída quando disponível; reinício é confirmado no evento de criação do próximo processo, não inferido apenas da saída.

Paradas executadas pelo supervisor para desconectar/reconectar, logout, sincronização de grupos, desligamento e manutenção noturna não iniciam uma queda inesperada. Uma parada planejada durante queda conhecida encerra seu acompanhamento sem inventar recuperação. Morte abrupta de todo o supervisor/PC pode deixar lacuna: este mecanismo não detecta retroativamente toda indisponibilidade externa. Não altera a espera de cinco segundos para reconectar.

O painel **Diagnóstico e recuperação da operação → Verificar agora → Histórico de conexão** mostra:

- Quantidade de interrupções iniciadas nas últimas 24h e quantas tiveram reinício inesperado confirmado do processo.
- Horário/categoria/código da última ocorrência retida, confirmação da recuperação e duração em segundos.
- Ausência de sinal recente, recuperação pendente, falha no armazenamento local e saturação da contagem como estados explícitos.

`408` significa perda de conexão/timeout; não comprova causa de rede, WhatsApp, pausa do computador ou relógio. Não se promete diagnóstico causal além dos dados disponíveis. Sem payloads de mensagens, contatos, URLs de erro, credenciais ou stacks neste histórico.

## Armazenamento e consumo

`bot/data/connection-history.json` (ou `BOT_DATA_DIR/connection-history.json`) é local, ignorado pelo Git, com gravação em temporário e rename. Retém até **2.048 interrupções / sete dias**, preservando a ocorrência ainda aberta. Ao atingir capacidade, remove as mais antigas e informa **pelo menos** se a contagem de 24h ficou incompleta. Expiração é conferida no heartbeat existente, sem timer adicional; escreve somente ao mudar o histórico. Falhas de disco/corrupção não derrubam o bot; corrupção preserva o arquivo para conferência e o painel informa histórico incompleto. Não é journal de lances nem garantia contra falha física do disco.

Duração usa relógio monotônico enquanto o supervisor permanece ativo; ajustes do relógio do Windows não alteram essa medição. Se uma ocorrência aberta for restaurada após reiniciar o supervisor, a diferença entre horários é marcada como **estimada**. A janela de 24h depende do horário correto do computador.

Somente um resumo limitado segue em `operational_health`, no status/heartbeat já existente. O histórico completo nunca é enviado ao Supabase. O campo só é reenviado quando muda, pela proteção existente do publicador. Não foram acrescentadas consultas periódicas, tabelas de logs, assinaturas Realtime ou backups. O JSON do status cresce algumas centenas de bytes; isso não implica consumo zero nem garante a cota de Log Ingestion. O diagnóstico da interface continua somente sob demanda.

## Validação e ativação

- 170 testes da raiz / 123 do bot, check do bot, typecheck e build local aprovados.
- Testes do histórico: retentativas agregadas, reinício confirmado, ajuste do relógio, restauração com duração estimada, paradas planejadas, janela móvel, limite de capacidade, corrupção e falha de escrita.
- API filtra categorias, datas, contagens e códigos; teste impede propagação de texto arbitrário do provedor.
- Dois novos cenários de navegador para desktop/celular: recuperação normal/timeout sem reinício e estado pendente com armazenamento falho/worker sem sinal. Incluem atualização sob demanda, acessibilidade e ausência de overflow.
- Antes da manutenção: zero leilões abertos, zero filas ativas, votos pending=0/review=0. Reinício limitado à árvore criada nesta sessão; painel e supervisor/filho 0.2.15 retomados, sem novo pareamento.
- Interface autenticada real confirmou histórico disponível, versão 0.2.15 conectada, contagem zero e início às **21h48 de 26/10/2026 (Brasília)**. Logs antigos não foram importados; não foi provocada queda real para testar este recurso.

Consultar CI/deploy do commit publicado para resultado remoto. A ativação inaugura o histórico e não elimina causas externas de desconexão. Não iniciar automaticamente as fases opcionais de simulação de queda, restauração ou limpeza de 12h.
