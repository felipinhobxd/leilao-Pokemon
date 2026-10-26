# 26 — Excel com horários e mudanças de lance

Pedido do operador em 26/10/2026: mostrar primeiro/último lance por pessoa e qual valor foi trocado por qual. Implementado em `lib/export-rows.ts` e `app/api/export/route.ts`.

## Leitura da planilha

- Nova aba **Lances por participante**: uma linha por leilão + participante, carta/lote, telefone, primeiro/último valor, respectivos horários, origem de cada horário, quantidade de lances/alterações e situação do último lance com horário disponível. IDs ao final distinguem homônimos e lotes repetidos.
- **Alterações de valores** mantém valores numéricos, diferença, avisos e tipo de alteração. Acrescenta texto `R$ 50,00 → R$ 40,00`, horário do lance anterior quando identificado, primeiro/último lance da pessoa naquele leilão, telefone e observações. Data da alteração é o instante registrado no log, não horário da exportação.
- Horários em **Brasília**, com dia/mês/ano, segundos e milissegundos preservados quando disponíveis. A origem WhatsApp pode registrar apenas segundos; `.000` não significa precisão adicional. Células permanecem datas reais, valores permanecem números e o TOTAL de Vendas continua na coluna G.
- Cabeçalhos e três colunas identificadoras ficam congelados nas duas abas de histórico. Filtros e cabeçalhos com quebra de linha ajudam na consulta. A aba Lances também expõe `whatsapp_event_at` e `received_at`.

## Regras e limites

- Inclui lances ativos, substituídos e retirados; exclui rejeitados e fora do prazo apenas do resumo. A aba bruta mantém todos. Retirar um lance não transforma o horário da retirada no horário do último lance.
- Cada lance usa o primeiro horário válido entre `whatsapp_event_at`, `processed_at` e `received_at`. A origem aparece no resumo. Ordenação usa o instante original UTC, com desempate por `confirmation_order` sem perder precisão de inteiros grandes e depois ID. Não usa `first_seen_at`/`last_seen_at` globais do participante.
- A ligação do lance anterior usa evento externo da alteração e `replaced_by`; na re-oferta, pode usar o predecessor cronológico do mesmo participante/leilão. Exige valores compatíveis e anterioridade. Ausência ou incompatibilidade deixa a célula vazia com observação, sem procurar outro lance de valor repetido para adivinhar a ligação.
- Lances sem horário válido continuam na contagem, com observação de histórico incompleto. Primeiro/último e seus valores usam somente os horários disponíveis. Valores ausentes no log não são convertidos em zero.
- A rota mantém a autenticação existente e **uma chamada ao snapshot de exportação já existente**, sem consultas extras, polling, migração ou escrita no banco. Não usa o snapshot reduzido do painel.
- Limites existentes do snapshot: 50.000 lances e 10.000 alterações. Resumo avisa quando alguma dessas coleções atinge o limite; os horários referem-se apenas ao histórico incluído, sem promessa de histórico integral além dos limites.
- A limpeza automática do documento 25 continua removendo histórico elegível após 12h do envio. **Exporte antes da limpeza**. O Excel não recupera dados já excluídos; isso também é explicado no Resumo.

## Verificação

148 testes raiz, typecheck e build locais aprovados. Oito testes novos cobrem agrupamento, retiradas/re-ofertas, rejeitados/fora do prazo, fusos, milissegundos, fallback de horário, falta de dados, desempate bigint, vínculos incompatíveis e limites. A rota real foi chamada com backend fictício e seu XLSX serializado foi reaberto com ExcelJS: datas, números, fórmula TOTAL, texto iniciado por `=`, autenticação, cache privado, consulta única e falha do snapshot verificados.

Nenhum arquivo de `bot/` alterado, nenhum processo iniciado/reiniciado, nenhuma mensagem real ou exportação de produção para testar. Nenhuma chamada ao Supabase nesta implementação; a meta de 1GB de Log Ingestion permanece, sem medição ou garantia sobre consumo do bot já em execução. Conferir CI e deploy do commit final antes de declarar validação remota.
