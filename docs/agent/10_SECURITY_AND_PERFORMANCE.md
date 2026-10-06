# 10_SECURITY_AND_PERFORMANCE — Segurança e performance

> Área: Segurança + Performance
> Escopo: Auth, RLS, secrets, riscos de exposição; gargalos, concorrência, memória
$12026-10-05
> Fonte principal: `lib/backend.ts`, `lib/supabase-server.ts`, `lib/rate-limit.ts`, `lib/purge.ts`, `bot/session-guard.mjs`, `.github/workflows/ci.yml` (CI de segurança dos commits), `supabase/migrations/*security*`

## SEGURANÇA

### Autenticação e autorização
- Painel: Supabase Auth (JWT) + `authorize()` (`lib/backend.ts`) valida `admin_profiles` (role `admin`/`operator`, `active`). `getClaims` verifica assinatura local (JWKS) com fallback HS256.
- API nunca expõe service role ao cliente: `lib/supabase-server.ts` é server-only; chaves públicas vão em `lib/supabase.ts` (publishable key).
- RLS: staff_read por policy em todas as tabelas de leitura autenticada; anon sem acesso; escrita só via service_role/RPCs (ver `03_DATABASE.md`).
- Bot: service_role só no `bot/.env` local (gitignored); painel controla o bot APENAS via `whatsapp_bot_commands` (claim único).

### Segredos e tokens
- `.env.local` é gitignored (verificado); migrations nunca contêm segredos. O sistema de reconhecimento (e seu segredo compartilhado) foi REMOVIDO em 2026-10-05 — o único par de chaves que resta é o do Supabase.

### Endurecimentos já implementados (histórico de commits `security:*`)
- Cleanup de sessão do WhatsApp restrito ao diretório do bot (ace0d308/766a57e7).
- Rate limit em `/api/cards/image/authorize`: 50 req/min/usuário (Redis se `REDIS_URL`, senão in-memory) — protege cota de URLs assinadas do Storage.
- Purge "Excluir TUDO": frase em 2 passos validada UI→API→RPC.
- Auditoria append-only (`immutable_audit`) — elimina/recria só dentro de purge/limpeza.

### Riscos de exposição / SSR
- API routes: segredos só em `runtime nodejs` handlers — nenhum componente client importa supabase-server (typecheck garante).
- QR do WhatsApp: só operador ativo vê; workers desconectados não expõem QR stale (testado em `tests/whatsapp-status.test.mjs`).
- `NEXT_PUBLIC_*` limitado às chaves públicas Supabase.
- Risco residual: Baileys é não-oficial (ban do número é risco de negócio, não de dados).

## PERFORMANCE

### Medidas de RAM/CPU (motivo: PC do operador, Windows)
- Bot: filho com `--max-old-space-size=384`; restart noturno (`BOT_NIGHT_RESTART_HOUR=4`); caches já limitados (LRU caps).
- Preview de fotos no wizard reduzido a ~560 px (evita freeze com 20–50 fotos); uploads com concorrência 3 e lote de autorização 12.
- Upload de imagens em lote com dedup + progresso incremental (falha não trava o lote).

### Concorrência e idempotência (o projeto inteiro é construído sobre isso)
- RPC: advisory lock por eventId + cache `processed_commands` (anti-replay/anti-duplicação).
- Claim de dispatch: lock com heartbeat; recovery de stale lock; backoff de retry até ~23 min.
- Votos: `whatsapp_vote_state` + guard `stale_event` (ordem dos votos do participante respeitada mesmo após reconexão).
- Notificações aos admins: `sent_to` por admin (retry parcial não duplica).

### Gargalos / operações caras conhecidas
- `read_auction_snapshot` carrega tabelas inteiras (export) — aceitável no volume atual; pode pesar se o histórico crescer muito (limpeza 12h mitiga).
- Excel export gera arquivo completo em memória (ExcelJS) — ok no volume atual.

### Riscos de duplicação (invariantes a preservar)
- Envio de lote: dispatch claim + event-id estável (`dispatch-id.mjs`) — jamais publicar 2× a mesma fila.
- Lances: eventId do voto determinístico por (poll, participante, ts, valor).
- Avisos/notificações: UNIQUE(external_event_id) nas 3 tabelas + early-return do RPC.

### Pontos sensíveis de performance para o futuro
- Snapshots: se crescerem, paginar/materiaalizar.
