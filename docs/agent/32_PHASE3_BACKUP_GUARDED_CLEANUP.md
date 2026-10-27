# 32 — Fase 3: limpeza de 12h protegida pelo backup

Autorizada pelo operador em 27/10/2026. Ensaios executados em banco local isolado e adicionados à CI; **nenhuma limpeza de produção foi acionada**. Nenhum horário, recibo ou dado real foi alterado para acelerar a elegibilidade. Completa a terceira fase do documento 30.

## Resultado local

Bootstrap, schema, bridge e as 75 migrations locais carregados em PGlite descartável. **32 cenários SQL aprovados**, incluindo a nova regressão `tests/cleanup-boundaries-and-atomicity.sql`. Funções reais de preparo/recibo/limpeza usadas com metadados fictícios de Storage; não há upload de backup ou acesso ao Supabase.

O novo ensaio configura dez leilões fictícios, lances, compras, pagamentos parciais, entregas, lembretes e aviso pendente. Confere:

| Situação | Resultado |
|---|---|
| Envio há 11h59, mesmo com início antigo | Preservado |
| Envio há 12h01, com término recente | Elegível; corte baseado no envio |
| Venda por maior lance e arremate | Incluídos, com compra, pagamento, entrega, lembrete e lance removidos quando cobertos |
| Cancelado antigo / draft com anúncio antigo e falha terminal | Elegíveis |
| Aberto / em revisão / draft sem envio | Preservados |
| Aviso de encerramento pendente | Preservado junto com o leilão |
| Carta compartilhada com leilão ativo / carta avulsa | Preservadas |
| Legado terminal sem dispatch | Usa fallback documentado de início/encerramento/criação |
| Sem recibo confirmado | Bloqueio total e nenhuma mudança nas 22 tabelas de negócio |
| Um pagamento alterado depois da cópia | Bloqueio total, inclusive dos outros candidatos cobertos |
| Backup atualizado cobrindo os candidatos | Cinco leilões elegíveis removidos; duas árvores financeiras completas removidas |
| Aviso pendente marcado como enviado depois da cópia | Nova elegibilidade não ignora cobertura: bloqueado até novo snapshot; depois libera somente o item correspondente |

Os bloqueios comparam snapshots ordenados de todas as 22 tabelas de negócio antes/depois, evitando declarar sucesso somente por um contador. Proteção append-only da auditoria verificada após bloqueio e sucesso. O ensaio usa margem de um minuto nos dois lados de 12h, sem espera real de 12 horas nem dependência de acertar um único microssegundo de igualdade.

## Regressões complementares

Os cenários existentes aprovados incluem: objeto de backup ausente, substituído ou expirado; hash/tamanho incorretos; recibo sem as coleções financeiras; carta/aviso/auditoria modificados depois do snapshot; estados de pagamento pendente/parcial/pago/estornado; isolamento transacional incompatível; auditoria/idempotência fora da retenção; preservação de filas/jogos sobreviventes.

`tests/concurrency-cleanup.py` foi ampliado para escritores reais concorrentes em **auctions, payments e payment_reminders**, em vez de somente auctions. O script agora recusa destino fora de localhost/loopback ou banco diferente de `leilao_test`. Na CI PostgreSQL 17, cada escritor segura sua transação; a limpeza precisa retornar `maintenance_busy`, zero exclusões e liberar locks anteriores, permitindo escrita em cards. O teste não usa sleeps para sincronizar as transações. Syntax check Python local aprovado; execução concorrente real deve ser confirmada no CI do commit publicado (PGlite local não substitui esse ensaio).

Nenhum código de runtime, assinatura de RPC, migration, cronograma ou heartbeat foi alterado. A mudança é composta por testes SQL/Python, inclusão do novo cenário na CI e documentação.

## Operação e limites

As 12h são o limiar de elegibilidade a partir do envio, **não promessa de exclusão naquele segundo**. O supervisor tenta a manutenção no máximo uma vez por hora e pode adiar por backup sem cobertura, aviso pendente ou contenção. Dados financeiros vendidos/arrematados seguem a política explicitamente autorizada do documento 25, sem mudar o contrato do botão manual de encerrados.

Não foi necessário iniciar, parar ou reiniciar o bot, nem criar leilões reais nesta fase. Não houve chamada ao Supabase, criação/download de backup remoto, tráfego de imagens ou carga de produção. Isso reduz consumo adicional, mas não mede a quota de Log Ingestion nem certifica a limpeza real enquanto o supervisor estiver desligado. Esta fase valida a lógica isolada; não afirma ter observado um ciclo real de produção após 12 horas.

Log local de evidência: `outputs/phase3-sql-20261027.log`, na pasta de trabalho da sessão, fora do repositório. O pacote privado de recuperação da fase 2 permanece intacto.

As três fases solicitadas estão concluídas em seu escopo: retomada real entre publicações, restauração do snapshot real em isolamento e validação isolada da limpeza protegida. Não iniciar novas exclusões/testes destrutivos ou fases adicionais por inferência deste documento.
