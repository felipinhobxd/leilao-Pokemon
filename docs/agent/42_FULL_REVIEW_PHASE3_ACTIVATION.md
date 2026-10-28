# Revisão completa — fase 3: instalação e validação real (28/10/2026)

## Estado atual

Bot **0.2.24 ativado e conectado**. Site local e supervisor iniciados com `npm run start`, após encerrar o site antigo e fazer novo build. Migrations das fases 1 e 2 instaladas no projeto Supabase correto, revisão funcional **2**, funções novas somente para `service_role`, `SECURITY INVOKER`. Não repetir a instalação nem executar `db push` para tentar reconciliar o histórico inteiro.

| Arquivo local | Nome remoto | Versão registrada remotamente |
|---|---|---|
| `20261028190535_phase_one_delivery_and_admin_retries.sql` | `phase_one_delivery_and_admin_retries` | `20261028195502` |
| `20261028192328_phase_two_request_economy.sql` | `phase_two_request_economy` | `20261028195514` |

A ferramenta de migrations atribuiu timestamps remotos próprios. Os dois SQLs foram lidos diretamente dos arquivos aprovados e aplicados na ordem, com sucesso. A revisão 2, a função de descoberta, a leitura agregada e as permissões foram conferidas por uma consulta agrupada. Divergências históricas anteriores não foram reparadas nem reaplicadas.

## Autorização e avisos antigos

Operador autorizou iniciar a fase 3. Antes de conectar, foram encontrados 29 avisos de encerramento pendentes em um grupo real, sem tentativas de envio. O operador inicialmente liberou os envios, mas **revogou essa orientação antes da inicialização**, pedindo excluir esses avisos e usar apenas **“teste leilão”** para os testes. A orientação mais recente foi seguida.

Os 29 avisos foram removidos em uma transação restrita ao grupo, tipo, intervalo de criação, ausência de envio/lock/tentativas e leilão já encerrado. A transação exigiu exatamente 29 registros e gravou o motivo `AUCTION_NOTICE_DISCARDED` no histórico. Não houve envio desses avisos nem alteração financeira por esse descarte. Antes de ligar: zero leilões abertos, publicações pendentes, jogos a publicar, avisos administrativos ou lembretes de pagamento vencidos.

**Na inicialização, a rotina automática normal de retenção fez o backup do dia e depois removeu 52 leilões antigos e seus dados associados (1.310 registros), conforme a política já autorizada de 12h após publicação, inclusive vendas/arremates.** O backup local e a cópia confirmada `backups/backup-20261028-1658.json.gz` foram concluídos antes dessa limpeza. Portanto, não afirmar que os dados desses leilões permanecem no banco: o descarte dos avisos preservou os resultados, mas a rotina de retenção posterior os removeu com backup. O segundo início reutilizou a cópia confirmada do dia, sem nova exportação completa.

## Ativação da economia no site

- `.env.local` recebeu apenas `DASHBOARD_OPERATIONS_RPC_ENABLED=1`, sem alteração de credenciais e sem inclusão no Git.
- `.env.production`, versionado, contém somente essa configuração não secreta para o deploy do próprio repositório. Variáveis locais/da plataforma podem sobrepor o valor; `0` mantém disponível o caminho anterior.
- O conector Vercel acessível nesta conversa não tinha o projeto/time correto. Não foi usado para alterar outro projeto nem para obter credenciais. O deploy continua pela integração GitHub já existente.
- Uma chamada real ao helper com o cliente Supabase instrumentado confirmou **uma requisição**, para `/rest/v1/rpc/read_dashboard_operations`, com resposta válida. Isso mede a consulta agregada no ambiente local; não é medição de bytes de logs nem de chamadas de uma sessão autenticada na Vercel.
- O build local carregou a configuração de produção. A Central foi conferida com a sessão administrativa existente: conectada, uma seleção de grupo e “teste leilão” como padrão. A aba temporária de verificação foi fechada para não manter polling de teste.

