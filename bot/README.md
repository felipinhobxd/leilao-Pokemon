# Bot WhatsApp — Leilão Pokémon

O Baileys continua rodando localmente no Windows. O uso diário não exige uma janela CMD aberta: `service.mjs` supervisiona o processo real do bot e o Windows Task Scheduler inicia o supervisor em segundo plano.

## O que ele faz

- lê os disparos programados no Supabase;
- envia foto/texto da carta e enquete nativa;
- acompanha votos, trocas, retiradas e ARREMATE;
- publica status/heartbeat do worker no Supabase;
- publica QR temporário para o painel quando a sessão precisa ser vinculada;
- aceita do painel os comandos Reconectar, Desconectar e Sincronizar grupos;
- reinicia o processo do bot quando ele cai;
- encerra automaticamente leilões com `scheduled_end_at` enquanto o worker estiver online;
- anuncia ARREMATE e resultado final no grupo.

## Arquitetura de Filas (Fase 3)

A partir da Fase 3, o bot utiliza **BullMQ + Redis** para garantir entrega confiável das mensagens:

1. **API Next.js** (`app/api/whatsapp/bot/route.ts`) apenas enfileira os disparos
2. **Queue Worker** (`queue-worker.mjs`) consome a fila e envia via Baileys
3. **Session Guard** (`session-guard.mjs`) gerencia reconexão independentemente da fila

### Vantagens

- Mensagens não são perdidas se o socket cair durante o envio
- Retry automático com backoff exponencial (5 tentativas)
- Métricas de sucesso/falha por dispatch
- Suporte a múltiplos workers consumindo a mesma fila

### Configuração do Redis

Adicione ao `.env`:

```env
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=sua_senha_se_necessario
```

Para produção, use Redis persistente (não efêmero).

### Executando o Queue Worker

```powershell
npm run start:queue-worker
```

Ou instale como serviço Windows adaptando `install-service.ps1`.

## Configuração inicial

Use Node.js 24+.

```powershell
cd bot
npm.cmd install
copy .env.example .env
notepad .env
```

Preencha `.env` com:

- `SUPABASE_URL`: URL do projeto;
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada do servidor. Nunca envie ao navegador nem ao GitHub;
- `BOT_ADMIN_USER_ID`: UUID de um `admin` ou `operator` ativo;
- `BOT_WORKER_ID`: identificador estável, por exemplo `pc-leilao-01`;
- `WHATSAPP_SESSION_DIR`: pode apontar para a sessão Baileys já usada pelo leitor antigo;
- `BOT_HEARTBEAT_SECONDS`: padrão recomendado `12`;
- `BOT_QR_TTL_SECONDS`: padrão recomendado `90`;
- `REDIS_HOST`: hostname do Redis (padrão: `localhost`);
- `REDIS_PORT`: porta do Redis (padrão: `6379`);
- `REDIS_PASSWORD`: senha do Redis (opcional).

Exemplo reaproveitando a sessão existente:

```env
WHATSAPP_SESSION_DIR=C:/Users/Admin/Documents/LeilaoPokemon/leitor-whatsapp/sessao
REDIS_HOST=redis.local
```

Antes da primeira instalação, feche `monitor.mjs` e qualquer outra instância do Baileys que use a mesma sessão. Duas instâncias podem gerar `440 connectionReplaced`.

## Instalar em segundo plano no Windows

Abra PowerShell na pasta `bot` e execute:

```powershell
Set-ExecutionPolicy -Scope Process Bypass
.\install-service.ps1
```

O instalador:

- solicita UAC uma vez;
- verifica Node/npm e dependências;
- cria a tarefa `PokemonLeilaoWhatsAppBot`;
- inicia o supervisor escondido;
- configura inicialização automática no reboot/login;
- configura reinício pelo Task Scheduler se o supervisor encerrar;
- preserva a sessão Baileys existente.

O próprio `service.mjs` também reinicia o processo `index.mjs` quando ele cai. O erro 440 é tratado como exceção: ele não entra em loop brigando com outra instância.

Logs básicos ficam em:

```text
bot/logs/bot-service.log
```

Ao passar de aproximadamente 10 MB, o arquivo é rotacionado para `bot-service.previous.log` na próxima inicialização.

## Remover o serviço

```powershell
.\uninstall-service.ps1
```

Isso remove somente a tarefa agendada. `.env`, sessão Baileys e logs não são apagados.

## Uso manual / diagnóstico

Para rodar o supervisor visivelmente:

```powershell
npm.cmd start
```

Para rodar apenas o bot antigo em primeiro plano:

```powershell
npm.cmd run start:foreground
```

Não rode o serviço e `start:foreground` ao mesmo tempo usando a mesma sessão.

## Status e QR no painel

Abra `/whatsapp` no painel.

O worker envia heartbeat aproximadamente a cada 10–15 segundos. O painel considera o PC/worker offline quando o heartbeat fica antigo; ele nunca finge que consegue ligar um computador desligado.

Quando o Baileys pedir autenticação:

1. o supervisor publica somente o payload temporário do QR e sua representação visual;
2. o painel mostra o QR somente para `admin`/`operator`;
3. o QR expira automaticamente;
4. ao conectar, `qr_payload`/QR visual são apagados;
5. credenciais completas da pasta de sessão nunca são enviadas ao Supabase.

O painel oferece:

- **Reconectar** — reinicia a conexão Baileys sem reiniciar o Windows;
- **Desconectar** — para a conexão, mantendo o supervisor vivo para receber um futuro Reconectar;
- **Sincronizar grupos** — pausa o bot brevemente, sincroniza os grupos disponíveis no Supabase e retoma a conexão.

## Arquitetura

```text
Painel Netlify
→ Supabase
→ supervisor local (service.mjs)
→ bot Baileys (index.mjs)
→ WhatsApp
→ votos
→ Supabase
→ painel
```

O Baileys não deve ser hospedado permanentemente em Netlify Function, Edge Function ou Scheduled Function.

## Aviso

Baileys é uma integração não oficial com o WhatsApp. Use um número separado quando possível e mantenha o volume de automação moderado.
