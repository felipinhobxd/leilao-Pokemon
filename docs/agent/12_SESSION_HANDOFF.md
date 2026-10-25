# 12 — Handoff atual

Estado consolidado em [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md). Projeto D:\LeilaoPokemon, remoto felipinhobxd/leilao-Pokemon, main. Autor F <felipinhovecoski@gmail.com>.

Bot 0.2.10 / Next 16.4.3. Migration 20261025181640 instalada/registrada; total 68 local / 76 remoto, divergências antigas preservadas. Não usar db push/repair geral. Não iniciar bot em testes; reabrir supervisor/filho é ação operacional do operador após atualizar.

Revisão implementada: recuperação de criação com identidade estável/sessionStorage, disputa a partir dos lances elegíveis completos, detalhes/rascunho corrigidos, autosave honesto, consultas de fila limitadas, ciclo de abertura sem sobreposição, controles de reconexão e UI com busca/tipos/paginação/compras/celular. CI ganha regressões de navegador com fixtures.

Validação local e catálogo no documento 18. Conferir CI/deploy do commit final, sem assumir sucesso antes do resultado. Preservadas as regras de exclusão escolhidas; riscos de retenção/cobertura seguem explícitos. Meta de Log Ingestion 1GB sem medição atual de consumo.
