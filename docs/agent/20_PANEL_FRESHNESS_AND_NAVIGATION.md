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

Etapa 1 publicada em 55e6a40e; [CI aprovada](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40240037605). Validação local: 125 testes raiz e typecheck aprovados; navegador com fixture confirmou falha de leitura mantendo dados e recuperação manual. CI adiciona cenários de falha completa seguida de operação bem-sucedida e perda/retorno de internet, no computador/celular. Não presumir resultado da CI antes de consultar o commit publicado. Não houve chamada de produção ao Supabase nem inicialização do bot.

## Etapa 2 — proteção de navegação

Iniciada após aviso explícito ao operador, depois da aprovação da CI da etapa 1.

- Provider compartilhado e GuardedLink nos menus, marca e links dos cadastros em lote/único. Ao mudar de página com alterações, abre confirmação acessível com foco inicial em **Continuar editando**. Âncoras na mesma página, downloads e nova aba não são bloqueados.
- Cadastro em lote: **Salvar rascunho e sair** só navega se o salvamento terminar sem pendências. Falha de API, recusa de salvar sem fotos ou imagens ainda locais mantém a página e mostra orientação. Salvar/abrir um rascunho completo não cria um aviso falso ao sair.
- Considera fotos ainda locais mesmo quando os textos do rascunho já foram salvos parcialmente; arquivos principais já enviados, com URL, não contam como pendentes.
- Cadastro único: alerta ao descartar alterações/fotos; não oferece salvamento de rascunho que esse fluxo não suporta. Navegação não publica nada.
- Enquanto há preparação/salvamento/publicação em andamento, a confirmação pede aguardar; não aborta/reenvia comandos. Publicação incerta tem aviso próprio, sem botão de salvar como rascunho. O mecanismo de recuperação por identidade/sessionStorage foi preservado.
- beforeunload centralizado conserva o aviso nativo ao fechar/recarregar quando o navegador permite. Não se altera history.pushState/popstate nem se adicionam entradas falsas no histórico. **O diálogo cobre os links internos citados, não promete bloquear Voltar/Avançar do navegador em uma transição interna do Next.** Navegadores podem limitar beforeunload, sobretudo ao encerrar aplicativos em celulares. A documentação da [Navigation API do Chrome](https://developer.chrome.com/docs/web-platform/navigation-api#example_usage) descreve os limites de cancelamento do histórico. Não anunciar proteção universal contra fechamento forçado.

Arquivos: app/navigation-guard.tsx, lib/navigation-guard.ts, app/layout.tsx, app/site-navigation.tsx e os dois wizards. Sem persistir arquivos/fotos em localStorage nem novas consultas automáticas.

Validação local acumulada: **127 testes raiz**, typecheck e build aprovados. Navegador com fixture confirmou aviso, foco, salvar e sair, retorno para o cadastro, reabertura com o mesmo nome e saída sem aviso de rascunho já salvo. CI inclui falha de salvamento mantendo campos, descarte explícito no cadastro único e fluxos de recuperação, desktop/celular; consultar resultado do commit final antes de declarar sucesso remoto. Nenhuma chamada ao Supabase de produção, alteração de migration/arquivo do bot ou mensagem real nesta rodada.

Regras financeiras e recuperação de backups continuam descritas no [documento 19](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md).
