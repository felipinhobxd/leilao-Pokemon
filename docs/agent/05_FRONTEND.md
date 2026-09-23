# 05_FRONTEND — Interface (app/)

> Área: Frontend Next.js
> Escopo: Páginas, fluxos, estados, integrações
> Última atualização: 2026-09-23
> Fonte principal: `app/layout.tsx`, `app/page.tsx`, `app/dashboard.tsx`, `app/auctions/new/**`, `app/whatsapp/**`, `lib/card-recognition-local.ts`

## Mapa real (arquivo → funcionalidade)

| Funcionalidade | Arquivo |
|---|---|
| Login (Supabase Auth) | `app/page.tsx` |
| Painel ao vivo (bot, grupo, leilão atual, maior lance, janela 30d, ações) | `app/dashboard.tsx` |
| Cadastro em **lote** (drag & drop de fotos, IA, valores, fila) | `app/auctions/new/page.tsx` → `app/auctions/new/bulk-wizard.tsx` |
| Wizard de **carta única** | `app/auctions/new/single/page.tsx` → `app/auctions/new/wizard.tsx` |
| Componente de debug do reconhecimento (JSON do pipeline local) | `app/auctions/new/recognition-debug.tsx` |
| Toggle liga/desliga reconhecimento (localStorage `leilao-pokemon:image-recognition-enabled`) | `app/auctions/new/recognition-toggle.tsx` |
| Central WhatsApp (QR, status, grupos, reconexão) | `app/whatsapp/page.tsx` + `whatsapp/group-selector.tsx` |
| Layout compartilhado do fluxo de novos leilões | `app/auctions/new/layout.tsx` |

## Fluxo: wizard em lote (`bulk-wizard.tsx`) — 4 etapas

1. **Cartas**: upload múltiplo (drag & drop ou seletor), preview reduzido a 560px (`PREVIEW_MAX_SIDE`; upload usa o original), reconhecimento local por carta com fila de concorrência limitada (`createRecognitionScheduler`), edição manual que NUNCA é sobrescrita pela IA (`manualFields`), reorder por drag, "Coleção/Edição" REMOVIDA da UI (campo `collection` permanece no payload por compatibilidade), aplicar-para-todas de idioma/condição.
2. **Valores**: por carta `Automático` (inicial/incremento/ARREMATE/opções) **ou** `Personalizado` (valores vírgula, decimal pt-BR ok, primeiro = lance inicial, checkbox "Maior valor = ARREMATE"); barra "Valores personalizados p/ todas"; duração individual por carta; preview mini da enquete (`poll-mini`).
3. **Publicação**: grupo, intervalo entre publicações (1s–24h), agora vs agendar (horário de Brasília).
4. **Revisar**: resumo + lista com imagem/valores/horários → `POST /api/auctions/batch` → tela da **fila** com Pausar/Continuar/Cancelar e progresso (`queueId`, `QueueView`).

Estados por carta: `recognitionStage: idle|queued|analyzing|identified|review|not-found|error|unavailable` com rótulos humanizados em `recognitionLabel()` (inclui caso Devir: `languageStatus === "pt-br-pre-2011"` → "impressão pt-BR pré-2011 (catálogo tem a versão EN)").

## Fluxo: wizard único (`wizard.tsx`)

Mesmo contrato de valores (`pricingMode` custom/increment) para 1 carta; cria leilão único com agendamento e acompanha a publicação via `/api/auctions/new/status`.

## Reconhecimento no navegador (fallback)

`lib/card-recognition-local.ts`: probe `/health` (TTL 60s, strict `ready===true` + `authConfigured===true`); token via `/api/card-recognition/token` com retry 401; fallback `card-recognition-browser-v10` (Cornelius + PP-OCRv6 em Web Worker — `card-recognition-ppocr.worker.ts`, `card-recognition-cornelius.worker.ts`, `card-recognition-visual.worker.ts` com `@huggingface/transformers`).

## Estilos e utilidades

- CSS global próprio (sem Tailwind); classes `.panel`, `.bulk-bar`, `.draft-card`, `.value-row`, `.queue-row`, `.whatsapp-preview`, `.wa-chat` etc.
- Tempo de Brasília centralizado: `lib/brasilia-time.ts` (inputs `datetime-local`, formatação, conversão).
- Moeda: `Intl.NumberFormat("pt-BR", BRL)`; planilha e wizard usam o mesmo formato.
- Realtime: dashboard refaz poll (intervalo de relógio); uso direto de Supabase Realtime **não confirmado no código atual** (o README menciona; precisa de investigação antes de assumir).

## Erros/loading

- `error` único por tela com `role="alert"`; mensagens PT-BR vindas das API (já traduzidas).
- Uploads de imagem: progresso incremental ("N de M concluídas"), falha não trava o lote (opção de publicar sem as imagens falhadas).
- Fila de reconhecimento: `queueStatusMessage` ("Na fila de reconhecimento… (N cartas na frente)").

## Riscos

- `bulk-wizard.tsx` é um componente enorme com várias responsabilidades — mexer em estado de `Draft` exige cuidado (mutações via `mutateCard` + `submission.current` fingerprint anti-duplo-envio).
- Contrato de valores (`lib/auction-wizard.ts::buildCustomValuesPlan/parseCustomValues`) é compartilhado por wizard+API: mudança exige testes (`tests/auction-format.test.mjs`).
- `recognitionLabel` e o tipo `languageStatus` (`lib/card-recognition-service-contract.ts`) andam juntos com o pipeline Python — adicionar status novo exige atualizar os dois lados.
