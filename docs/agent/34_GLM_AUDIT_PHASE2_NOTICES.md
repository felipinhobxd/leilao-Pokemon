# 34 — Auditoria GLM, fase 2: avisos e ausência de permissão de @all

Autorizada em 27/10/2026 após a fase 1. O operador escolheu explicitamente: **enviar a conclusão sem @all e avisar os administradores** quando o bot puder enviar no grupo, mas não for administrador para usar a menção coletiva. Esta fase trata C-2; não decide regras de brinde, retirada ou conclusão de fila parcialmente falha.

## Comportamento

- Grupo com mais de 32 participantes, bot identificado entre os membros e sem privilégio de administrador: registra uma notificação administrativa `NOTICE_MENTION_DENIED`, persiste `payload.mention_denied` no aviso e envia a mensagem de conclusão com o horário escolhido, sem marcador textual `@all` e com `mentionAll:false`.
- Grupo pequeno ou bot com permissão: mantém o envio coletivo atual. Consulta indisponível, lista incompleta ou participação do bot não confirmada não são tratados como negação certa; nesses casos mantém o aviso pendente, sem enviar um fallback presumido.
- O WhatsApp continua sendo a autoridade sobre a possibilidade de enviar no grupo. Se o grupo restringir mensagens aos administradores ou o envio falhar, não se marca a entrega como concluída. A tentativa permanece pendente com o backoff existente (30s por tentativa, teto de 5min no banco).
- O modo sem @all fica persistido antes do envio. Uma nova tentativa após resposta perdida/reinício mantém esse modo e o mesmo ID determinístico da mensagem, mesmo que o bot depois se torne administrador. Não republica cartas e não modifica o prazo dos lances.
- Na décima tentativa ou posterior, se a entrega continuar sem confirmação, cria uma notificação `NOTICE_DELIVERY_DELAYED` e persiste `payload.delivery_alerted`. Aplica-se a conclusão da fila, resultados individuais e prêmios de quiz/brinde. Sem descarte automático ou marcação falsa de sucesso.
- Cada tipo de alerta tem `external_event_id` derivado do aviso, com `ON CONFLICT DO NOTHING`. Repetição não apaga `sent_at` nem `payload.sent_to` da DM já entregue. Após a flag persistida, não faz nova escrita/consulta de alerta por tentativa. Se a gravação falhar, tenta novamente depois; não finge que o administrador foi avisado.
- Texto das DMs distingue falha de @all de entrega pendente e traz grupo, ID do aviso e prazo em Brasília, quando disponível. Não é apresentado como advertência de participante nem altera o contador de três avisos. A DM de fallback pede confirmação da entrega no grupo, pois seu enfileiramento ocorre antes do envio.

## Dados, permissões e quota

Sem migration: usa `admin_notifications` e o JSON `payload` já existentes. Notificações continuam privadas, acessíveis ao bot por `service_role`, sem alteração de grants/RLS ou novas rotas. Flag da decisão usa compare-and-set por `id`, `locked_by` e `sent_at IS NULL`, com verificação de linha retornada.

Não há novo polling nem chamada extra no caminho normal de entrega/ociosidade. O fallback adiciona uma inserção idempotente e uma atualização apenas quando necessário. A primeira escalada de falha persistente usa as mesmas duas operações; após persistida não as repete. Logs reutilizam o limitador atual. Tentativas de entrega continuam existindo enquanto necessárias, com a cadência já instalada; não se promete consumo zero nem garantia de ficar abaixo de 1GB. Nenhuma chamada ao Supabase de produção foi feita nesta fase, e a quota não foi medida.

Sem transação distribuída com WhatsApp: IDs estáveis e registros reduzem reenvios, mas resposta perdida ainda pode causar duplicação de mensagem conforme o comportamento do provedor. As DMs administrativas continuam best-effort; não são marcadas como enviadas antes do envio. Uma falha de persistência entre alerta e flag pode repetir o upsert, mas sua chave impede uma segunda linha ou o reset do recibo da primeira.

## Verificação

- `npm --prefix bot run check`: **138 aprovados**, sintaxe e patches verificados.
- `npm test`: **171 aprovados**.
- `npm run typecheck`: aprovado.
- Oito novos testes cobrem fallback confirmado, metadata/participação desconhecida, resposta de envio/finish perdida com reconstrução do dreno, erros ao gravar alerta/decisão, claim perdido, escalada persistida, falha da escalada e caminho normal sem escritas extras. Incluem formatação das duas DMs; testes anteriores mantêm intervalo de 15s entre resultados, menção nativa e anúncio do prêmio.
- `tests/operation-health.sql` ampliado para confirmar no banco descartável que os novos tipos são aceitos, a chave única preserva a DM entregue e o finish retém flags do payload. A execução PostgreSQL completa ocorre na CI, junto de restauração, concorrência, navegador e build. Conferir o resultado remoto do commit desta fase antes de declarar aprovação remota.

## Entrega e próxima fase

Bot **0.2.17 no disco**, sem ativação, reinício ou mensagens reais nesta fase. Não se aplicou migration, não se limpou produção, não se gerou backup real e não se baixaram imagens. O push atualiza o código no GitHub e o site pelo fluxo existente, mas não ativa automaticamente o bot local.

Restam decisões de negócio da auditoria: elegibilidade de brindes, texto/janela de um minuto para retirada e aviso de conclusão de fila parcialmente falha. A resolução assistida de identidades e a redução do piso de polling são trabalhos separados. **Parar após CI/deploy e perguntar antes de iniciar a fase 3; não presumir essas decisões.**

CI da fase 2 confirmada no commit `76a8d0e8`: [CI](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40504084172), banco/restore/concorrência/build e 60 testes de navegador aprovados; deploy Vercel aprovado.
