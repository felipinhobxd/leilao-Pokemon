# 22 — Cobertura do backup antes da limpeza automática

Pedido autorizado em 25/10/2026: conferir e resolver P-19, preservando o bot e a meta de 1GB de Log Ingestion. Este documento substitui a limitação P-19 dos documentos anteriores.

## Proteção implementada

- O nome do arquivo do dia deixa de autorizar exclusões. O snapshot registra um recibo privado com SHA-256 do texto exportado e impressões digitais das linhas que a manutenção pode afetar.
- Depois do upload Gzip, o supervisor confirma o ID do snapshot, hash do conteúdo e tamanho comprimido. A RPC confere a existência, ID, versão, data de atualização e tamanho do objeto privado. Upload/registro falhou: o JSON local continua disponível, mas não libera limpeza.
- A limpeza exige uma única cópia confirmada com até 48h e objeto ainda presente na mesma versão. Compara os campos completos das linhas candidatas, incluindo carta, lances, avisos enviados em cascata, filas, auditoria/cache e preimagens de referências que serão anuladas. Qualquer divergência adia **toda** a limpeza; nenhuma exclusão parcial.
- Vendas com compras vinculadas seguem preservadas mesmo pagas. Avisos pendentes e filas com jogos/dispatches sobreviventes seguem protegidos. Exclusão individual, botão de encerrados e Excluir TUDO mantêm seus contratos anteriores; esta etapa protege a manutenção automática.
- Auditoria/cache agora são exportados integralmente, incluindo linhas antigas ainda existentes. O envelope continua v2, com `complete_audit: true` e `audit_window_days: null`. A retenção continua 7d, condicionada à cobertura. Os objetos do Storage/WhatsApp/Auth continuam fora do backup de negócio.
- Exportação e comparação usam UTC; a verificação diária do supervisor usa o início do dia local convertido em instante ISO. Não depende mais do dia UTC do nome do arquivo.

## Concorrência e custo

A manutenção adquire locks de escrita nas tabelas envolvidas **sem esperar**. Se houver escrita em andamento, devolve `maintenance_busy` com contadores zero. Se obtiver os locks, mantém a verificação e exclusão na mesma transação, impedindo mudanças entre elas; escritores que chegarem durante essa transação podem aguardar sua conclusão. Não há chamadas de rede enquanto os locks estão mantidos. O conjunto de hashes é materializado uma vez, evitando copiar um manifesto grande a cada comparação de linha.

Mantidos backup diário, cooldown de falha de 30min e tentativa de limpeza no máximo horária. Não há backup completo novo por tentativa, polling extra ou logs por registro. A consulta pequena do recibo substitui a listagem diária do bucket. Recibos não confirmados expiram após 1h e confirmados após 48h, com remoção no próximo preparo. A inclusão da auditoria antiga e os hashes acrescentam trabalho ao snapshot diário; não se fez teste de carga real nem medição nova da quota. Não há garantia sobre o consumo dos processos já ativos.

Confirmação significa upload aceito pelo SDK + hash do payload conferido com o snapshot + metadados/versão do objeto conferidos pelo banco. Não baixa novamente o arquivo para verificar cada upload; evita duplicar transferência. A chave de serviço continua sendo uma fronteira confiável. Ensaios de restauração e verificação de arquivos baixados continuam no pacote do documento 19.

## Instalação e operação

Migration criada pela CLI: `20261026013353_require_confirmed_backup_coverage.sql`; versão efetiva de produção será registrada após aplicação. Nenhuma função de backup, limpeza ou exclusão real foi chamada para validar a instalação.

O código de `bot/backup.mjs` e a verificação em `bot/service.mjs` foram alterados. **Nenhum processo do bot foi iniciado/reiniciado nesta tarefa.** Um supervisor já em execução precisa carregar o código atualizado na próxima reinicialização planejada para confirmar os novos backups. Enquanto isso, backups antigos continuam utilizáveis, porém não ganham recibo retroativo e a limpeza automática fica adiada. Publicação, lances e mensagens não dependem dessa confirmação. Não reiniciar automaticamente durante leilões.

## Verificação

Local: 137 testes raiz, 70 testes do bot, typecheck, check do bot e build aprovados; 26 cenários SQL em banco descartável, incluindo falha/ausência de confirmação, hash/tamanho incorretos, alteração de carta/aviso/auditoria após exportação, objeto substituído/removido, recibo vencido, cobertura integral e permissões privadas. Fixtures usam metadados fictícios, sem upload real. CI também verifica concorrência real em PostgreSQL17: limpeza cede imediatamente a uma escrita em andamento. Conferir CI do commit final antes de afirmar validação remota.

Não executados: backup/upload de produção, exclusão real, reinício do bot ou envio de WhatsApp.
