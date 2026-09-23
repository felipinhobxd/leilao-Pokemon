# SESSION HANDOFF

## Última atualização
2026-09-24 (fim da sessão: P-06 + P-07 + P-08 + P-09)

## Sessão atual
Implementar os 4 itens aprovados pelo operador: @menção do arrematante, enquete de brindes, múltiplas fotos por lote e lembrete de pagamento pós-leilão.

## O que foi concluído
1. **P-06 — @menção do arrematante**: `bot/participant-contact.mjs` (resolveParticipantJid: `participant_identities` pn > lid > `participants.whatsapp_id`/`phone_e164`; mentionMessage) aplicado nas DUAS mensagens (ARREMATADO e "Leilão encerrado"). Sem JID pn → nome plano (mensagem nunca falha).
2. **P-07 — Brindes**: decisão do operador = SÓ painel, SÓ publicar. Migration `20260924120000` cria `whatsapp_quick_polls` (RLS padrão); `POST /api/quick-polls` valida (título 1-200, 2-12 opções ≤100, grupo ativo, idempotente por `external_event_id`); `sendDueQuickPolls()` no ciclo de 3s do bot (messageId estável, `sent_at` só após envio, grupo inativo → marcado sem envio); formulário "Enquete rápida de brinde" na Central WhatsApp (título + opções por linha + agendamento).
3. **P-08 — Fotos de detalhe (até 4)**: `cards.extra_images jsonb`; validação espelhada nos DOIS RPCs (`invalid_extra_images` para >4 ou não-HTTPS) e nas duas rotas; wizard em lote + único com upload incremental (`${cardId}#e${n}`) e thumbnails removíveis; bot envia em SEQUÊNCIA após a foto principal com messageIds estáveis (`extra-1..4`) ANTES de persistir `announcement_sent_at` (crash → reenvio deduplicado); o delay de 5s da enquete conta após a última.
4. **P-09 — Lembrete de pagamento**: decisão do operador = DM a cada 7 dias, SEM aviso/punição. `payment_reminders` (purchase_id UNIQUE, cascade) + RPC `mark_purchase_paid` (idempotente por estado: payment → paid, delivery → ready, audita 1×; já pago → `already_paid=true` sem reauditar) + `bot/payment-reminder.mjs` (dreno 1x/hora; pula quem tem payment paid; máx `BOT_PAYMENT_REMINDER_MAX`=5, 0=ilimitado; `BOT_PAYMENT_REMINDER_DAYS`=7) + botão "✓ Recebido" na tabela Compras (`POST /api/purchases/paid`) + `read_dashboard_snapshot` agora devolve `payments`/`payment_reminders` REAIS (eram '[]' hardcoded — corpo copiado da versão MAIS RECENTE, a da 20260921130000 com `whatsapp_event_at`).
5. **Purge estendido**: `purge_all_business_data` copiado da 20260921140000 (SECURITY DEFINER) + deletes de `payment_reminders` e `whatsapp_quick_polls` com contagem.
6. **Testes**: `bot/payment-reminder.test.mjs` (6: formatter BRT/menção, pendência gera 1 lembrete, janela de 7 dias não reenvia, pago sai do ciclo, limite máximo, sem socket) + `tests/quick-polls-reminders.sql` (extra_images válidas/inválidas, baixa idempotente com 1 audit, cascade de lembretes, brinde + duplicado de evento, RLS staff-only) + wired no `ci.yml`.

## O que está em andamento
- Aguardando CI do push desta sessão (a suíte SQL nova roda pela 1ª vez).

## Arquivos modificados
- `supabase/migrations/20260924120000_quick_polls_extra_images_reminders.sql` (novo, 8 seções)
- `bot/participant-contact.mjs` (novo), `bot/payment-reminder.mjs` (novo), `bot/payment-reminder.test.mjs` (novo)
- `bot/index.mjs` (imports, drains, menções, extras, sendDueQuickPolls, scheduler)
- `app/api/quick-polls/route.ts` (novo), `app/api/purchases/paid/route.ts` (novo)
- `app/api/auctions/new/route.ts` + `batch/route.ts` (extra_images)
- `app/auctions/new/bulk-wizard.tsx` + `wizard.tsx` (+ batch-wizard.css + wizard.css: UI das extras)
- `app/whatsapp/page.tsx` (+ globals.css: formulário de brinde)
- `app/dashboard.tsx` (função markPurchasePaid + coluna Pagamento)
- `lib/backend.ts` (Table union + payment_reminders)
- `tests/quick-polls-reminders.sql` (novo) + `.github/workflows/ci.yml`
- `docs/agent/03,06,08,11` + este handoff

