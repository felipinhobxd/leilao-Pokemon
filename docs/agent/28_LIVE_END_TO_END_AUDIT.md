# 28 — Revisão e validação real de ponta a ponta

Revisão de 26/10/2026 (Brasília), autorizada pelo operador, incluindo iniciar `npm run start`, publicar no grupo **teste leilão** e receber votos reais do celular. Substitui as observações dos documentos anteriores sobre aguardar ativação: supervisor e filho **0.2.14** foram carregados e confirmados conectados. Painel local em http://localhost:3000. Nenhum teste foi publicado em outro grupo.

## Falha encontrada e corrigida

Uma retirada recebida após o prazo retornava `deadline_expired`, mas o tratamento reconhecia apenas `auction_not_open`. O evento persistente ficava em retentativa e retinha a finalização daquela enquete. A recusa também podia apagar indevidamente o estado local do lance aceito. Uma tentativa de retirar arremate tinha o mesmo problema de estado.

O bot agora registra a recusa antes de confirmar o processamento e preserva o lance aceito. Na retirada recusada, consulta o prazo e libera o evento comprovadamente posterior ao corte, inclusive após retentativa. Evento possivelmente tempestivo e incerto continua bloqueado para revisão. Falhas na leitura do prazo ou gravação da auditoria continuam pendentes; o prazo não é ampliado e lances vencidos não são aceitos. Logs distinguem arremate recusado de disputa já encerrada.

Seis testes adicionais cobrem esses caminhos. Após reiniciar somente a árvore de processos iniciada nesta revisão, os eventos reais pendentes foram processados sem editar o journal manualmente. Telemetria confirmou **pending=0/review=0** e a apuração terminou.

## Evidência real

| Fluxo | Resultado observado |
|---|---|
| Cadastro pelo painel autenticado | Lote com foto, lote sem foto, quiz e brinde; fila concluída 4/4 |
| Publicação | Intervalo configurado de 15s; regras/abertura e anúncio após última carta enviados; caminho de menção nativa confirmado nos registros do bot |
| Lance e alteração | Valores iniciais, aumentos e reduções persistidos; aviso por redução registrado |
| Prazo comum | Lotes 1 e 2 vendidos por R$ 1 cada, uma compra por lote; avisos individuais entregues |
| Arremate vencido | Recusado corretamente; não alterou a venda |
| Arremate com prazo aberto | Lote 3 vendido imediatamente por R$ 3, uma compra |
| Quiz e brinde | Resposta correta definida; primeiro acerto registrado e mensagem de vencedor entregue |
| Fila pausada | Dois brindes pausados permaneceram sem envio enquanto a outra fila avançou; somente essa fila de preparação foi cancelada ao concluir |

Os três lotes usam nomes TESTE AUDITORIA e indicação de ausência de venda/prêmio real. Os valores são registros de teste, sem cobrança. Histórico concluído preservado para inspeção e sujeito à política normal de limpeza de 12h com backup confirmado. A fila pausada cancelada não será retomada para publicar resíduos de teste.

### Backup e Excel

Um backup manual foi solicitado pelo painel. A interface confirmou o download; o objeto privado resultante foi baixado e validado como Gzip/JSON: **4.138.100 bytes comprimidos, 35.218.865 bytes JSON, 22 tabelas**, incluindo os três leilões e compras. SHA256: `34e12636d24d7a3422f598bfcdfed0b7e682e967d00c0db592ba029b6327daf8`. Cópia de conferência mantida em `bot/backups/`, ignorada pelo Git, com dados pessoais: não publicar.

Excel exportado pelo painel e lido sem alteração: **15 abas**, três vendas de teste (total R$ 5), três resumos de participante/lote, quatro trocas de valor, primeiro/último lance e horários de alteração como datas tipadas, fórmula de total `SUM(G2:G4)`. Confirmadas, entre outras, as trocas 1→2 no lote 1 e 3→1 no lote 2. A aba de auditoria tem o limite intencional de 5.000 eventos, informado no resumo; não representa todo o histórico remoto.

### Interface e imagens

Componentes reais do cadastro exercitados em servidor de fixtures isolado, sem publicar 200 itens em produção: seleção de **200 imagens PNG 3000×4000**, aproximadamente 483 MB de arquivos, preparação das miniaturas, edição e paginação de 12 itens/17 páginas sem congelamento observado. Prévias carregadas limitadas a 420×560. Verificação axe dessa tela sem violações WCAG 2 A/AA e 2.1 AA; console sem erros nas telas verificadas.

O navegador utilizado foi o navegador interno do Codex. Essa evidência não certifica o Brave, todos os formatos, aparelhos ou estados possíveis da interface. Capturas locais em `outputs/live-queue-20261026.png` e `outputs/200-large-images-ui.png` na pasta de trabalho da revisão, fora do repositório.

## Verificações técnicas

- 169 testes da raiz e 118 testes do bot aprovados; check sintático/funcional do bot e typecheck aprovados.
- 31 cenários SQL em PGlite isolado aprovados, com migrations locais e casos de 100/101/200/201 itens, backup e finalização protegida.
- Auditoria npm de dependências de produção: zero vulnerabilidades reportadas na raiz e no bot nesta execução.
- Diagnóstico operacional: cinco verificações aprovadas, nenhuma advertência/falha; bot conectado, backup recente e RPCs privadas disponíveis.
- Nenhuma migration alterada/aplicada nesta rodada. 75 arquivos locais e 83 registros remotos; timestamps históricos não coincidem integralmente. Isso não autoriza `db push`/`migration repair`; consultar documento 13. Fluxos reais confirmam as funções usadas, sem afirmar equivalência integral de toda a história.
- Advisor de segurança: quatro avisos INFO de RLS sem política nas tabelas privadas de backup/outbox (intencionais) e advertência preexistente de proteção contra senhas vazadas desativada. Não foram alteradas configurações de Auth.

O build web ativo veio da revisão anterior; esta correção muda bot, testes e documentação. O resultado remoto de CI/build/deploy deve ser conferido no commit publicado desta revisão.

## Limites e operação

O Windows apresentou diferença de aproximadamente 27s em relação aos horários observados no banco/WhatsApp; `w32tm /query /status` informou serviço não iniciado (0x80070426). Configuração global de horário não foi alterada. Recomenda-se habilitar sincronização automática no Windows e conferir antes de um leilão real. O prazo do servidor continua sendo respeitado.

Para poupar Log Ingestion, os testes de volume e SQL foram isolados; em produção houve consultas pontuais, os pequenos testes autorizados e um backup manual. Não foi medido o delta da cota nesta sessão e não é possível prometer consumo inferior a 1GB a partir desses testes. Não criar sondagens frequentes nem repetir backups grandes para validar documentação.

A revisão fornece evidência dos caminhos descritos, não garantia de ausência absoluta de erros, comportamento de terceiros ou recuperação de toda falha física/rede. Sessão WhatsApp, journal e backup continuam privados; painel e bot permanecem em execução.
