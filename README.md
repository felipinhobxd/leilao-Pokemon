# Leilão Pokémon

Painel administrativo para leilões de cartas Pokémon com Supabase como fonte oficial da verdade, Next.js na Vercel e um worker local Node.js/Baileys para a integração com WhatsApp.

## Arquitetura

```text
Painel Next.js / Vercel
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

O bot **não** roda em Vercel Function, Edge Function ou navegador automatizado. O processo persistente fica no Windows e usa Baileys diretamente.

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
SUPABASE_SECRET_KEY=CHAVE_PRIVADA_APENAS_NO_SERVIDOR
```

Na Vercel, a integração do Supabase fornece `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` e `SUPABASE_SECRET_KEY`. Para instalações locais/self-hosted, `SUPABASE_SERVICE_ROLE_KEY` continua aceito como fallback. Nunca use uma chave secreta em variável `NEXT_PUBLIC_*`, no navegador, no GitHub ou em mensagens.

O banco de produção é `PokemonLeilao`. Estado de 2026-10-25: **68 migrations locais / 76 registros remotos**; existem divergências históricas de versão já mapeadas. A migration nova `20261025181640_dashboard_auction_detail.sql` foi instalada pelo conector e tem a mesma versão local/remota. Consulte [a auditoria](docs/agent/13_MIGRATION_AUDIT.md) antes de aplicar SQL; não executar `db push`/`repair` geral.

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

O smoke local verifica rejeição de chamadas sem autenticação; não testa uma sessão completa de operador. O CI também valida PostgreSQL 17, migrations, fluxo transacional de criação de lote, concorrência de ARREMATE, eventos duplicados, scripts do serviço Windows, build de produção e proteção das rotas administrativas.

## Segurança

- RLS permanece habilitado nas tabelas expostas; o navegador recebe apenas permissões de leitura necessárias.
- Escritas administrativas passam por APIs/RPCs confiáveis.
- `processed_commands` não possui policy de leitura propositalmente e é acessado apenas por `service_role`.
- QR só é retornado a `admin`/`operator` enquanto estiver dentro do TTL.
- A pasta de sessão Baileys e as chaves privadas ficam fora do Git.
- O worker local ainda é infraestrutura privilegiada porque utiliza uma chave de servidor; proteja o PC e o arquivo `bot/.env`.
- Baileys é uma integração não oficial do WhatsApp e deve ser acompanhado após atualizações do WhatsApp/Baileys.

## Memória de manutenção e consumo

O estado atual está em [docs/agent/00_INDEX.md](docs/agent/00_INDEX.md). Os riscos de retenção/pós-venda e recuperação de anúncios estão registrados em [11_PENDING_WORK.md](docs/agent/11_PENDING_WORK.md), sem alteração de comportamento nesta revisão.

Em 2026-10-25 o painel Supabase mostrou Log Ingestion 0,88/1 GB. Priorize consultas pontuais de catálogo; não execute backup, limpeza ou testes de carga para conferir migrations. Essa leitura não garante o consumo futuro dos processos em operação.

## Excluir os leilões encerrados

Administradores têm o botão **Excluir leilões encerrados** no painel. É preciso digitar duas confirmações: **excluir leilões encerrados** e **quero excluir os encerrados**. Apaga todos os vendidos, encerrados sem vencedor e cancelados, com lances, compras, pagamentos e entregas vinculados (inclusive pendentes). Leilões abertos, rascunhos/agendados e em revisão permanecem. A ação é definitiva; participantes, sessão WhatsApp e numeração de lotes são mantidos.

Migration 20261025055529 instalada em produção e versionada. As contagens atuais estão na seção Arquitetura e no documento 18; contagens das rodadas anteriores são históricas. A implementação não executou exclusões reais. Testes SQL são feitos em banco descartável.


## Horário comum, resultados e backup — bot 0.2.7

