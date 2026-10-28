# Cartas e valores sem paginação — 28/10/2026

Pedido do operador: retirar páginas das listas de cartas e valores, voltando a uma lista contínua sem perder a fluidez com lotes grandes. As etapas Cartas, Valores, Publicação e Revisar continuam organizando o cadastro; a paginação interna de 12 itens foi removida de Cartas, Valores e Revisão.

## Implementação

- Todos os resultados do filtro aparecem na mesma lista, até o limite existente de 200 cartas. Busca, filtros e o atalho “Ir para carta” continuam disponíveis. O foco de validação e o salto para a última carta não dependem mais de mudar de página.
- Edição em lote passa a ter uma única seleção de resultados; a seleção por página foi removida. Seleções ocultas pelo filtro continuam preservadas e são informadas como tal. IDs, ordem, valores, imagens e respostas de quiz/brinde mantêm o mesmo fluxo.
- Blocos fora da área visível usam `content-visibility:auto` com estimativa de tamanho para adiar layout/pintura. Os itens permanecem no documento e disponíveis para rolagem, busca e foco; impressão força conteúdo visível. Sem biblioteca ou dependência nova.
- Preservados carregamento lazy/decodificação assíncrona das imagens, prévias pequenas, fila compartilhada de dois decodificadores e pausas entre imagens. O teste existente de 200 fotos continua verificando concorrência limitada e publicação progressiva das prévias.

## Validação

Teste novo de navegador restaura 200 cartas com miniaturas locais interceptadas, verifica os 200 itens sem navegação de páginas, salta/foca a carta 200, edita nome, abre Valores com 200 linhas, altera o último valor sem afetar o primeiro e volta preservando o nome. Executado em desktop e viewport de celular. Nenhuma imagem ou leilão real foi enviado.

Regressões de seleção, filtros, reordenação, rascunho, desfazer e foco de erro foram adaptadas à lista contínua. Os oito cenários focados passaram; **171 testes gerais, typecheck, build de produção e a suíte completa de 62 testes de navegador** também passaram localmente. As capturas desktop/celular foram produzidas pelo teste de 200 cartas, e a captura desktop foi inspecionada visualmente. Código enviado em `69bc51ef`; [CI aprovada](https://github.com/felipinhobxd/leilao-Pokemon/actions/runs/40743587836), incluindo navegador, banco, restauração, concorrência, build e guards. Deploy Vercel aprovado.

Limite: testes com miniaturas sintéticas não reproduzem todo aparelho/arquivo possível. A proteção da fila de imagens foi mantida, mas não há garantia universal de ausência de travamento. CSS adia pintura fora da tela; não elimina a montagem React de cada item.

Sem alterações no bot, migrations, banco ou intervalos de consulta. O bot não foi iniciado ou reiniciado. Não havia site escutando na porta 3000; após o build, somente o site foi iniciado com `npm run start:web`. Nenhum acesso ao Supabase foi necessário na validação local. Parar após entrega e apresentar o resultado.

O commit posterior registra apenas a evidência de CI nos MDs; não altera o código aprovado. Site local iniciado com a versão compilada desta mudança (sessão 20808), sem iniciar o bot.