## Testes reais no grupo de teste

Foram publicados dois itens claramente identificados como **TESTE FASE 3 — SEM VENDA REAL**, sem imagens e sem prêmio/venda reais, com prazo comum às **17h04min15s de Brasília**:

1. Arremate técnico confirmado pela RPC financeira com participante fictício sem telefone. A venda simulada gerou `buyout_confirmed` atomicamente; anúncio confirmado às **17h03min25s**, uma tentativa, sem erro.
2. Outro lote ficou sem lances e encerrou automaticamente às **17h04min25s**, após o prazo e as proteções normais de processamento; o aviso foi confirmado no mesmo segundo, uma tentativa, sem erro.

A conclusão da fila foi enviada às **17h03min06s**, também com uma tentativa. Os três avisos ficaram com `sent_at` preenchido, sem erro, e o destino foi exclusivamente o grupo de teste. Não foi feita nova simulação de voto criptografado em celular: o arremate técnico usou a RPC, enquanto o bot real cuidou de publicação, resumo, fechamento e entrega. As validações de votos recebidos e de falha/replay permanecem nos testes e nos ensaios reais anteriores.

Os dois leilões/cartas técnicos, fila e compra simulada foram removidos pela RPC de exclusão individual existente, depois das entregas. Não restou compra fictícia ou aviso pendente. O participante fictício foi desativado pelo comando padrão de exclusão de participante (soft delete/status `banned`). Os dois números consumidos pelo teste foram devolvidos à posição anterior da sequência somente após confirmar que ninguém havia criado lote posterior, sob o mesmo advisory lock; não foi feita renumeração de lotes reais.

## Correção encontrada na validação

A sessão salva do Baileys possuía identidade/chaves e conectava normalmente, mas mantinha `registered=false`. O heartbeat antigo reportava “Sessão não autenticada” apesar de `status=connected`. Em **0.2.24**, uma conexão autenticada passa a ser autoridade para `session_active`; fora de `connected`, permanece a leitura anterior da sessão salva. Não se altera vinculação, logout, credenciais, permissões ou recebimento de votos.

Teste de regressão executa a função real de heartbeat com cinco combinações de conexão/sessão. **168 testes do bot aprovados**, e a interface real foi conferida após o reinício: **v0.2.24, Conectado, Sessão Ativa**. A captura e a evidência técnica dos testes foram guardadas fora do repositório, sem publicar contatos/credenciais no GitHub.

## Verificações e limites

- Build local aprovado; validação-base anterior: 176 testes raiz, 66 navegador, 38 SQL locais, PostgreSQL 17, restauração e concorrência aprovados na fase 2.
- A CI desta fase deve repetir as verificações para o novo commit, incluindo os 168 testes do bot e o teste novo de heartbeat. Registrar o resultado depois do push.
- Advisor de segurança: quatro avisos informativos de RLS sem políticas nas tabelas internas de backup/outbox, cujo acesso é reservado ao serviço; um aviso preexistente de proteção contra senhas vazadas desativada no Auth. Nenhuma permissão pública foi acrescentada para contornar esses avisos.
- Na primeira reconexão houve uma mensagem local de decriptação de sessão/histórico e votos de enquetes desconhecidas, descartados pelo fluxo existente. Não houve queda observada; fila local de votos ficou em zero pendentes/zero em revisão. Esse histórico não foi usado como prova de falha do Supabase.
- Não houve consulta ao stream de logs remoto nem teste de carga no projeto. Houve consultas pontuais de instalação/estado, os dois testes reais e o backup diário normal da inicialização. Último consumo informado pelo usuário: **0,963 GB**, sem medição nova; não garantir saldo nem consumo futuro abaixo de 1 GB.

As três fases planejadas foram executadas. Não criar uma fase adicional automaticamente; manter a versão conectada e relatar qualquer limitação real da CI/deploy ou da janela de observação.
