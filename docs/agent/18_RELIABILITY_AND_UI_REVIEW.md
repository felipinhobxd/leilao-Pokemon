# 18 — Confiabilidade, segurança e UI/UX — 0.2.10

> Complemento vigente de retenção e backup: [19_SETTLEMENT_PROTECTION_AND_RECOVERY.md](19_SETTLEMENT_PROTECTION_AND_RECOVERY.md). A proteção financeira foi autorizada posteriormente.

Atualização autorizada em 2026-10-25 após revisão completa. Este é o resumo vigente; documentos anteriores conservam o histórico e as decisões do operador.

## Estado atual

- Painel Next.js **16.4.3**, bot **0.2.10**, main do repositório `felipinhobxd/leilao-Pokemon`; arquivos locais em `D:\LeilaoPokemon`.
- **68 migrations locais / 76 registros remotos**. Nova `20261025181640_dashboard_auction_detail.sql`, instalada pelo conector no projeto `gsyuoggymjdzxibfujyv`. O arquivo foi criado pela CLI e renomeado para a versão efetivamente registrada pelo conector, sem mudar migrations antigas. Catálogo confirmou live_ready/recovery_ready/private/invoker=true.
- `read_dashboard_auction(uuid)`: disputa selecionada ou aberta mais recente; líder/contagem sobre todos os lances ativos de participantes elegíveis, desempate por coalesce(whatsapp_event_at,processed_at), processed_at, confirmation_order e id. Retorno limitado aos 100 maiores, com contagem completa. Compra recente tem estado de pagamento calculado por existência na tabela inteira, sem depender dos 1.000 pagamentos do snapshot antigo. Até 500 compras, com nomes/contatos necessários à administração; limites explícitos na UI.
- `recover_auction_creation(text,uuid)`: aguarda o advisory lock da operação e recupera somente criação do próprio operador; retorna identificadores mínimos, sem payload privado. Ambas invoker/search_path vazio e EXECUTE somente service_role.

## Recuperação e fotos

Criação em lote e única preserva eventId, horário e payload após resposta incerta; antes de reenviar consulta a recuperação. O payload pendente também fica em sessionStorage, com versão e chave por tipo/usuário, permitindo recarregar a aba. Não guarda JWT ou chaves de API. Com armazenamento do navegador bloqueado, mantém a tentativa em memória enquanto a aba existir. Durante confirmação incerta, edições ficam bloqueadas e há botão explícito para confirmar o envio anterior. Sucesso limpa a pendência; Novo leilão inicia outra identidade.

Uploads de detalhes removem arquivos por identidade, sem índices que mudam entre callbacks. União ordenada/deduplicada preserva URLs antigas e novas, com limite quatro. Miniaturas de detalhes já salvos também podem ser removidas do rascunho sem excluir o objeto do Storage. Salvamento monta o estado mais recente depois dos uploads, preservando edições feitas enquanto o autosave prepara as fotos.

Autosave mostra pendência/salvando/salvo/falha; interrompe novas tentativas após falha automática até tentativa manual. Intervalo de 45s com aba visível. Saída com alterações pendentes tem proteção beforeunload, sem prometer bloquear toda navegação interna do framework. A primeira execução manual pode confirmar rascunho incompleto quando há fotos com falha; o aviso mantém esse limite explícito.

## Interface

- Operação e Novo leilão aparecem antes do diagnóstico, que fica recolhido. Temas escuro/claro/sistema preservados.
- Leilão / Brinde / Quiz são seleção exclusiva e explícita. Não há conversão de enquetes legadas publicadas.
- Rótulos de opções/correta e pagamento têm nome acessível explícito, sem incorporar valores dos controles. Busca por nome/número, filtro por tipo/pendências, janela de 12 itens, atalho de posição e recolher cartas. Filtrar/paginar nunca muda o índice ou a ordem de publicação. Erro abre a carta, limpa filtros e foca o campo, com aria-invalid/descrição.
- Etapa Valores oculta ações monetárias em fila só de jogos e oferece revisão recolhível. Revisão final distingue quantidades por tipo, lotes reais, última publicação prevista e prévia da enquete, com a correta marcada somente no painel.
- Compras: busca por carta/pessoa/contato, filtros de pagamento, totais pendentes por participante no conjunto carregado e status traduzido. Cards/participantes/compras têm apresentação empilhada em telas estreitas.
- Cronômetro isolado em componente próprio, sem renderizar todas as tabelas a cada segundo.
- Central WhatsApp mantém recuperação para worker online/WhatsApp desconectado e exibe a confirmação do comando. Datas dessa tela em Brasília.

