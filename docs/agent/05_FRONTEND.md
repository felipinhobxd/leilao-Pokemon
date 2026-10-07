# 05_FRONTEND — Interface (app/)

> Área: Frontend Next.js
> Escopo: Páginas, fluxos, estados, integrações
$12026-10-07
> Fonte principal: `app/layout.tsx`, `app/page.tsx`, `app/dashboard.tsx`, `app/auctions/new/**`, `app/whatsapp/**`, `lib/auction-draft.ts`

## Mapa real (arquivo → funcionalidade)

| Funcionalidade | Arquivo |
|---|---|
| Login (Supabase Auth) | `app/page.tsx` |
| Painel ao vivo (bot, grupo, leilão atual, maior lance, janela 30d, ações, **avisos de alteração de valores** com marca "após retirar o lance", **gestão de participantes**: suspender/reativar/banir, avisos total + K de 3, suspensão e notas) | `app/dashboard.tsx` |
| Cadastro em **lote** (drag & drop de fotos, valores, fila, rascunhos, botão Brinde) | `app/auctions/new/page.tsx` → `app/auctions/new/bulk-wizard.tsx` |
| Wizard de **carta única** | `app/auctions/new/single/page.tsx` → `app/auctions/new/wizard.tsx` |
| **Brinde** (enquete rápida, movida da Central WhatsApp 2026-09-24) | `app/auctions/brinde/page.tsx` |
| Central WhatsApp (QR, status, grupos, reconexão — SEM formulário de brinde, movido 2026-09-24) | `app/whatsapp/page.tsx` + `whatsapp/group-selector.tsx` |
| Layout compartilhado do fluxo de novos leilões | `app/auctions/new/layout.tsx` |

## Fluxo: wizard em lote (`bulk-wizard.tsx`) — 4 etapas

1. **Cartas**: upload múltiplo (drag & drop ou seletor), preview reduzido a 560px (`PREVIEW_MAX_SIDE`; upload usa o original), preenchimento 100% MANUAL dos dados por carta (o reconhecimento automático foi REMOVIDO em 2026-10-05), reorder por drag, "Coleção/Edição" REMOVIDA da UI (campo `collection` permanece no payload por compatibilidade), aplicar-para-todas de idioma/condição.
2. **Valores**: por carta `Automático` (inicial/incremento/ARREMATE/opções) **ou** `Personalizado` (valores vírgula, decimal pt-BR ok, primeiro = lance inicial, checkbox "Maior valor = ARREMATE"); barra "Valores personalizados p/ todas"; duração individual por carta; preview mini da enquete (`poll-mini`).
3. **Publicação**: grupo, intervalo entre publicações (1s–24h), agora vs agendar (horário de Brasília).
4. **Revisar**: resumo + lista com imagem/valores/horários → `POST /api/auctions/batch` → tela da **fila** com Pausar/Continuar/Cancelar e progresso (`queueId`, `QueueView`).

### Brinde por carta (2026-09-24, migration `20260924160000`)

- **Botão "🎁 Brinde" na edição da carta** (draft-actions, entre ↓ e Editar): marca a carta como BRINDE — ela NÃO vira leilão. Título/badge "🎁 Brinde — vira enquete, não leilão" na linha da carta.
- O que a publicação faz no lugar do lote: **foto da carta + enquete de brinde** ("quem clicar primeiro leva") com opções LIVRES pré-preenchidas (`GIVEAWAY_DEFAULT_OPTIONS`: "Quero! 🙋 / Tô dentro 🔥 / Bora! 🎉") e editáveis na própria carta (editor aparece na edição e no passo 2). Sem cards/auctions/dispatches — a posição SEGUE contando (o próximo leilão é agendado DEPOIS do brinde).
- "Numerar lotes" pula brindes (brinde não consome número); extras ficam ocultos em brindes (a publicação usa só a foto principal); validação própria (2–12 opções, ≤100 chars).
- A fila (pós-publicação) mostra os brindes entre os leilões (`poll` por posição, "🎁" com enviado/agendado); cancelar a fila apaga brindes pendentes.
- O formulário avulso de brinde (enquete sem carta) continua em `/auctions/brinde` (botão "🎁 Brinde" no topbar).

### Avisos de alteração de valores no dashboard (2026-09-24, migration `20260924180000`)

