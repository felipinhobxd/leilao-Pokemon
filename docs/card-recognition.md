# Reconhecimento local de cartas Pokémon

## Objetivo

O cadastro em lote tenta identificar a carta antes do upload definitivo da imagem. O recurso é auxiliar: qualquer falha mantém o cadastro manual disponível e nunca bloqueia a criação do leilão.

## Arquitetura

1. O navegador cria o preview local da imagem.
2. Calcula SHA-256 do arquivo para reutilizar reconhecimento já feito na sessão.
3. Redimensiona uma cópia temporária para no máximo 1500 px e cria crops em Canvas.
4. Tesseract.js 7.0.0 é carregado somente quando existe uma imagem para reconhecer.
5. Um único worker reutilizável lê primeiro as regiões superior e inferior; a região central é lida apenas quando nome/idioma continuam ambíguos.
6. Português, inglês e espanhol compartilham o worker Latin; japonês é carregado como fallback separado somente quando necessário.
7. O navegador envia ao TCGdex apenas metadados OCR (nome/número/idioma). A fotografia não é enviada ao catálogo.
8. Os candidatos são pontuados por número, denominador do set, similaridade do nome, idioma e HP.
9. Confiança alta preenche os campos; confiança média preenche e pede revisão; confiança baixa não inventa resultado e apresenta candidatos quando existirem.
10. Só depois o fluxo normal de otimização/deduplicação/upload para o Supabase é executado quando o usuário realmente cria a fila.

## Privacidade e custo

- Nenhuma API de IA paga é usada.
- Nenhuma imagem é enviada a OpenAI, Gemini, Claude, AWS, Google Vision, Azure Vision ou serviço equivalente.
- Tesseract.js roda no navegador em Web Worker/WASM.
- TCGdex é usado somente como catálogo REST gratuito/open-source.
- O OCR não passa por Vercel e não exige gravar a imagem no Supabase para reconhecer.
- O `service_role` do Supabase continua restrito ao servidor; este recurso não usa essa chave.

## Performance

O OCR pesado é serializado em um worker reutilizável. Embora 2–3 jobs simultâneos possam reduzir o tempo total em máquinas fortes, múltiplos workers do Tesseract podem multiplicar uso de memória. A primeira versão privilegia estabilidade: o usuário continua editando as cartas enquanto a fila progride.

O catálogo possui cache em memória de 30 minutos e o reconhecimento completo possui cache por SHA-256 em memória + `sessionStorage`. A mesma imagem adicionada novamente na mesma sessão não repete o OCR pesado.

As consultas ao TCGdex são limitadas: primeiro combinam `localId` e nome quando disponíveis, com paginação explícita de até 12 candidatos; fallback por número ou nome acontece apenas quando a busca mais restrita não encontra nada. Cada busca carrega detalhes de no máximo 4 candidatos.

## Campos automáticos

Podem ser preenchidos somente quando houver confiança suficiente:

- Nome
- Coleção / edição
- Número da carta
- Idioma (`pt-BR`, `en`, `es`, `ja`)
- Variante, somente quando o catálogo indicar uma única variante inequívoca entre Normal/Holo/Reverse Holo

Nunca são inferidos automaticamente:

- Condição (NM/LP/MP/HP/DMG)
- Preço
- Lance inicial
- Incremento
- ARREMATE

## Prioridade da edição manual

Cada campo reconhecível mantém um sinal de edição manual. Assim que o usuário altera Nome, Coleção, Número, Idioma ou Variante, reconhecimentos automáticos posteriores não sobrescrevem esse campo. Escolher explicitamente um candidato também passa a ser uma decisão manual.

## Limitações conhecidas

OCR não é visão computacional completa. Reflexo forte, sleeve muito brilhante, perspectiva severa, crop que remove topo/rodapé, resolução baixa, fontes promocionais e cartas fora/incompletas no TCGdex podem reduzir a precisão. A condição física da carta não é inferida.

Português, espanhol e inglês podem compartilhar nomes de Pokémon. Por isso o idioma não é decidido apenas pelo nome; são usados texto de regras e correspondência de catálogo. Japonês usa caracteres Hiragana/Katakana/Kanji como sinal forte e um modelo OCR carregado sob demanda.

Acurácia de produção deve ser medida com fotografias reais do usuário. Testes unitários de heurística não substituem um conjunto real de imagens com reflexo, perspectiva e sleeves. Não publicar porcentagens de acerto sem esse conjunto.

## Métricas exibidas

Cada reconhecimento mantém:

- confiança final;
- tempo decorrido em milissegundos;
- número de requests efetivos ao catálogo (hits de cache não contam);
- indicação quando o resultado veio do cache da sessão.

Essas métricas ajudam a coletar um benchmark real sem enviar imagens ou telemetria adicional ao servidor.

## Fallback visual local

Após localizar/orientar a carta e consultar o catálogo, somente 2–5 candidatos com
forte evidência OCR e imagens oficiais podem acionar DINOv2-small ONNX. Um acerto
inequívoco de nome + número não cria worker neural. Nenhum modelo roda em idle.

`@huggingface/transformers` 4.2.0 roda em worker dedicado: WebGPU q4, depois WASM q4,
com int8 como último fallback. Pesos q4: 16,9 MB; int8: 24,4 MB, além do runtime.
Modelo original e biblioteca: Apache-2.0. Fontes:
https://huggingface.co/onnx-community/dinov2-small-ONNX/tree/main/onnx
https://github.com/facebookresearch/dinov2/blob/main/LICENSE

Uma foto normalizada é comparada serialmente às imagens oficiais. Similaridade
cosseno só reordena candidatos quando há separação suficiente; nunca admite
candidatos descartados pelo OCR. Resultados neurais continuam pedindo revisão,
pois os limiares ainda não foram calibrados com fotos reais.

O worker mantém até 64 embeddings oficiais, encerra após 2 minutos sem uso e é
terminado após 90 segundos de espera sem resposta. Falhas preservam o resultado
OCR e suspendem novas tentativas por 2 minutos. Cache completo SHA-256 v3 inclui
`visualUsed` e `visualBackend`; pesos e embeddings não passam pelo Supabase.
O cache em memória tem limites de 64 reconhecimentos e 256 respostas de catálogo.

## Iniciar Web + bot no Windows

Na raiz, depois de configurar os ambientes:

```powershell
npm.cmd ci
npm.cmd --prefix bot ci
npm.cmd run build
npm.cmd start
```

`npm.cmd run start:web` inicia somente Next.js. O launcher usa o supervisor
existente. Ctrl+C encerra a árvore de processos; falha de um componente encerra
ambos. Um guard compartilhado pelo supervisor e modo foreground impede duas
instâncias locais de usarem a mesma pasta de sessão, inclusive o serviço Windows.
Não impede outra máquina de usar uma cópia da sessão.

Fotos reais não estavam disponíveis nesta implementação: acurácia, uso de IA em
X/Y fotos, requests TCGdex reais e consumo CPU/RAM/GPU não medidos.
