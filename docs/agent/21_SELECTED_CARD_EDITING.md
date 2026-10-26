# 21 — Edição das cartas selecionadas

2026-10-25. Próxima etapa autorizada depois do aviso de atualização do painel e da proteção de navegação. Escopo: **cadastro em lote ainda não publicado**, etapas Cartas e Valores. Sem migration, API nova, alterações em `bot/` ou consultas de produção nesta rodada.

## Seleção e aplicação

- Checkbox por carta, identificado pela posição visível, mas seleção armazenada pelo **UUID local**, nunca pelo índice. Continua correta ao filtrar, paginar e reordenar. Remover uma carta retira sua seleção; abrir outro rascunho ou começar uma nova fila limpa seleção/desfazer.
- Selecionar esta página, selecionar resultados da busca/filtro em todas as páginas e limpar seleção. A seleção é cumulativa. Mostra quantas estão selecionadas e quantas estão fora da página; explica que as ocultas pelo filtro também recebem a ação.
- Campo explícito por aplicação: idioma, condição, variante, inicial/incremento/arremate automáticos, remoção de arremate, quantidade de opções sem arremate, valores personalizados e duração individual quando essa modalidade está ativa.
- Idioma/condição/variante podem ser aplicados a leilões, brindes e quizzes. Valores automáticos só afetam leilões já automáticos; não convertem valores personalizados silenciosamente. Número de opções só afeta automáticos sem arremate. Valores personalizados são uma mudança explícita de modalidade. Jogos não recebem valores. Duração só é aplicada quando não há encerramento comum.
- **Copiar configurações de uma carta** usa uma lista restrita: idioma/condição/variante e, entre leilões, os campos de preço e duração individual ativa. O botão antigo **Copiar configurações da carta anterior** agora usa a mesma regra. Não duplica mais fotos, tipo, opções/perguntas/correta de jogos ou coleção. Nomes, números, lotes, UUID, mídia e dados individuais dos jogos são preservados.
- Aplicação **atômica em memória**: valida todas as cartas elegíveis antes de trocar o estado. Conflito de arremate/preço, valor inválido ou mais de 12 opções rejeita a aplicação inteira. As cartas incompatíveis com o campo são ignoradas e contadas no retorno; não são consideradas erro da aplicação. Sem alteração em lote já publicado.
- Os controles anteriores “para todas” permanecem separados e identificados. A nova área não muda o significado desses controles globais.

## Desfazer, rascunhos e desempenho

Desfazer guarda somente os campos efetivamente alterados na última aplicação, por UUID. Não guarda cópias de Files, fotos ou cartas inteiras. Só restaura um campo se ele ainda tiver o valor aplicado; preserva digitação posterior, uploads, exclusões e reordenações. Revalida combinações de preço para não restaurar arremate inválido depois de uma edição individual. É um nível de desfazer; uma aplicação nova bem-sucedida substitui o anterior. Contagem de zero alterações não apaga o desfazer anterior.

Seleção, campo do editor e histórico de desfazer são apenas UI: não entram no payload do rascunho nem contam como alteração de negócio. A aplicação efetiva usa os campos já suportados pelo salvamento/publicação, marca pendência e continua sob a proteção de navegação. Ações são bloqueadas durante salvamento/publicação/confirmação incerta. Nenhum novo polling, upload ou comando automático.

A lista continua renderizando até 12 cartas por página, com prévias assíncronas e suporte a 200 itens. A seleção tem área de toque de 44px, nomes acessíveis e indicação textual de estado. Configurações ficam recolhidas até haver seleção, com mensagens de resultado/erro acessíveis e layout adaptado ao celular.

## Validação

- Local: **134 testes raiz**, typecheck e build aprovados. Casos de 200 cartas, identidade após reorder, mistura com jogos/personalizados, rejeição atômica de preço, whitelist, cópia segura, desfazer após edição/upload/exclusão e bloqueio da duração com horário comum.
- CI acrescenta três cenários desktop/celular: seleção entre páginas/filtro/reordenação persistindo somente os campos escolhidos no rascunho; edição/desfazer mantendo a correta do quiz e nome posterior; preço incompatível rejeitando toda a aplicação. Acessibilidade e ausência de overflow também são verificadas no cadastro com seleção ativa. Conferir o resultado do commit publicado antes de declarar CI/deploy concluídos.
- Teste visual com dados fictícios: aplicação de idioma apenas à primeira carta e retorno pelo desfazer. Não publicar fila ou enviar mensagem real para validar esta função.

Permanecem fora desta etapa: cobertura exata do backup antes de limpeza (P-19), promoção assistida de recuperação em produção e qualquer alteração no fluxo do bot. O operador pediu aviso ao mudar de etapa; não iniciar outro item por inferência do backlog.
