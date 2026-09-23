# 08_AUCTION_DOMAIN — Domínio de leilões

> Área: Regras de negócio do leilão
> Escopo: Lote, carta, valores, lances, enquete, ARREMATE, vencedor, fila, avisos
> Última atualização: 2026-09-23
> Fonte principal: `lib/auction-wizard.ts`, `app/api/auctions/**`, `supabase/migrations/**` (RPCs), `bot/index.mjs`, `bot/format.mjs`, `app/api/export/route.ts`

## Conceitos e onde vivem

- **Carta (`cards`)**: cadastrada no momento da criação do leilão (wizard); campos usados: nome, número, variante (Normal/Holo/Reverse Holo/...), condição (NM/LP-SP/MP/HP/DMG), idioma (pt-BR/en/ja/es/other), imagem (Supabase Storage), preço inicial e ARREMATE de referência. `collection` existe no schema mas foi REMOVIDO da UI (payload mantém por compatibilidade).
- **Lote/Leilão (`auctions`)**: `lot_number` (sequência única do operador), duração (`scheduled_end_at` / `duration_seconds`), `bid_increment` (guarda do banco p/ novos lances manuais), `poll_options` (jsonb — o que a enquete publica).
- **Valores da enquete**: modo `increment` (inicial + incremento + ARREMATE opcional + nº de opções 2..12) ou `custom` (`lib/auction-wizard.ts::parseCustomValues/buildCustomValuesPlan`: valores exatos digitados, vírgula decimal pt-BR, 2..12 estritamente crescentes; primeiro = lance inicial; "maior valor = ARREMATE" opcional; `bid_increment` = menor intervalo entre valores — o guarda do banco nunca rejeita opção listada). Rótulos: `R$ X,XX` e `R$ X,XX 🦭` para ARREMATE.
- **Enquete**: enviada pelo bot com `buildPollTitle` ("N. Lances") + opções do banco. **Foto antes, enquete 5s depois**.
- **Lance (`bids`)**: participante clica numa opção → evento de voto decriptografado → `BID_PLACED` (novo) / `BID_CHANGED` (troca) / `BID_WITHDRAWN` (remoção). Um lance `active` por participante por leilão; trocas encadeiam `replaced_by`.
- **ARREMATE (`BUYOUT_CONFIRMED`)**: fecha o leilão imediatamente como `sold` com `win_type='buyout'`, cria `purchases`+`deliveries` e anuncia no grupo ("ARREMATADO!" com carta/vencedor/valor).
- **Vencedor**: `AUCTION_FINALIZE` no vencimento — maior lance ativo de participante elegível; **tie-break pelo horário REAL do voto** (`whatsapp_event_at`), depois `processed_at`, depois `confirmation_order`. Sem lances → `closed` e carta volta a `available`. O anúncio no grupo **@menciona** o vencedor (P-06, 2026-09-24).
- **Pagamento pós-venda (P-09, 2026-09-24)**: delivery nasce `waiting_payment`; painel marca "Pagamento recebido" (`mark_purchase_paid` → payment `paid` + delivery `ready`, audita 1×); enquanto não marcado, o bot manda DM de lembrete a cada 7 dias ao arrematante (sem aviso/punição; máx. 5 por padrão).
- **Brinde (P-07, 2026-09-24)**: enquete livre (texto/emoji) criada no painel (`whatsapp_quick_polls`), publicada pelo bot no horário agendado; "quem clicar primeiro leva" — votos visíveis na própria enquete do WhatsApp.
- **Fotos de detalhe (P-08, 2026-09-24)**: até 4 por carta (`cards.extra_images`); o bot publica em sequência após a foto principal; o delay de 5s da enquete conta após a última.
- **Aviso global (`participant_warnings`)**: cada `BID_CHANGED` com redução = 1 aviso no contador do USUÁRIO (vale no sistema inteiro, nunca reseta, um por evento por idempotência). Exatamente 3 → `admin_notifications` → DM aos admins (formato em `bot/warning-notify.mjs`). Subir/manter valor não gera aviso.
- **Fila (`auction_publish_queues`)**: criação em lote gera fila + dispatches ordenados (`queue_position`); intervalo entre publicações 1s–24h; pausa/retomada persistente (`paused`), cancelamento, progresso (`summary`) na tela do wizard.

## Estados

`auctions: draft→open→sold|closed|cancelled` · `queues: scheduled→running⇄paused→completed|cancelled` · `dispatches: scheduled→sending→sent|failed|cancelled` · `bids: active→replaced|withdrawn` · `purchases: confirmed` (export) · participantes: `active/banned` + suspensão temporizada.

## FLUXOS CRÍTICOS (ponta a ponta reais)

1. **Criar lote em massa**: `bulk-wizard.tsx` valida → upload de imagens (authorize + batch incremental) → `POST /api/auctions/batch` (cada item: pricing increment|custom; server gera `poll_options`) → `create_auction_publish_queue` → cards+auctions+dispatches numa transação → tela da fila.
2. **Publicar**: bot clama dispatch vencido (`claim_whatsapp_dispatch`, fila `running`) → envia imagem com legenda (`buildAuctionCaption`: "♡ N. Nome (nº) CONDIÇÃO 🇧🇷 · ☆") → espera 5s → envia enquete → grava `poll_message_id/json` no dispatch → `sent`.
3. **Votar**: WhatsApp → evento criptografado → `decryptIncomingPollVote` → `resolve_whatsapp_participant` → `BID_PLACED/BID_CHANGED` (ou `BUYOUT_CONFIRMED`) com eventId estável → RPC valida (prazo, elegibilidade, valor, stale) → bids + vote_state + events idempotentes.
4. **Fechar**: prazo vence → bot `AUCTION_FINALIZE` → vencedor por tie-break → `sold` + `purchases`/`deliveries` (ou `closed` sem lances).
5. **Redução de valor → aviso → 3 avisos → DM**: dentro da mesma transação do `BID_CHANGED`; bot drena `admin_notifications` (≤15s) e DM os admins com histórico.
6. **Pausar/Retomar**: wizard → controle da fila (`paused`) → claim respeita → retomar continua do próximo `scheduled` sem duplicar (event-id por dispatch).
7. **Exportar**: `GET /api/export` → snapshot → Excel (Vendas + TOTAL, Alterações de valores, Resumo, brutas).
8. **Limpeza 30d**: supervisor hourly → `cleanup_old_auctions` (só lotes terminais > 30d; avisos globais sobrevivem).

## Invariantes (nunca violar)

- 1 participante = no máx. 1 lance `active` por leilão (RPC garante).
- EventId idêntico ⇒ resultado idêntico em cache; divergente ⇒ erro (anti-replay).
- Nenhuma publicação sem `poll_message_id` gravado (re-envio seria detectado como jobId duplicado).
- `poll_options` do banco são a verdade do que foi publicado — wizard/bot nunca recalculam sozinhos na publicação.
- Contador de avisos é por PARTICIPANTE (global), não por leilão; nunca zera com troca de leilão/limpeza.
- TOTAL da planilha soma apenas a coluna de valores das vendas (fórmula `=SUM` na faixa exata das linhas de compra).
