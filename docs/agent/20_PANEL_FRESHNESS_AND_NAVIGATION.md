# 20 — Atualização do painel e navegação

Pedido de 2026-10-25: implementar primeiro o aviso de dados desatualizados e avisar antes de passar à proteção dos rascunhos na navegação interna. Sem mudanças no bot ou migrations nesta etapa.

## Etapa 1 — atualização do painel

- Indicador próprio para a conexão do painel, separado do status operacional do bot. Distingue carregamento inicial, ausência de internet, erro de leitura, perda do canal em tempo real, dados com mais de 90s e leitura recente.
- Mostra o instante da última **leitura completa confirmada**. Consulta somente de operação não renova essa informação nem limpa uma falha anterior da leitura completa.
- Falha de rede mantém o snapshot anterior com aviso. Respostas 401/403 continuam removendo os dados protegidos e permissões locais.
- Botão de atualização completa, desabilitado durante leitura e sem internet. Fetch do painel limitado a 20s; leituras continuam sem sobreposição. Nenhum comando, voto, pagamento ou publicação é repetido pelo botão.
- Os intervalos de API já existentes (30s com leitura completa a partir de 60s) foram preservados. Eventos de visibilidade/foco retomam leituras com o throttle existente. Timer de 10s atualiza **apenas o texto da idade** em componente isolado, sem API, logs ou renderização das tabelas a cada tick. Realtime não agenda leitura com aba oculta.
- Mensagem principal usa role=status; a idade não é anunciada a cada atualização pelo leitor de tela. Layout do aviso empilha o botão no celular.

Arquivos: `app/dashboard.tsx`, `app/dashboard-freshness.tsx`, `lib/dashboard-freshness.ts`, `app/globals.css`.

Validação local: 125 testes raiz e typecheck aprovados; navegador com fixture confirmou falha de leitura mantendo dados e recuperação manual. CI adiciona cenários de falha completa seguida de operação bem-sucedida e perda/retorno de internet, no computador/celular. Não presumir resultado da CI antes de consultar o commit publicado. Não houve chamada de produção ao Supabase nem inicialização do bot.

## Etapa 2 — proteção de navegação

Ainda não iniciada neste registro. O operador pediu aviso explícito na transição. As proteções existentes de beforeunload e recuperação de publicação incerta permanecem.

Regras financeiras e recuperação de backups continuam descritas no [documento 19](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md).
