# 10_SECURITY_AND_PERFORMANCE — Segurança e performance

> Área: Segurança + Performance
> Escopo: Auth, RLS, secrets, riscos de exposição; gargalos, concorrência, memória
> Última atualização: 2026-09-23
> Fonte principal: `lib/backend.ts`, `lib/supabase-server.ts`, `lib/rate-limit.ts`, `lib/purge.ts`, `recognizer/service_auth.py`, `bot/session-guard.mjs`, `.github/workflows/ci.yml` (CI de segurança dos commits), `supabase/migrations/*security*`

## SEGURANÇA

### Autenticação e autorização
- Painel: Supabase Auth (JWT) + `authorize()` (`lib/backend.ts`) valida `admin_profiles` (role `admin`/`operator`, `active`). `getClaims` verifica assinatura local (JWKS) com fallback HS256.
- API nunca expõe service role ao cliente: `lib/supabase-server.ts` é server-only; chaves públicas vão em `lib/supabase.ts` (publishable key).
- RLS: staff_read por policy em todas as tabelas de leitura autenticada; anon sem acesso; escrita só via service_role/RPCs (ver `03_DATABASE.md`).
- Bot: service_role só no `bot/.env` local (gitignored); painel controla o bot APENAS via `whatsapp_bot_commands` (claim único).

### Segredos e tokens
- `RECOGNITION_SERVICE_SHARED_SECRET` (≥32 chars): vive em `.env.local` (Next) e `recognition/.env` (Python, carregado por `load_local_env`). Token HMAC de curta duração (≤15 min, aud fixa, jti) mintado por `/api/card-recognition/token` e verificado em `recognizer/service_auth.py` — segredo nunca chega ao navegador. Erros distinguem 401 (token inválido/expirado) de 503 (não configurado).
- `recognizer/.env` e `.env.local` são gitignored (verificado); migrations nunca contêm segredos.
- ⚠️ Pendências conhecidas: configurar o MESMO segredo como env **server-only na Vercel** (senão o painel publicado não usa o serviço local); o segredo circula no setup local do operador (aceitável — máquina dele).

### Endurecimentos já implementados (histórico de commits `security:*`)
- Auth HMAC no serviço de reconhecimento (eea1fdc8/06707fbd/04265cbc).
- Cleanup de sessão do WhatsApp restrito ao diretório do bot (ace0d308/766a57e7).
- Rate limit em `/api/cards/image/authorize`: 50 req/min/usuário (Redis se `REDIS_URL`, senão in-memory) — protege cota de URLs assinadas do Storage.
- Purge "Excluir TUDO": frase em 2 passos validada UI→API→RPC.
- Reconhecimento: bind 127.0.0.1 apenas; CORS allow-list explícita (nunca `*`) + resposta ao preflight Private Network Access; limites de upload (25 MB / 12.000 px); magic-bytes no cache de scans; `stubs/onnxruntime-node` evita 210 MB de binários nativos nunca usados.
- Auditoria append-only (`immutable_audit`) — elimina/recria só dentro de purge/limpeza.

### Riscos de exposição / SSR
- API routes: segredos só em `runtime nodejs` handlers — nenhum componente client importa supabase-server (typecheck garante).
- QR do WhatsApp: só operador ativo vê; workers desconectados não expõem QR stale (testado em `tests/whatsapp-status.test.mjs`).
- `NEXT_PUBLIC_*` limitado às chaves públicas Supabase.
- Risco residual: Baileys é não-oficial (ban do número é risco de negócio, não de dados); página pública https chamando loopback é permitida por PNA (mixed-content exempt) — o serviço responde preflight mas mantém allow-list.

## PERFORMANCE

### Medidas de RAM/CPU (motivo: PC do operador, Windows + RX 570 4 GB)
- Bot: filho com `--max-old-space-size=384`; restart noturno (`BOT_NIGHT_RESTART_HOUR=4`); caches já limitados (LRU caps).
- Reconhecimento: sem `--preload`; **descarga de modelos após 10 min idle** + rewarm em background no `/health` frio; orçamentos de cache: scans 150 MB (era 400) e SIFT 48 MB (era 128).
- Preview de fotos no wizard reduzido a ~560 px (evitava freeze com 20–50 fotos); OCR do navegador em Web Worker (não na main thread).
- Upload de imagens em lote com dedup + progresso incremental (falha não trava o lote).

### Concorrência e idempotência (o projeto inteiro é construído sobre isso)
- RPC: advisory lock por eventId + cache `processed_commands` (anti-replay/anti-duplicação).
- Claim de dispatch: lock com heartbeat; recovery de stale lock; backoff de retry até ~23 min.
- Votos: `whatsapp_vote_state` + guard `stale_event` (ordem dos votos do participante respeitada mesmo após reconexão).
- Notificações aos admins: `sent_to` por admin (retry parcial não duplica).
- Reconhecimento: executor 1-worker (fila justa; health sempre responsivo).

### Gargalos / operações caras conhecidas
- `read_auction_snapshot` carrega tabelas inteiras (export) — aceitável no volume atual; pode pesar se o histórico crescer muito (limpeza 30d mitiga).
- Embedding SigLIP na CPU: ~10–20 s/cartas em lotes; com DML ~2–4 s (quando estável). Build de índice é CPU-forçado (DML dá NaN em builds longos).
- Excel export gera arquivo completo em memória (ExcelJS) — ok no volume atual.

### Riscos de duplicação (invariantes a preservar)
- Envio de lote: dispatch claim + event-id estável (`dispatch-id.mjs`) — jamais publicar 2× a mesma fila.
- Lances: eventId do voto determinístico por (poll, participante, ts, valor).
- Avisos/notificações: UNIQUE(external_event_id) nas 3 tabelas + early-return do RPC.

### Pontos sensíveis de performance para o futuro
- fp16/int8 quantizado do SigLIP2 (meta: rodar em PC fraco; exige recalibração de thresholds via `scripts/calibrate_thresholds.py`).
- Índice `es` (13.271 cartas) fora do índice visual — build CPU ~2–3 h quando decidir.
- Snapshots: se crescerem, paginar/materiaalizar.
