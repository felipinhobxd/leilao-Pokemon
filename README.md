# Leilão Pokémon

Painel administrativo de leilões de cartas Pokémon com Supabase como fonte oficial da verdade, automação de enquetes no WhatsApp e exportação Excel.

## Funcionalidades

- Login com Supabase Auth e autorização por `admin_profiles` (`admin`/`operator` escrevem, `viewer` consulta).
- Cadastro e edição de cartas, participantes e leilões; remoções preservam histórico.
- Abrir disputa, registrar/trocar/retirar lance, ARREMATE e finalizar com compra/entrega inicial.
- Um lance ativo por participante/leilão; desempate pelo primeiro lance válido confirmado.
- Participantes suspensos/bloqueados não lançam nem vencem.
- Transação única, lock do leilão e idempotência global por evento.
- Histórico/auditoria, Realtime e exportação Excel completa.
- Página `/whatsapp` para programar o envio de uma carta + enquete em um grupo.
- Bot local Baileys para disparar no horário, receber votos, registrar maior lance, ARREMATE e encerrar leilões com prazo.

## Configuração do painel

Node.js 24+. Nunca coloque chaves privadas em commits ou variáveis `NEXT_PUBLIC_*`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLICAVEL
SUPABASE_SERVICE_ROLE_KEY=CHAVE_PRIVADA_APENAS_NO_SERVIDOR
```

### Banco

Em banco novo, aplique `supabase/schema.sql`. Em banco já configurado, use `supabase/operations.sql` conforme necessário e depois `supabase/whatsapp_bridge.sql` para a ponte do WhatsApp.

O projeto hospedado atual é `PokemonLeilao` (`gsyuoggymjdzxibfujyv`). O grupo de teste configurado no ambiente atual é `teste` (`120363429348829532@g.us`).

## WhatsApp

Fluxo atual:

```text
Painel /whatsapp
      ↓
Supabase (agendamento)
      ↓
Bot Baileys rodando no PC
      ↓
Grupo WhatsApp
      ↓
votos / mudança / retirada / ARREMATE
      ↓
Supabase → painel ao vivo
```

O bot fica em `bot/`. Veja `bot/README.md` para configuração local. Ele deve rodar durante os leilões e pode reutilizar a sessão Baileys já criada pelo leitor antigo, desde que apenas uma instância use a sessão por vez.

O painel agenda somente leilões em **rascunho**. No horário programado o bot envia a carta e a enquete e abre a disputa automaticamente. Não clique em “Abrir leilão” manualmente antes do disparo programado.

Quando houver `scheduled_end_at`, o bot finaliza o leilão ao chegar o prazo. Se alguém selecionar a opção marcada como ARREMATE, a operação atômica do banco fecha a venda imediatamente e impede vencedor duplicado.

## API / motor do leilão

O núcleo continua centralizado em `process_auction_command`. Os eventos principais são:

- `BID_PLACED`
- `BID_CHANGED`
- `BID_WITHDRAWN`
- `BUYOUT_REQUESTED`
- `BUYOUT_CONFIRMED`

Eventos têm identidade estável e podem ser reenviados após timeout sem duplicar a operação. O Supabase, e não o WhatsApp, determina o resultado oficial.

## Excel

`GET /api/export` gera `.xlsx` com Resumo, Cartas, Participantes, Leilões, Lances, Compras, Pagamentos, Entregas, Advertências e Auditoria. O Excel é relatório/exportação; o banco continua sendo a fonte oficial.

## Validação

```bash
npm run typecheck
npm test
npm run build
node --check bot/index.mjs
```

O CI usa PostgreSQL 17 descartável, valida o schema base, a migration da ponte WhatsApp, regras funcionais, corridas de ARREMATE e a build Next.js.

## Segurança

- Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no navegador, WhatsApp, GitHub ou mensagens.
- A pasta de sessão Baileys é segredo e está ignorada pelo Git.
- Baileys é uma integração não oficial; faça os primeiros testes apenas no grupo `teste`.
