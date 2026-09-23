# 00_INDEX — Memória persistente do projeto para agentes de IA

> Área: Mapa geral da documentação de agente
> Escopo: Navegação e recuperação de contexto entre sessões
> Última atualização: 2026-09-23
> Fonte principal: Análise completa do código (commits até `6b9e8a6e`)

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

Com isso um agente deve conseguir trabalhar em ~2-5 minutos de leitura.

## Mapa das áreas

| Ordem | Arquivo | Área | Estado | Última atualização |
| ----- | ----------------------- | ------------------- | ------ | ------------------ |
| 01 | `01_PROJECT_CONTEXT.md` | Contexto geral | Estável — leitura obrigatória de todo agente novo | 2026-09-23 |
| 02 | `02_ARCHITECTURE.md` | Arquitetura real | Estável | 2026-09-23 |
| 03 | `03_DATABASE.md` | Supabase/PostgreSQL | ⚠️ Migration `20260923093000` pendente de aplicação manual no SQL Editor | 2026-09-23 |
| 04 | `04_API.md` | API Next.js (app/api) | Estável | 2026-09-23 |
| 05 | `05_FRONTEND.md` | Frontend (app/) | Estável | 2026-09-23 |
| 06 | `06_WHATSAPP_BOT.md` | Bot Baileys (bot/) | Estável | 2026-09-23 |
| 07 | `07_CARD_RECOGNITION.md` | Reconhecimento (recognition/) | Estável; gap do índice `es` pendente | 2026-09-23 |
| 08 | `08_AUCTION_DOMAIN.md` | Domínio de leilão | Estável | 2026-09-23 |
| 09 | `09_TESTS_AND_VALIDATION.md` | Testes e validação | Estável | 2026-09-23 |
| 10 | `10_SECURITY_AND_PERFORMANCE.md` | Segurança e performance | Estável | 2026-09-23 |
| 11 | `11_PENDING_WORK.md` | Trabalho pendente | 🔴 Itens abertos (ver arquivo) | 2026-09-23 |
| 12 | `12_SESSION_HANDOFF.md` | Checkpoint da sessão | Atualizado a cada sessão | 2026-09-23 |

## Estado atual resumido por área

- **Site/API (app/, lib/)** — funcional. Cadastro em lote com valores personalizados + automático; exportação Excel com TOTAL e aba de alterações; janela do dashboard 30 dias.
- **Banco (supabase/)** — migration de avisos globais + histórico de valores + limpeza 30d (`20260923093000`) **escrita e versionada, mas NÃO aplicada na instância Supabase** (aplicação manual via SQL Editor é o fluxo estabelecido do projeto — ver `11_PENDING_WORK.md` item P-02).
- **Bot (bot/)** — funcional; supervisor com restart noturno, teto de heap 384 MB, dreno de notificações de avisos globais.
- **Reconhecimento (recognition/)** — funcional e reforçado (pré-2011 + Devir + anti-ruído); carga lazy + descarga por inatividade; ~13.271 cartas `es` fora do índice visual (build pendente, intencionalmente adiado pelo operador).
- **CI (.github/workflows/ci.yml)** — verde: Postgres 17 real + todas as migrations + SQL tests + bot + python + build + smoke.

## Próxima área recomendada

Ver **`11_PENDING_WORK.md`** (backlog priorizado) e **`12_SESSION_HANDOFF.md`** (checkpoint). A área mais provável do próximo trabalho funcional: **reconhecimento** (bug do `/memory/confirm` 401, item P-01) ou **banco** (aplicação/validação da migration, item P-02).

## Comandos oficiais (referência rápida — detalhes em `09_TESTS_AND_VALIDATION.md`)

```bash
npm ci                       # site (raiz)
npm --prefix bot ci          # bot
npm run typecheck            # tsc --noEmit
npm test                     # node --test tests/*.test.mjs
npm --prefix bot test        # testes do bot (via npm run check)
npm run build                # next build
npm run start                # site + bot + serviço de reconhecimento (Windows, máquina do operador)
python -m unittest discover -s recognition/tests   # testes python (no venv recognition/.venv)
```