Na etapa Publicação do cadastro em lote, escolha **Mesmo horário para todas as cartas** e a data/hora de Brasília (padrão: próxima 1h da manhã). O prazo deve ser depois da última publicação e em até sete dias do início. Cartas antigas e rascunhos antigos mantêm o modo de duração individual. É necessário reabrir o bot atualizado antes de criar uma fila com horário comum.

Após a última carta/brinde ser publicada com sucesso, o bot envia @all nativo e “LEILÃO FINALIZADO! LANCES VÁLIDOS ATÉ [horário escolhido]!”. Os lances encerram juntos; os resultados são entregues com intervalo mínimo de 15s por grupo. Avisos pendentes ficam no banco para nova tentativa após falhas/reinício. @all exige permissão de administrador em grupos com mais de 32 membros.

**Baixar backup** gera uma cópia consistente, transfere blocos menores e entrega um link privado com validade de dois minutos. O arquivo é JSON compactado (.json.gz); extraia-o para ler o JSON. Mantém-se uma cópia manual por administrador. O bot também envia cópias compactadas para a nuvem e mantém JSON normal no PC. Há limites históricos de rascunhos/quick polls e retenção de sete dias da auditoria/cache; imagens/sessão não estão incluídas. Detalhes em docs/agent/15_DEADLINE_BACKUP_AND_RECOVERY.md.

Os erros 521/522 indicam indisponibilidade do endereço Supabase. O código usa timeout real, pausa progressiva em consultas de fundo e logs resumidos; isso não garante disponibilidade do provedor. Comandos reais de lance/participante mantêm sua própria tentativa, sem replay automático de escritas.

## Painel e recuperação — 0.2.8

Navegação compartilhada, temas claro/escuro/sistema, buscas locais, tabelas acessíveis e layout para celular. A área **Saúde da operação** consulta o bot, backups automáticos, avisos pendentes e falhas de publicação somente ao clicar. **Tentar novamente** libera apenas avisos ainda pendentes e sem remetente ativo; nunca republica cartas automaticamente. Reabra o bot atualizado para registrar falhas de backup, recuperação do Supabase e problemas de @all. [Detalhes e validação](docs/agent/16_OPERATION_HEALTH_AND_UI.md).

## Quiz e brindes com vencedor — 0.2.9

Na área **Brindes e Quiz**, escolha o tipo, a carta/prêmio, opções e a única resposta correta. Quiz também pede a pergunta. No lote, escolha **Leilão / Brinde / Quiz** no tipo da carta. Configure pergunta/opções/resposta na etapa Cartas e revise em Valores. O primeiro acerto confirmado ganha; o bot anuncia o nome e a carta e registra o resultado sem cobrança. Respostas ficam privadas, vencedor não muda após troca/retirada. Reabra o bot 0.2.9 antes de criar jogos. [Fluxo e validação](docs/agent/17_QUIZ_AND_GIVEAWAY_PRIZES.md).

## Revisão de confiabilidade e interface — bot 0.2.10

Criações com confirmação incerta preservam ID/payload e podem ser recuperadas após recarregar a aba. O painel lê o líder do conjunto completo de lances elegíveis da disputa selecionada, sem depender dos 500 lances globais. Rascunhos preservam novos detalhes, mostram estado de salvamento e pausam tentativas após falha.

Cadastro com busca, filtros, páginas de 12 cartas (limite de 200 preservado), escolha explícita do tipo e foco no erro. Painel prioriza operação, diagnóstico recolhível, compras com busca/pagamento/totais e leitura adaptada ao celular. A fila não consulta em segundo plano ou depois de concluída/cancelada; o bot impede sobreposição de ciclos de abertura.

Dependências atualizadas, Next.js 16.4.3 e auditorias npm sem alertas nesta rodada. Testes de navegador com dados isolados na CI: `npm run test:browser` (instalar Chromium com `npx playwright install chromium`). Não usam credenciais Supabase ou WhatsApp. Reabra o supervisor e o filho do bot para carregar **0.2.10**; a atualização do site não reinicia o bot local. [Estado e limites](docs/agent/18_RELIABILITY_AND_UI_REVIEW.md).