## Arquivos analisados
- Últimas versões das funções substituídas: `create_auction_publish_queue` (20260913202000, nunca substituída), `create_auction_wizard` (20260921120000), `purge_all_business_data` (20260921140000), `read_dashboard_snapshot` (20260921130000 — ATENÇÃO: a 20260921120000 também a define; a da 130000 com `whatsapp_event_at` é a vigente).
- `bot/index.mjs::sendDispatchInternal` (ordem anúncio→poll e onde as extras entram), `lib/card-image.ts::uploadCardImageBatch`, `bot/dispatch-id.mjs` (ids estáveis), `tests/auction-wizard.sql` (padrão de grupo nos testes SQL).

## Decisões tomadas
- Brindes em tabela PRÓPRIA (dispatches exige auction_id NOT NULL UNIQUE) — sem FK surgery na tabela mais quente.
- Extras em SEQUÊNCIA, não álbum (álbum nativo é instável no Baileys 7.0.0-rc14).
- Lembrete: parada = baixa manual no painel; máximo 5 por segurança (configurável 0 = ilimitado).
- read_dashboard_snapshot: preciso copiar da 130000 (não da 120000) — a 130000 adicionou whatsapp_event_at para o tie-break.

## Problemas encontrados
- Meu primeiro rascunho da seção 8 da migration copiou read_dashboard_snapshot da 20260921120000 — regrediria o tie-break do dashboard. CORRIGIDO antes do commit (cópia agora da 20260921130000 + ADDITION C).

## Testes executados
- `node --test bot/payment-reminder.test.mjs`: 6/6.
- Pendentes no momento deste handoff: suíte raiz, suíte bot completa, typecheck, build → ver Próximo passo.

## Resultado dos testes
- payment-reminder 6/6 ✓; demais a validar no CI/antes do commit.

## Ponto EXATO onde paramos
Código + testes + docs completos. Falta: rodar a validação local completa (npm test, bot tests, typecheck, build), commit, push e conferir o CI (a suíte `tests/quick-polls-reminders.sql` roda pela primeira vez — se falhar, ler o erro do psql; suspeitos prováveis: ordem de colunas/CTEs e o `begin...exception` do duplicado).

## Próximo passo EXATO
1. Rodar local: `npm test`, `node --test bot/*.test.mjs`, `npm run typecheck`, `npm run build`.
2. Commit + push; acompanhar CI (API: `actions/runs`).
3. Se verde: lembrar o operador que as migrations `20260923093000` (avisos), `20260923120000` (backup) E `20260924120000` (esta) precisam ser aplicadas no SQL Editor, nesta ordem.
4. Smoke ao vivo sugerido: (a) arrematar um lote → conferir @menção; (b) criar brinde no painel → enquete no grupo; (c) lote com 2+ fotos de detalhe; (d) arrematar, NÃO marcar pagamento, setar `BOT_PAYMENT_REMINDER_DAYS` baixo (ex.: 0.001) temporariamente no `bot/.env` para ver a DM chegar, depois marcar "✓ Recebido" e confirmar que para.

## Arquivo recomendado para continuar
`docs/agent/11_PENDING_WORK.md` — restam apenas: P-02 (aplicar migrations), P-03 (índice es), P-04 (modelo quantizado), P-05 (figurinha do início — bloqueado no operador), P-10 (suíte SQL de avisos — já escrita em 2026-09-23, CONFIRMAR status), P-11 (env Vercel), P-12 (truth-key ptcg).

## Arquivos de código prioritários
- `supabase/migrations/20260924120000_quick_polls_extra_images_reminders.sql`
- `bot/index.mjs` (sendDispatchInternal, sendDueQuickPolls, finalizeDueAuctions)
- `tests/quick-polls-reminders.sql`

## Comandos úteis
```bash
npm test && npm run typecheck && npm run build
node --test bot/*.test.mjs
npm --prefix bot run check
git add -A && git commit -m "feat: winner mentions, giveaway polls, extra photos, payment reminders (P-06..P-09)" && git push
```

## Atenções
- NÃO editar `create_auction_publish_queue`/`create_auction_wizard`/`purge_all_business_data`/`read_dashboard_snapshot`/`process_auction_command` sem copiar a versão MAIS RECENTE (ver `03_DATABASE.md` → PERIGOS; a trapalhada da read_dashboard_snapshot desta sessão é o exemplo).
- O bot só publica brindes/lembretes com o WhatsApp conectado (socket pronto) — drenos silenciosamente não fazem nada offline.
- Atualizar `11_PENDING_WORK.md` e ESTE arquivo ao concluir qualquer item.
