# SESSION HANDOFF

## Última atualização
2026-09-25 (rodada 10: REGRAS DO LEILÃO antes da figurinha — texto da operadora; reconcile da migration de sequence do operador; delete_auction security definer)

## Rodada 10 (o que foi feito)
1. **REGRAS DO LEILÃO (pedido da operadora, texto verbatim)**: `sendRulesAnnouncements()` no bot — envia as regras ANTES da figurinha+"O leilão vai começar!" (default `BOT_RULES_MINUTES_BEFORE=2` min antes do anúncio, ou seja T-7 da fila com anúncio em T-5). Sequência no grupo: T-7 📘 regras → T-5 📣 figurinha+@all → T-0 lote 1. Texto = verbatim da operadora em `announce-sticker.mjs::DEFAULT_RULES_MESSAGE`; **sobreponível** em `bot/data/rules-message.json` {"text"} sem redeploy; corrompido cai no default (nunca quebra o anúncio). Idempotência por announce-state.json (chave `rules_announced`, independente da figurinha); mesma janela de grace (15min) e guards (fila viva, grupo ativo). Roda PRIMEIRO no ciclo (ordem garantida quando ambos disparam juntos).
2. **Reconcile da migration do operador (20260924220000_auction_lot_sequence_no_drift)**: intenção dele (advisory lock + setval nos lotes explícitos) preservada 100%; cópias antigas de create_auction_wizard/queue, control e sync regeneradas das ÚLTIMAS versões (extração programática — extra_images P-08, brinde na fila, trigger das quick_polls restaurados). `grant update on sequence auction_lot_number_seq to service_role` adicionado (setval exigia; grant antigo só usage,select).
3. **delete_auction agora security definer** (padrão purge — o drop/recreate do immutable_audit precisa do dono da tabela; como invoker o CI pegou "must be owner").
4. Teste de frase do delete-auction corrigido (btrim aceita 'sim quero ' com espaço por design — UI normaliza; caso trocado por 'Sim Quero', que o RPC exato rejeita).
5. 4 testes novos das regras. Bot 38, site 170, typecheck — verdes.

## Migrations pendentes do operador (P-13)
20260924180000 (avisos no dashboard) → 20260924200000 (ciclo de 3) → 20260924210000 (edição de lote) → **20260924220000_auction_lot_sequence_no_drift.sql (RECONCILIADA — se já colou a original, cole esta por cima)** → 20260924220000_delete_auction.sql → doctor. 150000/160000 aplicadas ✓.

## Próximo passo EXATO
1. Push + CI verde.
2. OPERADOR: aplicar as migrations pendentes (ordem acima) → doctor → smokes: regras+figurinha+@all na próxima fila; excluir leilão de teste ("sim quero"); 3+3 reduções → 2 DMs de ciclo; editar lote pendente.
3. P-11 (secret na Vercel) segue pendente.

## Arquivos de código prioritários
- `bot/announce-sticker.mjs` (regras: default/override/estado), `bot/index.mjs::sendRulesAnnouncements`
- `supabase/migrations/20260924220000_auction_lot_sequence_no_drift.sql` (reconciliada), `20260924220000_delete_auction.sql` (security definer)

## Comandos úteis
```bash
npm run doctor
npm run start
npm test && npm run typecheck && npm run build
node --test bot/*.test.mjs
```

## Atenções
- Migrations 180000..220000 NÃO aplicadas em produção até o operador colar (painel de avisos/ciclo/edição/exclusão falham com erro claro até aplicar).
- **P-11 é o gargalo da qualidade no painel publicado** (secret na Vercel).
- Migrations que substituem função: verbatim da última versão com adições marcadas (extração programática quando possível); o OPERADOR também escreve migrations — `git fetch` ANTES de push.
- RPC que mexe em TRIGGER (drop/recreate) precisa ser SECURITY DEFINER (dono da tabela).
- Client components NUNCA importam lib/backend (server-only); página client nova com createPublicSupabaseClient precisa de layout force-dynamic.
- Suíte que persiste estado redireciona o diretório ANTES do import (BOT_DATA_DIR).
- Atualizar `11_PENDING_WORK.md` e ESTE arquivo ao concluir qualquer item.

## Histórico das rodadas anteriores (resumo)
R1-9: rascunhos (150000), hotfixes do bot, brinde por carta (160000), legenda com variante/bandeira, drag só no ☰, pipeline VISÍVEL, DM ao participante removida por decisão, figurinha+@all com gatilho pela FILA, avisos no terminal, ciclo de 3 com reset (200000), auto-save de rascunho, backup na nuvem, DM de lote falho, edição de lote pendente (210000), excluir leilão "sim quero" (220000).
