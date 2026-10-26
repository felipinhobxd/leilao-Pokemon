# 23 — Backup confirmado e limpeza no painel

> Atualização atual: [24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md](24_SAFE_RESUME_AND_FIRST_CONFIRMED_BACKUP.md). Supervisor retomado/conectado, primeiro backup confirmado (52,7MB, 22 tabelas). Duas otimizações de memória/UTF-8 instaladas: 73 migrations locais/81 remotas. Etapas anteriores que dizem não iniciar o bot são histórico.

Implementado em 26/10/2026, com autorização para a próxima etapa e pedido de sugerir a fase seguinte ao concluir.

## Comportamento

Em **Diagnóstico e recuperação da operação → Verificar agora**, o cartão **Backup e limpeza automática** mostra confirmação válida da nuvem, data do snapshot, confirmação e validade de 48h. Distingue ausência de recibo, preparo sem confirmação, cópia vencida, arquivo removido/substituído e falha da consulta. Um arquivo antigo ou status de sucesso do bot não gera selo verde por si só.

O resultado da **última tentativa de limpeza** é separado: adiada, concluída ou falhou, com data, quantidade removida e motivo conhecido em português. Uma cópia confirmada pode coexistir com limpeza adiada por dados alterados. O painel não executa prévia da exclusão nem afirma cobertura atual com base em um resultado antigo. Se o supervisor está sem sinal ou não informou o protocolo novo, explica a limitação e a atualização planejada. Preparar backup manual continua separado e não libera limpeza automática.

Consulta somente ao clicar, mantendo as quatro leituras paralelas do diagnóstico: worker, avisos, publicações e RPC pequena no lugar da listagem de arquivos. Não há novo timer, Realtime, leitura de hashes/payloads, download de backups ou varredura de registros candidatos. Resultado tem cache privado desativado e falha do backup não apaga os demais diagnósticos. Timeout de 20s na consulta do navegador.

## Implementação e segurança

`get_operation_backup_status()` é uma função somente de leitura, SECURITY INVOKER, search_path vazio e EXECUTE apenas service_role. A rota exige sessão/perfil ativo pelo authorize existente, inclusive para viewers; ações de escrita continuam exigindo operador/admin. Não envia nomes dos objetos, manifestos, credenciais ou erros do provedor ao navegador.

Migration criada pela CLI e renomeada para a versão instalada: **20261026033328_operation_backup_protection_status.sql**, projeto `gsyuoggymjdzxibfujyv`. **71 arquivos locais / 79 registros remotos**; divergências históricas preservadas. Instalação confirmada por catálogo/grants e uma chamada pontual da RPC somente de leitura. Retornou `missing`, sem confirmação de backup naquele momento; isso não prova ausência de arquivos antigos. Advisors permaneceram iguais: quatro INFO de tabelas privadas com RLS sem policies intencionais e WARN preexistente de proteção de senha vazada, fora desta etapa. [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [proteção de senhas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

`bot/operation-health.mjs` agrega estado limitado de cleanup/protocolo ao heartbeat já existente. `bot/service.mjs` registra o retorno da tentativa horária e falhas; não muda agendamento, retenção, critérios de exclusão, envios ou lances. A restauração da telemetria preserva a data original, sem fingir nova execução. O resultado só será publicado por um supervisor que carregar esse código.

## Situação do supervisor e consumo

Nenhum supervisor local ativo do projeto foi encontrado na conferência. No Supabase, o último sinal era antigo (25/10/2026 14:00 UTC), versão 0.2.8, estado starting, sem protocolo novo. A consulta encontrou zero leilões abertos/em revisão, mas não é autorização para retomar mensagens pendentes sem conferir as filas. **Nenhum bot iniciado/reiniciado, backup real, exclusão real ou mensagem enviada.** Retomada controlada e primeira confirmação real ficam como fase seguinte proposta ao operador.

Meta de Log Ingestion: 1GB. Apenas catálogo, metadados operacionais limitados, advisors e instalação da função; testes usam ambiente descartável/fixtures sem Supabase/WhatsApp. Não se mediu nova quota nem se garante consumo dos processos externos ativos.

## Verificação

- 140 testes raiz, 71 testes do bot, typecheck, check e build aprovados localmente.
- 27 cenários SQL em banco descartável: estados ausente/não confirmado/válido/arquivo substituído/vencido, cópia válida anterior preservada e grants privados. Ensaios existentes de restauração, retenção e pós-venda mantidos.
- Testes de API comprovam autenticação, mesma contagem de leituras, estados separados, falha parcial e redação segura; testes anteriores de compare-and-set dos avisos foram preservados.
- Prévia desktop e iframe móvel de 390px: acessibilidade sem violações WCAG A/AA detectadas pelo axe e sem overflow horizontal. Testes CI adicionados para confirmação + bloqueio coexistentes, supervisor antigo/offline, erro da consulta e recuperação para cópia vencida, em desktop e celular.
- Conferir CI/deploy do commit publicado antes de afirmar aprovação remota. Screenshot local com dados fictícios: `outputs/backup-e-limpeza-painel.png` na pasta desta conversa.

Não ampliar polling nem gerar backup pesado para atualizar um cartão de status. Para detalhes da proteção das exclusões, consultar o documento 22.
