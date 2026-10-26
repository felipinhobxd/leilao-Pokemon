# 25 — Limpeza automática de todos os resultados após 12h do envio

Autorização explícita do operador em 26/10/2026: incluir lances, vendidos, arremates e seus dados financeiros na limpeza automática. **Substitui a preservação financeira automática dos documentos 19, 22, 23 e 24.** Não é pedido de exclusão manual imediata nem de mudança no botão manual dos encerrados.

## Regra efetiva

- Retenção padrão de 12 horas contadas do envio: `dispatch.poll_sent_at`, `dispatch.sent_at`, `auction.started_at`, `dispatch.announcement_sent_at`, nesta ordem. Sem registro de envio em dados legados terminais, usa encerramento/criação como fallback explícito.
- Inclui `closed`, `sold`, `cancelled`, com ou sem lances, compra, pagamento pendente/parcial/pago/estornado, entrega ou arremate. Remove a árvore vinculada: compras, pagamentos, entregas, lembretes, lances, votos, dispatch, avisos enviados, eventos e histórico de valores; remove cartas que se tornarem órfãs e sem outras referências.
- Inclui rascunho **parcialmente enviado** cujo dispatch terminou em falha/cancelamento e anúncio foi registrado. Assim o antigo Delphox não fica eternamente fora da manutenção só por estar em draft.
- Preserva leilões **abertos ou em revisão**, rascunhos sem envio e avisos de resultado ainda pendentes. Filas com dispatches/jogos sobreviventes ou avisos pendentes continuam protegidas. Não publica nem reenvia automaticamente o lote com falha.
- O ciclo do supervisor continua no máximo horário. 12h é o limiar de elegibilidade, não promessa de exclusão naquele segundo: aguarda ciclo, resultado pendente, ausência de contenção e backup com cobertura.

## Backup e concorrência

Cada linha afetada precisa estar idêntica ao snapshot confirmado da nuvem. Além das tabelas já verificadas, agora inclui fingerprints de `purchases`, `payments`, `deliveries` e `payment_reminders`. Mudança posterior de pagamento/lembrete ou manifesto antigo sem essas linhas bloqueia a operação **inteira**, sem exclusão parcial. Mantidos SHA-256, objeto/versão, validade 48h, snapshot MVCC único e preparo com memória/blocos limitados dos documentos 22/24.

A verificação diária `has_confirmed_business_backup` exige as quatro coleções adicionais. Uma cópia anterior continua sendo arquivo de recuperação válido, mas não certifica a limpeza financeira nova. O próximo preparo automático produzirá o manifesto ampliado. Na instalação, `upgraded_backup_ready=false`, esperado. Não geramos backup pesado extra apenas para acelerar a limpeza. Cache diário de um supervisor que já marcou o dia como protegido pode adiar essa atualização até a próxima verificação/preparo normal; isso mantém dados em vez de ignorar cobertura. O supervisor atual não foi reiniciado.

Locks NOWAIT nas tabelas envolvidas, incluindo lembretes, congelam as escritas entre comparação e exclusão. `lock_timeout=500ms` também adia a manutenção se houver espera por outro lock durante a transação. Falha/contencão devolve zero exclusões; rollback conserva dados e trigger append-only. Nenhuma rede dentro dos locks.

## Instalação e escopo

Migration CLI **20261026041119_cleanup_all_sales_twelve_hours_after_publication.sql**, renomeada para a versão efetivamente registrada pelo conector, instalada no projeto `gsyuoggymjdzxibfujyv`. **74 arquivos locais / 82 registros remotos**, sem reparação de história antiga. Catálogo confirmou regra por publicação, lembretes, manifesto financeiro e grants privados. Advisors sem alteração: quatro INFO intencionais de tabelas privadas com RLS sem policy e WARN preexistente de senha vazada ([RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

Somente funções SQL e textos explicativos do painel. **Nenhum arquivo em bot/ alterado, nenhuma limpeza de produção chamada manualmente, nenhum reenvio, reinício ou backup real extra nesta etapa.** O supervisor já ativo passa a chamar a regra instalada no próximo ciclo normal. Não altera participantes/grupos nem apaga bytes de imagens no Storage.

O botão manual **Excluir leilões encerrados** continua com duas frases e preservação de compras, regra anterior desse botão; o painel agora distingue o botão da limpeza automática. Exclusão individual/Excluir TUDO permanecem ações explícitas existentes. Não ampliar esses contratos com base nesta autorização da automação.

## Verificação

- 140 testes raiz, typecheck e build locais aprovados.
- **30 cenários SQL descartáveis**, com política de envio anterior ao encerramento, envio recente prevalecendo sobre started_at antigo, arremate com lance/pagamento/reminder, todos os estados de pagamento, anúncio parcial com falha, rascunho agendado sem envio e preservação de aberto/revisão.
- Pagamento ou lembrete alterado após o snapshot e recibo legado sem hashes financeiros bloqueiam toda a limpeza. Retenção, restauração, Unicode e snapshot fictício de 42 mil eventos continuam aprovados. `settlement-protection.sql` foi atualizado para a política autorizada; testes do botão manual mantêm preservação financeira.
- Prévia local com axe sem violações detectadas; testes de navegador existentes continuam na CI. Conferir CI/deploy do commit final antes de declarar aprovação remota.

Meta de Log Ingestion: 1GB. Só consultas pontuais de catálogo/docs/advisors e instalação nesta etapa; nenhuma medição nova da quota e nenhuma garantia sobre consumo do bot em execução.