- Painel "Avisos de alteração de valores" (entre Disputa e Cartas): cada redução de lance com participante, **lote/enquete**, carta, anterior → novo, **horário** e nº do aviso (K de 3, com "admins notificados" do 3º em diante). O participante NÃO recebe DM (decisão do operador — só conta); o terminal do bot loga cada troca em tempo real. Dados via `read_dashboard_snapshot` (agora inclui `participant_warnings` + `value_change_log`, limit 100 — antes só o Excel tinha).
- **2026-10-07**: a célula "Alteração" marca `change_kind='withdraw_rebid'` como "· após retirar o lance" (redução via retirada + re-oferta, migration 20261007110000).

### Gestão de participantes no dashboard (2026-10-07, migration `20261007100000`)

- Seção Participantes ganhou colunas **Avisos** (total global · K de 3, via chave nova `participant_warning_stats` do snapshot — `warningStats()` em dashboard.tsx), **Suspensão** ("Até dd/mm hh:mm" / "Indefinida" / "—") e **Notas** (40 chars + tooltip).
- Ações: **Suspender…** (dialog no padrão dos existentes: 24h/48h/7d/`datetime-local` em horário de Brasília via `brasiliaInputToIso`/indefinida → `PARTICIPANT_SUSPEND` com `data.suspension_until` ISO ou null), **Reativar** (`PARTICIPANT_REACTIVATE`, com confirm — aparece para suspenso/banido), **Editar** (dialog existente) e **Banir** (relabel do antigo "Remover" — mesmo `PARTICIPANT_DELETE`).
- O select de participantes do form manual de lances agora filtra também `suspension_until` vigente (só status 'active' não bastava — o guard do banco rejeitaria o comando).

### Rascunhos (2026-09-24, migration `20260924150000`)

- **Salvar**: botão "💾 Salvar rascunho" no topbar (todas as etapas). As FOTOS sobem ao Storage no salvar (`uploadImages(true)` mantém os `File`s em memória — re-upload continua possível na sessão); o payload guarda só URLs HTTPS + campos do wizard (`lib/auction-draft.ts` — whitelist, `buildDraftState`/`restoreDraftState`, guards 1..200 cartas / ≤512KB). Título automático: "Rascunho de dd/mm/aaaa hh:mm · N cartas".
- **Abrir**: painel "Rascunhos salvos" na etapa 1 (sem cartas na tela) → `GET ?draftId=` → restaura cartas com `file:null` (thumbnail usa a URL), valores/lotes/idiomas/agendamento/etapa. Rascunhos salvos pela era do reconhecimento continuam abrindo (os campos de IA são ignorados pela whitelist).
- **Ciclo**: publicar a fila apaga o rascunho sozinho (fire-and-forget); "Excluir" na lista descarta; salvar de novo no mesmo rascunho = update do mesmo id (`activeDraftId`).
- **Tela da fila** ganhou "＋ Novo leilão" (volta ao wizard com fila ativa — antes não havia caminho de retorno).
- **Correções colaterais**: teto de 4 fotos de detalhe agora conta `extraFiles + extraImages` (evitava 400 na publicação quando extras já tinham subido ao salvar rascunho); payload de publicação faz merge+dedup de `extraImages` (antes: extras adicionadas após um upload parcial eram silenciosamente descartadas).

## Fluxo: wizard único (`wizard.tsx`)

Mesmo contrato de valores (`pricingMode` custom/increment) para 1 carta; cria leilão único com agendamento e acompanha a publicação via `/api/auctions/new/status`.

## Estilos e utilidades

- CSS global próprio (sem Tailwind); classes `.panel`, `.bulk-bar`, `.draft-card`, `.value-row`, `.queue-row`, `.whatsapp-preview`, `.wa-chat` etc.
- Tempo de Brasília centralizado: `lib/brasilia-time.ts` (inputs `datetime-local`, formatação, conversão).
- Moeda: `Intl.NumberFormat("pt-BR", BRL)`; planilha e wizard usam o mesmo formato.
- Realtime: dashboard refaz poll (intervalo de relógio); uso direto de Supabase Realtime **não confirmado no código atual** (o README menciona; precisa de investigação antes de assumir).

## Erros/loading

- `error` único por tela com `role="alert"`; mensagens PT-BR vindas das API (já traduzidas).
- Uploads de imagem: progresso incremental ("N de M concluídas"), falha não trava o lote (opção de publicar sem as imagens falhadas).

## Riscos

- `bulk-wizard.tsx` é um componente grande com várias responsabilidades — mexer em estado de `Draft` exige cuidado (mutações via `mutateCard` + `submission.current` fingerprint anti-duplo-envio).
- Contrato de valores (`lib/auction-wizard.ts::buildCustomValuesPlan/parseCustomValues`) é compartilhado por wizard+API: mudança exige testes (`tests/auction-format.test.mjs`).
