# Leilão Pokémon

Painel administrativo de leilões de cartas Pokémon, com Supabase como fonte oficial da verdade e exportação Excel. Reutiliza a fundação Next.js + TypeScript existente.

## Funcionalidades

- Login com Supabase Auth e autorização por `admin_profiles` (admin/operator escrevem, viewer consulta).
- Cadastro e edição de cartas, participantes e leilões; remoções preservam histórico: arquivar carta, bloquear participante e cancelar rascunho.
- Abrir disputa, registrar/trocar/retirar lance, solicitar/confirmar ARREMATE e finalizar com compra e entrega inicial.
- Um lance ativo por participante/leilão; desempate pelo primeiro lance válido confirmado. Trocar lance recebe nova ordem de confirmação.
- Participantes suspensos/bloqueados não lançam nem vencem a finalização. Um ARREMATE já confirmado permanece definitivo.
- Prazo verificado pelo relógio do banco. Depois do prazo, novos eventos são recusados; a administração finaliza a disputa manualmente.
- Transação única, lock do leilão, chave única de compra e idempotência global por evento.
- Histórico protegido contra UPDATE/DELETE, com identificação do administrador em alterações feitas pela API.
- Realtime autenticado, atualização ao reconectar/retomar a aba e recuperação a cada 30 segundos.
- Excel real com Resumo, Cartas, Participantes, Leilões, Lances, Compras, Pagamentos, Entregas, Advertências e Auditoria.

## Configuração

Node.js 24+. Nunca coloque chaves privadas em commits ou variáveis `NEXT_PUBLIC_*`.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Configure no `.env.local` e no ambiente da hospedagem:

```env
NEXT_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=CHAVE_PUBLICAVEL
SUPABASE_SERVICE_ROLE_KEY=CHAVE_PRIVADA_APENAS_NO_SERVIDOR
```

As variáveis públicas precisam estar definidas **antes do build**. Sem elas, a página exibe configuração pendente e não inventa dados. O `.env.example` contém a URL e a chave publicável do projeto PokemonLeilao; a chave privada deve ser preenchida somente no ambiente local/hospedagem.

### Banco novo

1. Execute `supabase/schema.sql` uma vez em um banco Supabase novo. O arquivo inteiro é transacional e já inclui as operações e políticas atuais.
2. Em um banco que **já aplicou o schema inicial**, execute somente `supabase/operations.sql`. Não execute o schema inicial novamente sobre tabelas existentes. Faça backup antes da atualização.
3. Crie o usuário administrativo no Supabase Auth e cadastre seu UUID pelo SQL Editor:

```sql
insert into public.admin_profiles(user_id, display_name, role)
values ('UUID-DO-USUARIO-AUTH', 'Administrador', 'admin');
```

4. Entre no painel com e-mail/senha desse usuário. Usuários Auth sem perfil ativo não acessam dados. Somente o SQL Editor/servidor confiável provisiona perfis administrativos.
5. Execute advisors de segurança/performance no projeto hospedado e confira a publicação `supabase_realtime`. O SQL inclui as tabelas necessárias e índices das FKs.

**Estado da configuração:** schema aplicado e testes funcionais/RLS aprovados no projeto `gsyuoggymjdzxibfujyv` (PokemonLeilao), com rollback dos dados de teste. Realtime habilitado em seis tabelas. Advisors de segurança sem WARN/ERROR após restringir a função de event trigger da plataforma; o INFO de RLS sem política em `processed_commands` é intencional (acesso exclusivo do backend). Índices ainda sem uso são esperados em banco vazio. Falta criar o usuário administrativo, preencher a chave privada no ambiente e testar o painel autenticado/Realtime no navegador.

## API e futura ponte WhatsApp

```text
WhatsApp → Bot Baileys → API/backend → Supabase → painel
```

O bot completo e sua autenticação de máquina ainda não foram implementados. O contrato de eventos está pronto em `lib/commands.ts`, com `BID_PLACED`, `BID_CHANGED`, `BID_WITHDRAWN`, `BUYOUT_REQUESTED` e `BUYOUT_CONFIRMED`.

`POST /api/commands` recebe JSON e exige `Authorization: Bearer <access_token>` de um administrador/operador ativo. Não use a chave service-role como bearer da rota e nunca a entregue ao navegador ou a participantes.

```json
{
  "type": "BID_PLACED",
  "eventId": "identificador-global-unico-e-estavel",
  "auctionId": "UUID-DO-LEILAO",
  "participantId": "UUID-DO-PARTICIPANTE",
  "amount": 25.50,
  "occurredAt": "2026-09-13T01:00:00Z"
}
```

- Reenvie exatamente o mesmo corpo e ID após timeout. Mesma identidade e conteúdo retornam o resultado anterior, mesmo após encerramento; reutilização com outro conteúdo/ator é recusada.
- `occurredAt` é opcional no painel; a futura ponte deve enviar a data original do evento. Eventos anteriores à abertura ou à última alteração do participante são recusados. A confirmação e a ordem oficial vêm do banco.
- `BUYOUT_REQUESTED` apenas registra intenção. Somente `BUYOUT_CONFIRMED` fecha a venda; confirmações concorrentes de pessoas diferentes têm apenas um vencedor.
- `BID_PLACED` exige ausência de lance ativo; `BID_CHANGED` e `BID_WITHDRAWN` exigem lance ativo. Retirada não apaga histórico e não reabre vendas.
- `GET /api/dashboard` e `GET /api/export` exigem conta administrativa ativa, inclusive viewer. Exportação e painel usam uma leitura consistente do banco, sem o limite padrão de 1000 linhas do PostgREST.
- O banco disponibiliza `process_auction_command` apenas para service-role; as antigas RPCs de escrita foram desabilitadas para esse papel, evitando contornar as novas regras.

O MVP carrega o conjunto completo do banco em um snapshot consistente. Paginação de telas, filtros de exportação, encerramento automático por agendamento e autenticação específica da ponte são evoluções futuras para volume maior.

## Validação

```bash
npm run typecheck
npm test
npm run build
```

O CI usa PostgreSQL 17 descartável, valida o schema e as regras reais em `tests/auction.sql` e executa `tests/concurrency.py` com conexões independentes. Inclui disputas concorrentes e repetição simultânea do mesmo ARREMATE. `tests/bootstrap.sql` simula somente as primitivas de autenticação fornecidas pelo Supabase; **não execute esse bootstrap em produção**.

Não há integração Baileys completa, cobrança ou envio real implementados nesta etapa.
