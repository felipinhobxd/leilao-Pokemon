# 24 — Retomada e primeiro backup confirmado

> Política atual autorizada: [25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md](25_AUTOMATIC_CLEANUP_ALL_OUTCOMES.md). Limpeza automática inclui vendidos/arremates e dados financeiros após 12h do envio, condicionada à cobertura do backup. Substitui a preservação automática de compras descrita historicamente abaixo. Migration 20261026041119 instalada (74 locais/82 remotos).

Concluído em 26/10/2026 após autorização explícita para as três etapas: conferir pendências, retomar supervisor e validar o primeiro backup confirmado. Horários abaixo em Brasília.

## 1. Conferência antes de iniciar

Não havia supervisor local do projeto ativo. Supabase: nenhuma fila agendada/em andamento, nenhum leilão aberto/em revisão, nenhum aviso, quick poll, comando do bot ou lembrete de pagamento pronto para enviar. Duas filas concluídas; 103 dispatches enviados e um com falha antiga `Connection Closed` (5 tentativas). Essa falha permaneceu parada: não houve retry manual, alteração de status ou publicação de lote de teste. 104 leilões e 102 compras no snapshot posterior.

A leitura inicial das credenciais locais apontou `registered: false`, mas a conexão real conseguiu reutilizar os dados salvos sem QR Code. Portanto esse indicador isolado não prova necessidade de novo pareamento. Não se apagou sessão nem se alterou `.env`.

## 2. Supervisor retomado

Iniciado em segundo plano no Windows, janela oculta, Node `C:\Program Files\nodejs\node.exe`, `--env-file=.env service.mjs`, cwd `D:\LeilaoPokemon\bot`. PID iniciado nesta operação: **11996**, worker `pc-leilao-01`, versão **0.2.10**, protocolo de proteção **1**. Confirmados conexão e heartbeat recente no Supabase às 00:55. Processo foi deixado em execução, conforme pedido. Não foi instalado serviço/autostart nem iniciado servidor web adicional.

Não enviamos mensagens de teste, comandos de publicação ou retry do lote antigo. O bot recebeu votos históricos de enquetes desconhecidas e os ignorou; isso não é evidência de novo leilão publicado. A conexão normal permite a operação habitual do bot a partir desta retomada.

## 3. Falha encontrada e correção necessária

A primeira tentativa automática de backup falhou no limite de 65s da requisição. A limpeza devolveu bloqueio, zero exclusões. A tentativa seguinte, após otimizar a divisão UTF-8, confirmou **SQLSTATE 57014 / statement timeout de 55s**. Duas tentativas falhadas; não se repetiu em loop nem se reduziu a cobertura para fazê-lo passar.

O histórico real tinha aproximadamente 42 mil eventos. A exportação mantinha o texto completo e uma segunda representação JSONB de todo o payload para montar os fingerprints, além das cópias usadas nos blocos. Mudanças:

- **20261026034750_linear_utf8_backup_chunk_preparation.sql:** offsets de bytea e pequenas janelas UTF-8 alinhadas, em vez de percorrer novamente o prefixo inteiro de texto para cada bloco. Preserva blocos de 262144 caracteres e leituras Unicode existentes.
- **20261026035257_memory_efficient_backup_snapshot_fingerprints.sql:** calcula fingerprints diretamente das tabelas e exportação **na mesma instrução SQL**, compartilhando um único snapshot MVCC. Não separar em duas instruções READ COMMITTED: isso poderia certificar uma linha ausente da cópia. Evita a segunda árvore JSONB gigante e reutiliza os bytes para o hash SHA-256.

Migrations criadas pela CLI, renomeadas para as versões registradas pelo conector e instaladas no mesmo projeto `gsyuoggymjdzxibfujyv`. Agora **73 arquivos locais / 81 registros remotos**, sem reparar história antiga. Mesmas assinaturas, envelope v2, grants privados, cobertura integral e bloqueio de limpeza. Sem mudanças no código de lances/envios.

## Backup real validado

Após a correção completa, uma execução assistida do mesmo `runBusinessBackup` terminou em **45 segundos**:

- Snapshot: **26/10/2026 00:52:58**; confirmação: **00:53:42**.
- JSON local: `D:\LeilaoPokemon\bot\backups\backup-20261026-0052.json`, **52.677.761 bytes**.
- Gzip privado: bucket `business-backups`, objeto `backups/backup-20261026-0052.json.gz`.
- **22 tabelas**, envelope v2, `complete_audit: true`, 104 leilões, 102 compras e 41.888 eventos.
- SHA-256 recalculado no arquivo local coincide com o recibo confirmado: `6ece3fb5a2ebabe71a8da9e3043ce277e782ea8c4cbc446b67f0c18560dbcc02`.
- RPC do painel devolveu **confirmed**, validade até **28/10/2026 00:52:58**, objeto e versão conferidos. Mesmo arquivo que foi comprimido/enviado pelo fluxo testado; não baixamos novamente o Gzip da nuvem para economizar transferência.

O último erro do supervisor continua sendo histórico verdadeiro da tentativa automática anterior; a execução assistida não falsificou telemetria nem acionou limpeza manual para deixar o cartão verde. O cartão de confirmação da cópia lê o recibo real e mostra a cópia válida separadamente. A próxima execução normal do supervisor reutilizará a confirmação existente antes de decidir a manutenção. Não houve exclusão de negócio nesta validação; uma futura manutenção automática pode remover registros cobertos conforme a política de retenção já autorizada.

## Validação e limites

**29 cenários SQL descartáveis aprovados**, incluindo histórico fictício de 42 mil eventos / mais de 40MB, integridade dos blocos e hashes, caracteres UTF-8 de 1–4 bytes, offsets cruzando blocos e fingerprints coincidentes com as linhas exportadas. Testes de cobertura, retenção financeira e restauração existentes mantidos. CI foi ampliada com os dois cenários novos; conferir resultado do commit final. Código JS/TS do produto não mudou nesta correção.

Advisors após instalação sem mudanças: quatro INFO intencionais de tabelas privadas com RLS sem policy; WARN preexistente de senha vazada fora do escopo ([RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [password security](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

Dados reais/credenciais/logs/backups estão ignorados pelo Git e não foram enviados ao repositório. Meta de Log Ingestion continua 1GB: não houve teste de carga no Supabase; houve a exportação operacional assistida descrita acima, duas falhas limitadas e consultas pontuais de diagnóstico. Não se mediu o consumo atual nem se garante a quota dos processos em execução. Snapshot de negócio continua sem bytes de imagens, Auth ou sessão WhatsApp; não se declara restauração total de desastre.

**As três etapas desta retomada estão concluídas.** Novas melhorias são opcionais; não iniciar outras fases por inferência do backlog.
