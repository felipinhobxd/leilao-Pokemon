# 05_FRONTEND — Interface (app/)

> Área: Frontend Next.js
> Escopo: Páginas, fluxos, estados, integrações
> Última atualização: 2026-09-24
> Fonte principal: `app/layout.tsx`, `app/page.tsx`, `app/dashboard.tsx`, `app/auctions/new/**`, `app/whatsapp/**`, `lib/card-recognition-local.ts`, `lib/auction-draft.ts`

## Mapa real (arquivo → funcionalidade)

| Funcionalidade | Arquivo |
|---|---|
| Login (Supabase Auth) | `app/page.tsx` |
| Painel ao vivo (bot, grupo, leilão atual, maior lance, janela 30d, ações) | `app/dashboard.tsx` |
| Cadastro em **lote** (drag & drop de fotos, IA, valores, fila, rascunhos, botão Brinde) | `app/auctions/new/page.tsx` → `app/auctions/new/bulk-wizard.tsx` |
| Wizard de **carta única** | `app/auctions/new/single/page.tsx` → `app/auctions/new/wizard.tsx` |
| **Brinde** (enquete rápida, movida da Central WhatsApp 2026-09-24) | `app/auctions/brinde/page.tsx` |
| Componente de debug do reconhecimento (JSON do pipeline local) | `app/auctions/new/recognition-debug.tsx` |
| Toggle liga/desliga reconhecimento (localStorage `leilao-pokemon:image-recognition-enabled`) | `app/auctions/new/recognition-toggle.tsx` |
| Central WhatsApp (QR, status, grupos, reconexão — SEM formulário de brinde, movido 2026-09-24) | `app/whatsapp/page.tsx` + `whatsapp/group-selector.tsx` |
| Layout compartilhado do fluxo de novos leilões | `app/auctions/new/layout.tsx` |

## Fluxo: wizard em lote (`bulk-wizard.tsx`) — 4 etapas

1. **Cartas**: upload múltiplo (drag & drop ou seletor), preview reduzido a 560px (`PREVIEW_MAX_SIDE`; upload usa o original), reconhecimento local por carta com fila de concorrência limitada (`createRecognitionScheduler`), edição manual que NUNCA é sobrescrita pela IA (`manualFields`), reorder por drag, "Coleção/Edição" REMOVIDA da UI (campo `collection` permanece no payload por compatibilidade), aplicar-para-todas de idioma/condição.
2. **Valores**: por carta `Automático` (inicial/incremento/ARREMATE/opções) **ou** `Personalizado` (valores vírgula, decimal pt-BR ok, primeiro = lance inicial, checkbox "Maior valor = ARREMATE"); barra "Valores personalizados p/ todas"; duração individual por carta; preview mini da enquete (`poll-mini`).
3. **Publicação**: grupo, intervalo entre publicações (1s–24h), agora vs agendar (horário de Brasília).
4. **Revisar**: resumo + lista com imagem/valores/horários → `POST /api/auctions/batch` → tela da **fila** com Pausar/Continuar/Cancelar e progresso (`queueId`, `QueueView`).

### Rascunhos (2026-09-24, migration `20260924150000`)

- **Salvar**: botão "💾 Salvar rascunho" no topbar (todas as etapas). As FOTOS sobem ao Storage no salvar (`uploadImages(true)` mantém os `File`s em memória — reconhecimento/re-upload continuam na sessão); o payload guarda só URLs HTTPS + campos do wizard (`lib/auction-draft.ts` — whitelist, `buildDraftState`/`restoreDraftState`, guards 1..200 cartas / ≤512KB). Título automático: "Rascunho de dd/mm/aaaa hh:mm · N cartas".
- **Abrir**: painel "Rascunhos salvos" na etapa 1 (sem cartas na tela) → `GET ?draftId=` → restaura cartas com `file:null` (thumbnail usa a URL), valores/lotes/idiomas/agendamento/etapa; reconhecimento só em estágios TERMINAIS (identified/review/not-found) e os CANDIDATOS vêm preservados (a caixa "Possíveis resultados" aparece mesmo sem File — dá para escolher à mão; o botão "Reconhecer novamente" exige File e fica oculto).
- **Ciclo**: publicar a fila apaga o rascunho sozinho (fire-and-forget); "Excluir" na lista descarta; salvar de novo no mesmo rascunho = update do mesmo id (`activeDraftId`).
- **Tela da fila** ganhou "＋ Novo leilão" (volta ao wizard com fila ativa — antes não havia caminho de retorno).
- **Correções colaterais**: teto de 4 fotos de detalhe agora conta `extraFiles + extraImages` (evitava 400 na publicação quando extras já tinham subido ao salvar rascunho); payload de publicação faz merge+dedup de `extraImages` (antes: extras adicionadas após um upload parcial eram silenciosamente descartadas).

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
