# Benchmark real de reconhecimento de cartas

Este diretório define o protocolo de avaliação do reconhecimento. O objetivo é medir a **impressão exata da carta**, não apenas o nome do Pokémon.

## Privacidade

Fotos reais do usuário são fixtures privadas. Elas **não devem ser commitadas** por padrão, porque podem conter fundo, mesa, cômodo, reflexos ou outros dados pessoais. Coloque-as somente em:

```text
benchmarks/card-recognition/private/
```

Esse diretório é ignorado pelo Git. Resultados locais que possam revelar os nomes dessas fotos também são ignorados. Só publique uma imagem quando houver autorização explícita e ela tiver sido revisada para remover dados privados.

## Ground truth

Crie localmente `benchmarks/card-recognition/private/ground-truth.json` a partir de `ground-truth.example.json`. Cada amostra deve informar:

- `fixtureId`: identificador estável e não pessoal;
- `cardId`: ID exato do catálogo TCGdex;
- `name`;
- `set`;
- `cardNumber`;
- `language`;
- `variant`, quando conhecida;
- `image`: caminho relativo da foto privada.

Não use filename, hash ou ground truth para ajudar o reconhecedor. O ground truth só entra **depois** da inferência para calcular métricas.

## Métricas obrigatórias

Compare o mesmo conjunto antes/depois e registre:

- Top-1 exact card accuracy;
- Top-3;
- Top-5;
- nome correto;
- set correto;
- collector number correto;
- idioma correto;
- latência média, P50 e P95;
- requests TCGdex;
- RAM aproximada;
- VRAM aproximada quando WebGPU for utilizado.

`lib/card-recognition-benchmark.ts` contém o cálculo determinístico dessas métricas. Similaridade cosseno, hash perceptual ou score interno **não são confiança calibrada**.

## Baseline

O baseline da v9 é o commit `362684795c0ae4371c95f10de99268fd9a050036`. Nenhuma porcentagem de acurácia deve ser publicada sem executar esse commit e a v10 contra exatamente as mesmas fotos privadas.

## Casos que o dataset deve cobrir

Inclua gradualmente: OCR de nome completamente errado, número errado por um dígito, 0/O, 1/I/l, 5/S, 8/B, mesmo Pokémon em vários sets, mesmo artwork em sets diferentes, idiomas diferentes, foto inclinada/girada, sleeve, reflexo, baixa luz, crop incompleto, promo, Full Art, EX/GX/V/VSTAR/ex, cartas antigas e modernas.

O teste mais importante é: **OCR do nome pode estar completamente errado e ainda assim a busca visual global deve conseguir colocar a impressão correta no Top-K.**
