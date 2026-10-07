# 11_PENDING_WORK — Trabalho pendente (real, verificado)

> Área: Backlog
> Escopo: Bugs, melhorias, features pedidas pelo operador, dívidas, testes faltantes
> Última atualização: 2026-10-07
> Fonte principal: pedidos explícitos do operador nas sessões de trabalho + diagnóstico das sessões

## Migrations para aplicar (P-13 — ação do OPERADOR)

```text
ID: P-13
Título: Aplicar as migrations pendentes no Supabase (SQL Editor)
Prioridade: Alta (avisos no dashboard, ciclo de 3, edição de lote, exclusão de leilão, LIMITs de egress e 200 cartas só funcionam após aplicar)
Status: PARCIAL — 150000 (rascunhos), 160000 (brinde), 20260925130000 (delete_auction renomeado pelo operador), 20260925134000/135000 (queue integrity, operador) APLICADAS ou em produção.
PENDENTES (ordem lexical):
  1. 20260924180000_dashboard_warnings_snapshot.sql      (avisos no dashboard)
  2. 20260924200000_warning_cycle_reset.sql              (ciclo de 3 com reset)
  3. 20260924210000_edit_queue_item.sql                  (editar lote pendente)
  4. 20260924220000_auction_lot_sequence_no_drift.sql    (RECONCILIADA — se já colou a original, cole esta por cima)
  5. 20260925140000_max200_export_limits.sql             (200 cartas + export com LIMITs)
  6. 20260925150000_dashboard_snapshot_limits.sql       (LIMITs no snapshot do dashboard — fix de egress/log)
  7. 20261005120000_cleanup_12h_retention.sql            (limpeza 12h — RETENÇÃO NOVA, pedido do operador;
     DROPA a função cleanup_old_auctions(integer) antes de recriar com p_hours — o Postgres não aceita
     CREATE OR REPLACE com parâmetro renomeado (p_days→p_hours), era o erro do CI; a transação do arquivo
     é atômica, então colar de novo após a falha é seguro. Substitui a 20260929191637/24h em qualquer
     estado: se a de 24h ainda não foi colada, cole SÓ esta. O bot já chama p_hours=12.)
  8. 20261005130000_drop_card_recognition_examples.sql   (REMOÇÃO DO RECONHECIMENTO: apaga a tabela
     card_recognition_examples — memória de IA que não existe mais. Opcional, mas recomendado.)
  9. 20261007100000_participants_panel_commands.sql     (painel de participantes: comandos
     PARTICIPANT_SUSPEND/REACTIVATE + chave participant_warning_stats no snapshot do dashboard)
  10. 20261007110000_withdraw_rebid_reduction_warning.sql (redução via RETIRADA + re-oferta:
     colunas change_kind, função register_participant_reduction, ADDITION C no BID_PLACED,
     change_kind nos snapshots do dashboard — #10 DEPENDE da #9, aplicar em ordem)
Próximo passo: colar as 8 no SQL Editor → `npm run doctor` → smokes:
  (a) excluir leilão de teste ("sim quero") some do Excel
  (b) 3+3 reduções → 2 DMs de ciclo (com reset)
  (c) editar lote pendente na fila
  (d) export Excel funciona sem timeout
  (e) backup com cloudPath no log
  (f) regras+figurinha+@all na próxima fila (ordem correta, sem duplicar)
  (g) limpeza 12h: leilão terminal de 13h some no próximo ciclo; aberto/recente NUNCA é tocado
  (h) suspender participante com prazo → voto rejeitado (participant_not_eligible) e volta sozinho
      quando o prazo passa; reativar limpa suspensão/banimento
  (i) retirar lance e dar lance MENOR → aviso global com marca "após retirar o lance" no painel
      e coluna "Como" no Excel; 3 avisos somando os dois caminhos = 1 DM aos admins
```

## Bugs / Features pendentes

```text
ID: P-14
Título: Conversão para aplicativo desktop (.exe) — Electron wrapper
Status: ❌ CANCELADO PELO OPERADOR (2026-09-29) — a ideia do .exe foi REMOVIDA do projeto:
  electron/, desktop.yml (workflow), scripts/build-desktop.mjs, tests/desktop-packaging.test.mjs,
  deps electron/electron-builder e a config do builder foram apagadas. O projeto é 100% web:
  painel na Vercel + bot local (npm run start / serviço do Windows).
Não reabrir. Novo trabalho = melhorias web/bot.
```

```text
ID: P-15
Título: Reconhecimento automático de cartas (IA/OCR/Python)
Status: ❌ REMOVIDO PELO OPERADOR (2026-10-05) — toda a IA saiu do projeto:
  recognition/ (serviço Python, modelos, catálogo, ~7 GB de artefatos locais), lib/card-recognition-*,
  lib/card-catalog.ts (validação morta — collection não vinha da UI), /api/card-recognition/*, UI do wizard,
  scripts, workflows, benchmarks, docs, testes, dependências (@huggingface/transformers, onnxruntime-common,
  stubs) e a tabela card_recognition_examples (migration 20261005130000).
Não reabrir. Cadastro de cartas é 100% manual.
```

## Não confirmado / fora de escopo atual

- Supabase Log Ingestion: 0.96/1 GB no free plan — polling reduzido ~56%, mas os logs acumulados só resetam no próximo ciclo de billing. Monitorar.
- Conversão para desktop: ❌ CANCELADA pelo operador (2026-09-29) — toda a ideia .exe/Electron foi removida do repositório.
