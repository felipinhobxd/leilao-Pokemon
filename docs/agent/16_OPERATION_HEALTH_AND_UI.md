# 16 — Saúde da operação, recuperação e UI (0.2.8)

> Estado atual consolidado: [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md), bot 0.2.10, Next.js 16.4.3. Seções de versões anteriores abaixo são histórico; não reaplicar migrations ou instruções antigas automaticamente.


Implementação autorizada em 2026-10-25. O operador pediu diagnóstico e ações seguras no painel, junto de melhorias gerais de aparência, usabilidade e acessibilidade.

## O que o operador encontra

- Navegação compartilhada entre Painel, Criar leilão, Brindes e WhatsApp; tema claro, escuro ou do sistema, com preferência local.
- Área **Saúde da operação** disponível após login, inclusive quando o snapshot principal falha. **Verificar agora** busca dados uma vez; **Atualizar diagnóstico** renova explicitamente. Data/hora de Brasília identificam a consulta, sem prometer estado em tempo real.
- Sinal recente do bot, erro registrado, versão, falha/recuperação do acesso ao banco, último diagnóstico da abertura com @all, último estado de backup automático e cópias encontradas na nuvem. Sinal ausente não prova WhatsApp desconectado: computador, rede e Supabase também podem explicar.
- Até 50 avisos pendentes e 30 publicações falhas, com motivo, carta/lote e acesso à disputa quando presente no snapshot. IDs fora do histórico carregado geram aviso explícito em vez de selecionar outro leilão silenciosamente.
- **Tentar novamente** em aviso já tentado e sem lock. Autoriza nova tentativa pelo bot; o botão não envia a mensagem e não promete execução imediata. Tentativas automáticas, ordem e espaçamento mínimo de 15s/grupo continuam no bot/RPC.
- Busca de cartas e participantes sem requisições. Ações de exclusão organizadas ao fim, preservando ambas as frases escritas. Reset total fica em área avançada recolhida.

## Segurança e consistência

`GET /api/operations` autoriza perfil ativo e retorna apenas campos necessários, sem QR, credenciais, payload integral de avisos ou links assinados. Sanitiza HTML, URLs e tokens dos erros; falhas parciais aparecem como indisponíveis, sem falso “tudo certo”.

`POST /api/operations` exige admin/operator e JSON `{id,nextAttempt}`. UPDATE atômico filtra id, timestamp lido, attempts > 0, sent_at/locked_at nulos. Só antecipa next_attempt_at. Repetição com timestamp antigo retorna 409; não libera sender ativo, reseta tentativas ou recria aviso já entregue. Não existe botão de republicar carta: prazo vencido e envio parcial exigem avaliação humana.

Migration CLI `20261025073504_operation_health_and_notice_errors.sql`: worker ganha JSON de estado limitado; aviso ganha last_error. RPC existente mantém motivo no fracasso e o limpa no sucesso. Security invoker, RLS e grants service-only preservados. Instalada e registrada com mesma versão na mesma transação pelo SQL Editor, após connector retornar Unknown tool. Catálogo: quatro flags de colunas/RLS/grant verdadeiras. Total 66 arquivos locais / 74 registros remotos, sem reaplicar história divergente.

## Bot e custo

Bot **0.2.8** precisa ser reaberto para carregar supervisor e filho atualizados. Não foi iniciado/reiniciado para testar. Versões anteriores mostram aviso para atualizar a telemetria.

`operation-health.mjs` restaura último estado de backup/database/mention. Callback da requisição informa falha/recuperação; rotina de backup marca estado e abertura transmite diagnóstico por stdout ao supervisor. O heartbeat existente inclui esse JSON somente quando mudou, sem chamada extra por tique. Erro de aviso é gravado sob o lock; falha nessa gravação não impede tentativa de liberar o claim.

Nenhum polling, subscription, tabela de logs ou coleta de logs do provedor foi adicionado. Consulta de saúde tem limites; buscas/tema são locais. Não houve novo backup grande, mensagem WhatsApp, retry real, finalização ou exclusão de leilões. A medição anterior 0,88/1GB era arredondada e atrasada; não mede o consumo desta tarefa nem garante uso futuro dentro da franquia.

## UI e acessibilidade

Tokens de tema compartilhados, tipografia/espaçamento consistentes, layout 390px e tabelas com rolagem independente. Link de pular conteúdo; main focável nos estados das páginas; navegação/etapa atual nomeadas; foco visível e em título ao mudar etapa no lote; uploads alcançáveis por teclado; cabeçalhos/captions de tabelas; alvos de toque, feedback de erro/status; preferências reduced-motion/forced-colors. Edição de lote usa showModal/ESC, com bloqueio de cancelamento durante envio.

Sem bibliotecas visuais, fontes externas, grandes imagens novas ou novas dependências de produção. A auditoria axe foi instalada apenas no harness descartável fora do Git.

## Evidência e limites

- 100 testes raiz, 64 de bot; check, typecheck, build e smoke de autenticação incluindo GET/POST operations. CI inclui o novo cenário SQL.
- 21 arquivos SQL em PGlite descartável, incluindo RLS/grants e persistência/limpeza do diagnóstico. O CI executa Postgres 17; resultados de publicação devem ser verificados após push.
- Handler HTTP real com dependências injetadas verifica auth, viewer sem escrita, resposta parcial e concorrência/repetição contra aviso entregue/travado.
- Consulta real limitada do handler: 200, private/no-store, três backups, nenhum aviso pendente e uma falha. Contrato enriquecido com carta/lote: 722 bytes. Houve uma resposta parcial transitória durante a checagem, seguida de recuperação; não é prova de disponibilidade contínua.
- Componentes reais em harness HTTP com dados fictícios: diagnóstico e retry; tema claro/escuro; cadastro em lote (quatro etapas), carta única, brindes e WhatsApp. Axe WCAG 2 A/AA e 2.1 AA sem violações nas telas/estados verificados, após concluir transições visuais. Foco de etapa confirmado no navegador. Isso não certifica todos os diálogos/dados/estados, nem substitui uso com leitor de tela real.
- Tela de 390px inspecionada visualmente; buscas, preferência de tema e skip link são locais. Prévia salva em outputs externos, sem dados reais no screenshot.

P-18/P-19 e demais riscos de retenção/cobertura continuam com escopo anterior. Não implementar backlog automaticamente com base neste documento.
