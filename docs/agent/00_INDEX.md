# 00_INDEX — Memória persistente do projeto para agentes de IA

> Área: Mapa geral da documentação de agente
> Escopo: Navegação e recuperação de contexto entre sessões
> Última atualização: 2026-09-25
> Fonte principal: Análise completa do código + sessões de 2026-09-24/25

## Objetivo

Esta pasta é a **memória persistente** do projeto `leilao-Pokemon`. Ela existe para que qualquer agente de IA (ou humano) inicie uma sessão de trabalho **sem reler o repositório inteiro** e **sem depender do histórico da conversa anterior**.

Regras de manutenção (valem para TODOS os arquivos desta pasta):

1. Toda mudança importante concluída → atualizar o `.md` da área afetada;
2. → atualizar `11_PENDING_WORK.md`;
3. → atualizar `12_SESSION_HANDOFF.md` (checkpoint obrigatório);
4. → atualizar este índice quando o estado de uma área mudar;
5. **NUNCA inventar** fato não confirmado no código — usar "Não confirmado no código atual." quando aplicável;
6. Arquivos escritos PARA AGENTES: caminhos reais, funções, contratos, invariantes, riscos, comandos. Sem texto comercial.

## Como recuperar o contexto após uma nova sessão (protocolo de boot)

```
1. Leia: docs/agent/00_INDEX.md        (este arquivo — mapa e estados)
2. Leia: docs/agent/12_SESSION_HANDOFF.md (checkpoint da última sessão)
3. Leia: o arquivo da área indicado pelo handoff (ex.: 07_CARD_RECOGNITION.md)
4. Execute o "Próximo passo EXATO" descrito no handoff.
```

## Mapa das áreas

| Ordem | Arquivo | Área | Estado | Última atualização |
| ----- | ----------------------- | ------------------- | ------ | ------------------ |
| 01 | `01_PROJECT_CONTEXT.md` | Contexto geral | Estável — leitura obrigatória de todo agente novo | 2026-09-23 |
| 02 | `02_ARCHITECTURE.md` | Arquitetura real | Estável | 2026-09-23 |
| 03 | `03_DATABASE.md` | Supabase/PostgreSQL | ⚠️ Migrations 180000–250000 pendentes de aplicação manual (ver 11_PENDING) | 2026-09-25 |
| 04 | `04_API.md` | API Next.js (app/api) | Estável; rotas novas `/api/auctions/drafts`, `/api/quick-polls`, `/api/auctions/delete` | 2026-09-25 |
| 05 | `05_FRONTEND.md` | Frontend (app/) | Estável; wizard com rascunhos + brinde por carta + auto-save; dashboard com painel de avisos + exclusão | 2026-09-25 |
| 06 | `06_WHATSAPP_BOT.md` | Bot Baileys (bot/) | Estável; sequência de abertura ATÔMICA (regras+figurinha+@all); avisos com ciclo de 3; @all real; backup na nuvem | 2026-09-25 |
| 07 | `07_CARD_RECOGNITION.md` | Reconhecimento (recognition/) | Estável; pipeline VISÍVEL no wizard; warming backoff 5s; DiML NaN demotion | 2026-09-25 |
| 08 | `08_AUCTION_DOMAIN.md` | Domínio de leilão | Estável; exclusão real de leilão; ciclo de 3; brinde na fila | 2026-09-25 |
| 09 | `09_TESTS_AND_VALIDATION.md` | Testes e validação | Estável — Node 171, bot 38, Python 252, typecheck, build, 12 SQL test files | 2026-09-25 |
| 10 | `10_SECURITY_AND_PERFORMANCE.md` | Segurança e performance | ⚠️ Supabase Log Ingestion quase no limite (0.96/1 GB); polling reduzido ~56% | 2026-09-25 |
| 11 | `11_PENDING_WORK.md` | Trabalho pendente | 🔴 Migrations para aplicar + P-11 Vercel; P-14 (.exe) CANCELADO e removido | 2026-09-29 |
| 12 | `12_SESSION_HANDOFF.md` | Checkpoint da sessão | Atualizado a cada sessão | 2026-09-25 |

## Estado atual resumido por área

- **Site/API (app/, lib/)** — funcional. Wizard em lote: rascunhos com auto-save, brinde por carta (foto+enquete no lugar do leilão), edição de lote pendente na fila, até 200 cartas. Dashboard: painel de avisos com ciclo de 3, exclusão real de leilão ("sim quero").
- **Banco (supabase/)** — migrations de 2026-09-24/25 escritas e testadas no CI; algumas pendentes de aplicação manual (ver P-13). Snapshot do dashboard com LIMITs (fix de egress/log). Snapshot do export com LIMITs (fix de timeout). Limpeza fixa de 24 horas (era 30 dias). Máximo 200 cartas por fila.
- **Bot (bot/)** — funcional. Sequência de abertura ATÔMICA: regras → 3s → figurinha → @all (menções reais, todos os JIDs). Nunca duplica, nunca inverte ordem. DM de lote falho para os admins. Avisos: redução de lance conta no ciclo; 3 = DM aos admins + reset; o participante NÃO recebe DM.
- **Reconhecimento (recognition/)** — funcional. Pipeline ativo VISÍVEL no wizard (chip). Warming backoff: 5s (era 60s cego). Health timeout: 5s (era 1.2s).
- **Performance/Supabase** — polling global reduzido ~56% (bot 5s, dashboard 30s, Realtime debounce 5s). Log Ingestion era 4.8 GB/dia → estimado ~80-120 MB/dia.
- **CI (.github/workflows/ci.yml)** — verde: Postgres 17 + todas as migrations + 12 SQL test files + bot + python + build + smoke.

## Próxima área recomendada

Ver **`11_PENDING_WORK.md`** e **`12_SESSION_HANDOFF.md`**. Trabalho imediato: **aplicar migrations pendentes** (P-13). Backlog: **P-11** (secret na Vercel). A conversão para desktop .exe foi **CANCELADA e removida** do repositório (2026-09-29) — o projeto é 100% web.

## Comandos oficiais (referência rápida — detalhes em `09_TESTS_AND_VALIDATION.md`)

```bash
npm ci                       # site (raiz)
npm --prefix bot ci          # bot
npm run typecheck            # tsc --noEmit
npm test                     # node --test tests/*.test.mjs (171)
npm --prefix bot run check   # sintaxe bot + patches + subset
node --test bot/*.test.mjs   # suíte bot (38)
npm run build                # next build (RODE ANTES DO npm run start!)
npm run start                # site + bot + serviço de reconhecimento (Windows)
npm run doctor               # check-up pré-leilão: migrations, bot, reconhecimento, backup, figurinha
# python: a partir de recognition/ com o venv
.venv\Scripts\python.exe -m unittest discover -s tests   # 252 testes
```
