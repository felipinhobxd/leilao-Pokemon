# 33 — Auditoria independente GLM: fase 1

Autorizada em 27/10/2026, após a segunda auditoria corrigir conclusões da primeira. Esta fase trata defeitos objetivos; não muda regras de lance, brinde, quiz, retirada, limpeza ou conclusão de fila. As três fases de resiliência dos documentos 30–32 já haviam terminado e são outra sequência.

## Alterações

- **Contatos privados (C-1):** removidos os destinatários reais do módulo, testes e dois MDs. `BOT_ADMIN_WA_JIDS` passa a ser configuração obrigatória; parse valida formato numérico com DDI e sufixo de WhatsApp, elimina duplicatas e não imprime valores inválidos. Ausência de destinatários impede iniciar o filho em vez de descartar notificações. A configuração local existente foi preservada; na ausência dela, os destinatários anteriores foram migrados para `bot/.env`, confirmado como ignorado pelo Git. Validação local da configuração passou sem iniciar o bot. Exemplos e testes usam contatos sintéticos. **O histórico Git não foi reescrito e ainda contém os contatos antigos.**
- **CI completa (C-5):** `npm --prefix bot run check` mantém verificações de sintaxe e patch Baileys, executando `node --test *.test.mjs` uma vez. Inclui agora `warning-notify.test.mjs` (9 casos anteriores) e `payment-reminder.test.mjs` (6), que eram os dois arquivos ausentes. Novos arquivos de teste também entram pelo glob. Antes: check 109 / suíte completa 124; depois: check e suíte completa 130.
- **Auditoria idempotente (C-6):** colisão `23505` exige leitura por `external_event_id` e comparação de leilão, participante, administrador, tipo, ID do evento, eleitor, telefone, instante, opção e valor. Nome enriquecido, motivo textual e fotografia do vencedor podem mudar no replay. Outra colisão, evento incompatível ou leitura indisponível continuam falhando para a inbox persistente tratar. Não há upsert nem alteração de auditoria antiga. Tipos de recusa diferentes continuam exigindo intervenção em vez de serem tratados como equivalentes.
- **IDs da publicação (C-7):** projeção em `auctions` verifica erro e ausência da linha, faz no máximo uma repetição com os mesmos IDs/timestamp e, se persistir, usa o relatório de erro limitado já existente. O dispatch cujos envios já foram persistidos continua sendo marcado `sent`; não se reenvia a enquete por falha dessa projeção. Não há reconciliação periódica nova; falha persistente deixa a projeção incompleta e requer diagnóstico. Os IDs do dispatch permanecem disponíveis para identificação/guard de apuração.
- **Documentação e manifesto (C-8):** README distingue limpeza automática de 12h do botão manual que preserva compras, corrige auditoria completa do backup e data a contagem de migrations. O pacote usa `audit_window_days` e `complete_audit` do arquivo de origem: backup com janela numérica sem flag explícita é parcial, arquivo antigo sem metadados fica desconhecido (`null`). Não se reescrevem pacotes existentes nem se altera o verificador para invalidar os antigos. O documento 28 esclarece que revisão de retirada depende de tentativa anterior incerta.

## Verificação local

- `npm test`: **171 aprovados**.
- `npm --prefix bot run check`: **130 aprovados**, sintaxe e patch Baileys aprovados.
- `npm run typecheck`: aprovado.
- Regressão com funções reais do pipeline e inbox em diretório temporário: insert confirmado com resposta perdida, replay sem segundo evento e liberação do guard; rejeição de identidades/votos divergentes e falha de leitura.
- Projeção: resposta perdida, erro retornado persistente, linha ausente e trecho real do publisher confirmando `sent` apesar da falha da projeção.
- Recuperação: manifesto de auditoria completa, janela histórica de sete dias e cobertura desconhecida; hashes/SQL/imagens simuladas preservados.
- Contatos antigos ausentes dos arquivos rastreados atuais; `bot/.env` privado válido e ignorado. Isso não é remoção do histórico nem de cópias externas.

CI remota e deploy devem ser conferidos no commit desta fase antes de informar aprovação remota. Os testes de navegador/SQL completos já fazem parte da CI; não usam produção.

## Operação e limites

Bot **0.2.16 no disco**. Nenhum bot real iniciado/reiniciado, mensagem WhatsApp enviada, foto baixada, backup real gerado ou migration aplicada. A versão em execução não foi certificada nesta fase. Nenhuma chamada ao Supabase de produção, novo polling ou novo log periódico foi introduzido; o volume de Log Ingestion não foi consultado nem pode ser garantido por esses testes locais. Há apenas leitura de auditoria em colisão e uma repetição limitada da projeção quando falha.

Não se implementam nesta fase: elegibilidade de brinde por compra, prazo de um minuto para retirada, aviso final de fila parcialmente falha, fallback/escalada de @all, redução de polling, fusão de identidades e garantia de entrega única de DMs. DMs continuam best-effort: resposta perdida entre envio e persistência pode duplicar mensagem. São escolhas ou trabalhos separados, não defeitos corrigidos por este commit.

**Após conferir CI/deploy, apresentar os resultados e perguntar antes de iniciar a fase 2.** Não ativar o bot automaticamente para concluir esta fase.
