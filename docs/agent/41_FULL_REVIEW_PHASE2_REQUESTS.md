# Revisão completa — fase 2: economia de consultas (28/10/2026)

## Estado

Autorização: “inicie a fase 2”. Bot **0.2.23 em disco**. Migrations **20261028190535** (fase 1) e **20261028192328** (fase 2) preparadas e ainda não aplicadas ao projeto Supabase nesta sequência. Nenhum supervisor/filho iniciado ou reiniciado; nenhuma consulta ao projeto de produção ou mensagem ao WhatsApp nesta fase.

O site pode receber a remoção da interface duplicada antes da migration. A leitura agregada só é habilitada no servidor com **`DASHBOARD_OPERATIONS_RPC_ENABLED=1`**, depois de instalar a migration. Ausência da variável ou `0` preserva as consultas anteriores e não gera sondagens repetidas de uma RPC inexistente. Nenhum `.env` real ou configuração remota foi alterado nesta fase.

## Mudanças e economia

| Trecho | Antes | Depois |
|---|---|---|
| Central WhatsApp | Layout e página consultavam status/grupos separadamente | Página é a única proprietária dessas consultas e do seletor de grupo |
| Resumo operacional do painel | Worker + grupo + cinco contagens: sete consultas | Uma RPC, quando habilitada após migration |
| Log local do maior lance | Uma leitura de lances e até 20 leituras individuais de participantes | Uma leitura com participantes relacionados |
| Bot com trabalho somente futuro/pausado | Quatro workers consultavam o banco mesmo sem tarefa executável | Descoberta considera a janela de abertura e os horários/estados executáveis |

Na Central visível por uma hora, a remoção do componente duplicado elimina nominalmente **480 requisições ao site e 960 leituras de dados Supabase**, além de possíveis chamadas de validação Auth em projetos com assinatura legada. O status continua sendo reconciliado a cada 5s; grupos e histórico, a cada 30s. Aba oculta não consulta; foco reconcilia novamente. Não foram adicionados canais Realtime ou cache de dados entre usuários.

No resumo operacional habilitado, sete consultas viram uma. Incluindo a leitura existente do perfil administrativo, o endpoint operacional passa de oito leituras para duas; a resposta completa passa de dez para quatro. A contagem continua na janela inclusiva das últimas 24h, nos mesmos estados, com o worker mais recente e grupo padrão ativo. Perfil e autenticação continuam sendo validados a cada requisição. A RPC retorna somente os campos necessários; erro ou resposta incompleta não vira um resumo aparentemente vazio. Desabilitada a variável, o comportamento anterior permanece.

O log do maior lance conserva os quatro critérios de ordenação, o limite de 20 candidatos e as mesmas verificações de participante ativo/suspensão. Apenas o carregamento dos dados muda; ele não decide o resultado financeiro.

Na simulação de uma hora **apenas com filas/quiz futuros ou pausados**, descoberta + quatro workers vazios caem de **2.940 para 720 chamadas**. Isso exclui heartbeat, comandos do supervisor, avisos e lembretes. Uma operação totalmente vazia já usava uma descoberta a cada 5s e não ganha uma nova redução nesse trecho. Não converter esses números diretamente em GB de Log Ingestion.

## Preservação do comportamento do bot

`bot_has_due_work` é uma RPC somente para `service_role`, com `SECURITY INVOKER` e `search_path=''`. Usa os horários do banco e os mesmos critérios executáveis das rotinas existentes:

- Abertura de fila scheduled/running dentro da antecedência e tolerância configuradas. Parâmetros correspondem aos usados pela abertura real. Configuração não numérica de antecedência/tolerância agora usa os padrões 5/15 minutos.
- Dispatch scheduled devido com tentativas disponíveis e fila permitida, ou qualquer dispatch sending, inclusive um claim que precise recuperação.
- Leilão aberto cujo prazo já chegou.
- Quiz/brinde não enviado, devido e fora de fila pausada, incluindo os avulsos.

O resultado ocioso **não é guardado em cache**: criação remota, retomada e mudança de prazo são percebidas na próxima consulta normal de 5s. O cache de 60s continua restrito a resultados ativos/incertos, conservando o fluxo original nessa janela. Timeout, RPC ausente ou resultado inválido mantêm os workers ativos; não suprimem trabalho.

Votos continuam recebidos por evento e gravados no journal. O ciclo segue drenando votos antes de finalizar leilões; avisos de resultado/arremate e notificações administrativas continuam independentes da descoberta. Abertura permanece antes da publicação. Intervalos de heartbeat, controle do supervisor e resultados de 15s continuam iguais. Não houve alteração nas regras financeiras, de retirada, quiz/brinde ou limpeza.

## Validação

- **176 testes raiz**, **167 testes do bot**, typecheck e **66 testes de navegador** locais aprovados.
- **38 suítes SQL locais** em PGlite descartável; nenhuma nova exposição de tabelas ou função SECURITY DEFINER pública.
- Nova suíte SQL cobre janela customizada, tolerância de abertura atrasada, fila futura/pausada/retomada, envio em andamento e stale, prazo futuro/devido, quiz futuro/pausado/avulso e permissões.
- A contagem agregada foi comparada aos cinco estados, incluindo a fronteira exata de 24h e um registro um milissegundo mais antigo; worker recente, grupo inativo e resultado vazio também são verificados.
- A fixture de navegador agora monta o **layout real de WhatsApp**. Verifica um seletor de grupo, ausência do polling duplicado, consultas de 5s/30s, pausa em aba oculta, atualização no foco e salvamento/reconciliação do grupo escolhido, em desktop e celular.
- Testes exercitam os dois modos do resumo: variável desligada não sonda uma RPC inexistente; ligada faz uma leitura e não cai silenciosamente para sete consultas após erro.
- Testes do log verificam uma única consulta, ordenação, limite, candidatos inelegíveis e falhas sem vencedor inventado.
- CI inclui explicitamente `tests/request-economy.sql` em PostgreSQL 17 e as verificações anteriores de restauração, concorrência, build e autenticação. Resultado remoto deve ser registrado após o push.

## Próxima fase: ativação controlada

**Parar ao concluir esta fase e solicitar autorização para a fase 3.** A instalação precisa ser coordenada: parar supervisor e filho antigos; conferir o histórico remoto; aplicar somente as duas migrations pendentes na ordem; iniciar o bot 0.2.23; conferir conexão e avisos com poucas consultas. O trigger de arremate da fase 1 não deve coexistir com o bot antigo que ainda faz envio direto. A migration da fase 2 exige a revisão de banco da fase 1, e o novo bot exige revisão 2 antes de conectar.

Depois da migration, habilitar `DASHBOARD_OPERATIONS_RPC_ENABLED=1` no ambiente servidor local/deploy que deve usar a agregação e recarregar esse servidor. Não colocar a variável em `NEXT_PUBLIC_*`. Se houver problema no resumo, voltar a `0` reativa as leituras anteriores sem alterar dados. Não fazer `db push` indiscriminado ou reparar divergências históricas automaticamente.

O deploy do site não reinicia o bot Windows, e salvar código não ativa migrations. Último uso informado pelo usuário: **0,963 GB**, sem medição nova. Nenhuma garantia de permanecer abaixo de 1 GB: processos já ativos continuam gerando seus próprios registros. A economia descrita é de requisições em cenários isolados, não de bytes medidos em produção.
