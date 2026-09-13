# Leilão Pokémon

Painel administrativo para leilões de cartas Pokémon com Supabase como fonte oficial da verdade, Next.js no Netlify e um worker local Node.js/Baileys para a integração com WhatsApp.

## Arquitetura

```text
Painel Next.js / Netlify
        ↓
API autenticada
        ↓
Supabase / PostgreSQL
        ↓
whatsapp_dispatches
        ↓
Worker Baileys no Windows
        ↓
WhatsApp
        ↓
votos / troca / retirada / ARREMATE
        ↓
Supabase → Realtime → painel
```

O bot **não** roda em Netlify Function, Edge Function ou navegador automatizado. O processo persistente fica no Windows e usa Baileys diretamente.

## Instalação inicial do painel

Requisitos: Node.js 24+ e acesso ao projeto Supabase configurado.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure no `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLICAVEL
SUPABASE_SERVICE_ROLE_KEY=CHAVE_PRIVADA_APENAS_NO_SERVIDOR
```

Nunca use a `SUPABASE_SERVICE_ROLE_KEY` em variável `NEXT_PUBLIC_*`, no navegador, no GitHub ou em mensagens.

O banco de produção atual é `PokemonLeilao`. Alterações de schema devem ser feitas por migrations versionadas em `supabase/migrations/`; o Supabase continua sendo a fonte oficial dos leilões, lances, vencedores e histórico.

## Instalação do bot no Windows

Entre em `bot/`, instale as dependências e crie o arquivo local de configuração:

```powershell
cd bot
npm install
Copy-Item .env.example .env
notepad .env
```

Preencha as variáveis descritas em `bot/.env.example`. O diretório indicado por `WHATSAPP_SESSION_DIR` guarda a sessão Baileys e deve permanecer somente no PC.

Para instalar o bot em segundo plano, abra PowerShell na pasta `bot` e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-service.ps1
```

A instalação cria a tarefa agendada `PokemonLeilaoWhatsAppBot`. Ela inicia no boot/login, roda sem CMD permanente, reinicia o supervisor em caso de queda e preserva a sessão existente.

Logs básicos ficam em:

```text
bot/logs/bot-service.log
```

Para remover a tarefa sem apagar a sessão nem o `.env`:

```powershell
.\uninstall-service.ps1
```

Depois de atualizar o código do bot, rode `npm install` em `bot/` e execute novamente `install-service.ps1` para garantir que a tarefa aponta para a versão atual.

## Conectar o WhatsApp

1. Deixe o serviço do Windows ativo.
2. Entre no painel administrativo.
3. Abra **Central WhatsApp** (`/whatsapp`).
4. Se não houver sessão válida, o QR temporário aparecerá apenas para `admin`/`operator`.
5. No celular, use **WhatsApp → Aparelhos conectados → Conectar aparelho** e leia o QR.
6. Quando conectar, o QR expira e é apagado do estado do worker.
7. Clique em **Atualizar grupos** e escolha o grupo padrão pelo nome.

A sessão completa do Baileys nunca é salva no Supabase. O banco guarda apenas estado operacional, heartbeat e um QR temporário com TTL quando necessário.

Se aparecer `440 / connectionReplaced`, não abra uma segunda instância usando a mesma pasta de sessão. O supervisor interrompe a reconexão automática desse caso para evitar duas instâncias se expulsando continuamente.

## Uso normal

O fluxo diário não exige a Central WhatsApp para montar enquetes:

```text
Abrir o site
→ + Novo leilão
→ Carta
→ Valores
→ Prévia
→ PUBLICAR AGORA
```

Ao publicar, o backend cria de forma transacional a carta (quando necessária), o leilão e o dispatch. O bot recebe o dispatch, envia a imagem/legenda, cria a enquete nativa pelo Baileys e abre a disputa no banco.

Se o computador do bot estiver offline, o lote e o dispatch permanecem salvos como pendentes. Quando o worker voltar, ele retoma a fila. IDs determinísticos e estágios de entrega persistidos reduzem o risco de reenvio duplicado após uma queda.

As opções da enquete são geradas automaticamente por:

```text
lance inicial + incremento + ARREMATE
```

O limite atual é 12 opções. A enquete usa `selectableCount: 1`, portanto continua existindo somente um lance ativo por participante. Troca de opção vira `BID_CHANGED`; retirada vira `BID_WITHDRAWN`; a opção de ARREMATE fecha atomicamente no PostgreSQL.

## Central WhatsApp

`/whatsapp` é uma tela operacional para:

- status e heartbeat do worker;
- conta conectada e sessão;
- QR temporário;
- reconectar/desconectar;
- sincronizar grupos;
- escolher grupo padrão;
- acompanhar dispatches recentes e etapas de envio.

O painel não finge conseguir ligar um computador desligado. Se o heartbeat expirar, o worker aparece claramente como offline.

## Confiabilidade

O núcleo de domínio continua em `process_auction_command` e usa IDs idempotentes. Os principais eventos são:

- `BID_PLACED`
- `BID_CHANGED`
- `BID_WITHDRAWN`
- `BUYOUT_REQUESTED`
- `BUYOUT_CONFIRMED`

O PostgreSQL determina o resultado oficial. ARREMATE usa lock/transação para impedir dois vencedores. Eventos repetidos podem ser reenviados com a mesma identidade sem duplicar a operação.

O dispatch do WhatsApp persiste separadamente se a imagem e a enquete foram enviadas. Se o processo cair, o worker tenta continuar da etapa ainda não confirmada.

## Excel

`GET /api/export` gera `.xlsx` administrativo. O Excel é relatório/exportação e não substitui o banco.

## Validação técnica

Antes de publicar alterações:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Bot:

```bash
cd bot
npm install
npm run check
```

O CI também valida PostgreSQL 17, migrations, fluxo transacional de criação de lote, concorrência de ARREMATE, eventos duplicados, scripts do serviço Windows, build de produção e proteção das rotas administrativas.

## Segurança

- RLS permanece habilitado nas tabelas expostas; o navegador recebe apenas permissões de leitura necessárias.
- Escritas administrativas passam por APIs/RPCs confiáveis.
- `processed_commands` não possui policy de leitura propositalmente e é acessado apenas por `service_role`.
- QR só é retornado a `admin`/`operator` enquanto estiver dentro do TTL.
- A pasta de sessão Baileys e as chaves privadas ficam fora do Git.
- O worker local ainda é infraestrutura privilegiada porque utiliza uma chave de servidor; proteja o PC e o arquivo `bot/.env`.
- Baileys é uma integração não oficial do WhatsApp e deve ser acompanhado após atualizações do WhatsApp/Baileys.
