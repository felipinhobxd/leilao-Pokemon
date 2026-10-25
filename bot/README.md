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

## Fila persistente de disparos (opcional, Fase 3)

O problema: o Baileys perde o socket com frequência. Se a queda coincide com o dispatch de um lote, o envio falhava e gastava as 5 tentativas do SQL em erros de socket — após ~1 minuto de instabilidade o lote virava `failed` e o usuário ficava sem a mensagem ("bot não postou").

Com `REDIS_URL` configurada no `.env` (ex.: `redis://127.0.0.1:6379`), o bot passa a usar uma fila **BullMQ + Redis**:

- O Supabase (`whatsapp_dispatches`) continua sendo a fonte da verdade: claim, attempts, status e erros seguem auditáveis no painel.
- O job sobrevive a quedas de socket **e a reinícios do processo** (fica persistido no Redis). Enquanto o WhatsApp está desconectado, o job tenta aguardar (`socket_whatsapp_down`) com backoff exponencial 5s→60s (25 tentativas ≈ 23 min) — sem gastar o orçamento de tentativas do SQL.
- Após a reconexão o envio acontece automaticamente: o envio volta a ser tentado, sujeito ao orçamento de retries.
- Erros de dados (grupo indisponível, leilão não publicável, opções inválidas, carta sumiu) são **irrecuperáveis**: o lote é marcado `failed` na hora, sem queimar retries.
- Idempotência por desenho: o worker re-lê o dispatch no Supabase e pula linhas já `sent`/`cancelled`/`failed`; o envio também é idempotente por etapa (`announcement_sent_at`/`poll_sent_at`).
- **Sem Redis** (ou se o Redis falhar no momento do enfileiramento) o envio direto original é usado — fallback para o caminho direto.
- O painel ganha a métrica `dispatch_success_rate`: "Envios (24h)" mostra `sent/(sent+failed)` reais da tabela de disparos.

A reconexão do Baileys continua sendo exclusiva de `connect()` + supervisor (`session-guard.mjs` garante sessão única); a fila nunca toca no socket.

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
- `BOT_QR_TTL_SECONDS`: padrão recomendado `90`.

Exemplo reaproveitando a sessão existente:

```env
WHATSAPP_SESSION_DIR=C:/Users/Admin/Documents/LeilaoPokemon/leitor-whatsapp/sessao
```

Antes da primeira instalação, feche `monitor.mjs` e qualquer outra instância do Baileys que use a mesma sessão. Duas instâncias podem gerar `440 connectionReplaced`.

## Atualizar o bot instalado

Quando o painel receber uma função nova do bot, atualize o código do PC antes de usar essa função. Para o suporte de logout completo da sessão WhatsApp, na pasta do repositório execute:

```powershell
git pull origin main
cd bot
npm.cmd install --omit=dev
Get-ScheduledTask -TaskName PokemonLeilaoWhatsAppBot -ErrorAction SilentlyContinue | Stop-ScheduledTask
Start-ScheduledTask -TaskName PokemonLeilaoWhatsAppBot
```

A versão que suporta **logout completo da sessão Baileys** é `0.2.4` ou superior. O painel mostra a versão do worker na Central/Operação.

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
Painel Next.js / Vercel
→ Supabase
→ supervisor local (service.mjs)
→ bot Baileys (index.mjs)
→ WhatsApp
→ votos
→ Supabase
→ painel
```

O Baileys precisa de processo persistente e não deve rodar permanentemente em função serverless.

## Aviso

Baileys é uma integração não oficial com o WhatsApp. Use um número separado quando possível e mantenha o volume de automação moderado.

## Estado de manutenção — 2026-10-25

Migrations de participantes, avisos, limpeza 12h/prune 7d e backup já registradas no PokemonLeilao; detalhes e versões remotas em [13_MIGRATION_AUDIT.md](../docs/agent/13_MIGRATION_AUDIT.md). Não reaplicar a lista antiga. O intervalo principal do bot e a consulta de comandos do supervisor são de cinco segundos.

A limpeza atual pode remover pós-venda pendente antes dos lembretes de sete dias. O backup existente no dia não prova cobertura de toda exclusão posterior. Falhas de anúncio final e concorrência entre ticks da abertura também estão documentadas em [11_PENDING_WORK.md](../docs/agent/11_PENDING_WORK.md). Nada disso foi alterado nesta revisão documental.

Log Ingestion mostrado no painel em 2026-10-25: 0,86/1 GB. Não iniciar/reiniciar o bot nem disparar backups/testes apenas para conferir migrations; usar metadados pontuais. Logs locais do terminal e linhas da tabela auction_events não são a mesma métrica de ingestão dos serviços Supabase.

## Correções do bot 0.2.6 — @all nativo

A abertura agora envia `mentionAll: true`, com validação de administrador para grupos acima de 32 participantes. Sem permissão ou metadata confiável, o bot envia aviso simples sem @all e explica no log. Não concede admin automaticamente. Atualize/reinicie o processo na janela operacional adequada para carregar a versão nova; arquivos atualizados não mudam um processo Node já aberto. Não se garante alerta sonoro a quem silenciou @all.


## Bot 0.2.7 — encerramento comum e recuperação

- Novo finalizador por lote e outbox whatsapp_auction_notices: fecha no prazo do banco e entrega resultados espaçados por pelo menos 15s/grupo, com locks, retry e messageId estável.
- Após publicação completa de uma fila com ends_at, resumo com @all nativo e horário de Brasília. Falha de metadata/permissão mantém o aviso pendente; não informa sucesso sem a menção solicitada.
- Supabase: fetch com timeout real e circuito de recuperação para fundo; erros HTML resumidos e repetidos no máximo uma vez por minuto/escopo. RPCs de lance e resolução do participante não são bloqueados apenas porque um heartbeat falhou. Sem replay automático de escritas.
- Backup: snapshot consistente, leitura em blocos de 262144 caracteres, compressão Gzip nas cópias da nuvem. O JSON no disco local continua normal. Guard da limpeza reconhece .json e .json.gz. A política diária/retentiva e a questão de cobertura temporal P-19 permanecem.
- É preciso carregar a nova versão do supervisor e do processo filho; a API bloqueia novo horário comum enquanto o worker mais recente ainda informa versão anterior a 0.2.7. Não iniciar um segundo bot sobre a mesma sessão. Nenhum envio WhatsApp de teste foi feito nesta implementação.

## Diagnósticos no painel — 0.2.8

Reabra o supervisor e seu filho após atualizar os arquivos. O heartbeat existente carrega `operational_health` apenas quando muda: backup automático (em preparo/concluído/falha), recuperação do acesso ao banco e último diagnóstico de @all da abertura. Falhas dos avisos duráveis também guardam mensagem curta; entrega confirmada limpa o erro. Sem um segundo processo, timer de telemetria ou envio de mensagens para testar. Migration `20261025073504_operation_health_and_notice_errors.sql` deve estar aplicada antes de iniciar 0.2.8.
