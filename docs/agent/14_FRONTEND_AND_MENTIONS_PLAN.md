# 14_FRONTEND_AND_MENTIONS_PLAN — Fotos em lote e @all

> Estado atual consolidado: [18_RELIABILITY_AND_UI_REVIEW.md](18_RELIABILITY_AND_UI_REVIEW.md), bot 0.2.10, Next.js 16.4.3. Seções de versões anteriores abaixo são histórico; não reaplicar migrations ou instruções antigas automaticamente.


> Última atualização: 2026-10-25
> Estado: **P-25 e P-26 implementados e validados localmente**.
> Escopo: os dois problemas relatados pelo operador; sem alterações de banco ou consultas ao Supabase.

## P-25 — Importação de fotos sem decodificação em massa

### Problema anterior

O cadastro inseria URLs das fotos originais no DOM, iniciava todas as prévias por Promise.all e só substituía as imagens ao terminar todo o lote. A redução para 560 px não limitava o pico inicial. O limite do upload posterior não protegia essa etapa.

### Implementação

- Novo módulo `lib/card-preview.ts`: fila de **duas tarefas simultâneas**, compartilhada entre seleções sucessivas, com pausa no event loop antes de cada decodificação.
- `bulk-wizard.tsx` cria placeholders e IDs estáveis; só coloca na tela a prévia reduzida, à medida que fica pronta. Os originais File permanecem disponíveis para o upload habitual.
- Progresso visível, edição das cartas durante o preparo e limite de 200 itens totais verificado antes da importação. Seleção acima do espaço restante é recusada com mensagem, sem truncamento silencioso; adicionar carta sem foto respeita o mesmo limite.
- Salvamento manual/auto-save e publicação aguardam a conclusão da fila. Uma trava síncrona impede seleção adicional durante upload/salvamento.
- Remover carta cancela o trabalho pendente; resultado em voo para carta removida é descartado. Unmount descarta a fila e revoga URLs. O gerador fecha ImageBitmap e libera canvas em finally, inclusive em erros.
- Falha de prévia é indicada na carta e não transforma o original grande em fallback visual. O original é preservado para o fluxo normal de upload/validação.
- A fila processa prévias, não publicações; não escreve no banco e não altera preços, ordem ou dados de leilão.

### Validação

`tests/card-preview.test.mjs` cobre 200 itens em duas seleções, limite global de dois workers, entrega progressiva, preservação dos Files, cancelamento pendente/em voo, resultado sem dono, unmount, recuperação após erro, nova seleção e liberação de bitmap/canvas nos caminhos de sucesso/falha.

Teste adicional em navegador local isolado: a mesma fila/gerador recebeu duas seleções de 100 fotos JPEG sintéticas de **4000×3000 (12 MP)**, sem bot, login ou Supabase. Resultado observado:

| Métrica | Resultado |
|---|---|
| Prévias concluídas/exibidas | 200 / 200 |
| Concorrência máxima | 2 |
| Primeira prévia | 190 ms |
| Tempo total | 15.522 ms |
| Frames de animação durante o trabalho | 657 |
| Maior intervalo entre frames | 155 ms |
| Console de erros | vazio |

Foi possível digitar no campo durante a preparação (observado com 5/200 concluídas). Esses valores são de uma execução local, não metas universais. O harness verifica a fila/gerador com decodificação real e renderização de imagens; não é teste completo do wizard autenticado, nem benchmark dos arquivos reais do operador no Brave. Não foi necessário adicionar virtualização ou Web Worker.

## P-26 — @all nativo

### Problema anterior

O builder produzia texto @all e uma lista de JIDs individuais, sem `mentionAll`. O envio reconstruía apenas text/mentions. A versão instalada do Baileys já suporta o marcador nativo, e adicionar o campo apenas ao builder não bastaria enquanto o envio o descartasse.

### Implementação — bot 0.2.6

- `buildOpeningMessage` produz `mentionAll: true`, sem lista oculta de menções individuais.
- `sendOpeningMention`, usado pelo caminho real de abertura em `bot/index.mjs`, encaminha o objeto completo ao sendMessage.
- Uma consulta de metadata por abertura verifica a permissão: grupos de até 32 membros permitem @all; acima disso a conta conectada deve ser admin/superadmin ou proprietária. Identificação considera ID, LID, telefone e sufixo de dispositivo normalizado; tamanho informado do grupo evita tratar metadata parcial como grupo pequeno.
- Sem permissão ou metadata confiável, envia **aviso simples sem @all** e registra aviso local com motivo. Não concede permissão nem anuncia sucesso coletivo falso. Erro do envio continua sendo erro do ciclo; sucesso do fallback é identificado como aviso simples, para não repetir regras/figurinha indefinidamente.
- A publicação de regras/figurinha e o estado de filas antigas foram preservados. Não há replay de aberturas antigas nem upgrade de dependências.

### Validação

`bot/announce-sticker.test.mjs` agora testa o envio real via socket simulado e o serializador instalado do Baileys: a mensagem enviada gera **contextInfo.nonJidMentions=1** e nenhuma lista individual. Cobre grupo pequeno, admin/superadmin, PN/LID, proprietário, falta de permissão, falha de metadata, fallback e erro de envio.

O check do bot passou a incluir a sintaxe e os testes de abertura; estado de testes continua redirecionado para diretório temporário. Bot atualizado para **0.2.6** no package.json e lockfile.

Não foram enviados testes a grupos reais nem verificadas as permissões atuais da conta em cada grupo. O processo já aberto precisa reiniciar para carregar código novo; ele não foi interrompido automaticamente nesta tarefa para não afetar leilões em andamento.

Segundo o [WhatsApp](https://blog.whatsapp.com/your-group-chats-upgraded-introducing-better-polls-all-and-more), grupos com mais de 32 membros exigem admin para @all e os destinatários podem silenciar menções coletivas. Portanto, payload correto não garante alerta sonoro em todos os aparelhos.

## Validação geral e limites

- Typecheck aprovado.
- **83 testes da raiz**, **56 testes completos do bot** e **41 testes no check do bot**, aprovados.
- Build de produção aprovado; smoke HTTP de rejeição sem login executado após o build (resultado registrado no handoff).
- Nenhuma migration, consulta ao Supabase, alteração de cota/logging, reinício de bot ou mensagem para contatos/grupos nesta implementação. O serviço de teste de imagens ficou limitado a localhost.
- Demais itens P-18 a P-24 não fazem parte desta correção e continuam no backlog.