## Consultas, bot e diagnóstico

Fila usa leituras sem sobreposição a cada 15s somente com aba visível; para após completed/cancelled e reconcilia ao voltar à aba. Não há timer de logs, novo canal Realtime ou consulta automática de diagnóstico. A leitura da disputa ocorre dentro da atualização existente do painel, com dados limitados; não é garantia de economia exata de ingestão.

Ciclo do bot compartilha uma Promise que engloba abertura e tarefas do tick; o próximo tick espera o anterior. Impede que uma abertura lenta seja ultrapassada por outra chamada ao scheduler. Teste usa barreira assíncrona, sem aguardar cinco segundos reais nem enviar mensagens. Reabrir bot/supervisor para carregar 0.2.10; não foi reiniciado durante a implementação.

Doctor aceita SUPABASE_SECRET_KEY e fallback legado, usa apikey para chaves sb_secret (não JWT), testa purchase_id em payment_reminders, rejeita HTTP não-2xx e catálogo inválido. Diagnóstico não certifica versões de migrations; não recomenda reaplicar listas antigas. Não executar doctor em loops.

## Dependências e segurança

Next.js 16.4.3; lockfiles atualizados para corrigir alertas de sharp, brace-expansion, source-map-js e music-metadata. Override restrito a UUID do ExcelJS em 11.1.1, evitando downgrade do ExcelJS. Teste de Excel real cobre escrita/leitura e formatação que usa UUID. Auditorias npm do painel e bot retornaram zero alertas nesta rodada; não certificam ausência de vulnerabilidades futuras.

Advisors de segurança do Supabase: RLS sem policy é intencional nas tabelas privadas de snapshots/outbox; operações passam pelo servidor. Aviso de proteção de senhas vazadas desativada permanece registrado como configuração do provedor, não alterada nesta rodada. Nenhuma chave, sessão ou QR foi enviado ao Git. Não ampliamos permissões do navegador.

## Verificação

- Validação local: **118 testes raiz, 70 do bot, 24 cenários SQL**, typecheck, build e smoke de autenticação aprovados. Resultado dos testes de navegador e da CI deve ser consultado após push.
- Banco descartável: schema, bridge e todas as migrations; cenário dashboard-auction reproduz mais de 500 registros alheios e confirma que o lance ativo de R$ 100 permanece; testa suspensão e grants/recuperação.
- backup-restore.sql exporta e restaura registros operacionais em tabelas temporárias, validando Unicode, valores e referências entre participante/carta/leilão/compra. Não é certificação de recuperação integral de Auth/Storage/WhatsApp.
- CI com Chromium desktop/celular: tipo e correta, retry com mesmo ID/horário, perda de resposta após commit + reload, detalhes após salvar/reabrir, paginação/foco do erro, compras/acessibilidade e reconexão. Backend/autenticação são fixtures; APIs/RPCs têm testes separados. Nenhuma mensagem real nestes testes.
- Nova migration foi validada em banco descartável antes de instalar. Produção usou leitura de histórico, advisors de segurança, instalação e uma consulta curta de catálogo; sem backups grandes, limpeza, dados de teste ou mensagens.

## Decisões preservadas e limites

Limite de 200 itens e exclusão manual dos encerrados com duas frases permanecem, incluindo pendências conforme escolha expressa do operador. Também não foram mudadas retenção automática de 12h, prune de sete dias ou política de lembretes: são regras de negócio documentadas, não correções visuais. P-18/P-19 continuam como limitações: retenção pode remover pós-venda pendente; arquivo do dia não prova cobertura de toda exclusão posterior. Backup/export continua com limites de drafts/quick polls e sem bytes de imagens/sessão; um ensaio parcial de restauração não muda isso.

Log Ingestion: respeitar o objetivo de 1GB, sem prometer cota garantida. Último valor observado antes da revisão era 0,88/1GB, arredondado/atrasado. Não houve nova leitura da quota nem medição de delta; processos já ativos continuam gerando tráfego. Sem desativar auditoria para economizar.
