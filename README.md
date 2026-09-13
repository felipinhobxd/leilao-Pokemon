# Leilão Pokémon

Sistema para gerenciar leilões de cartas Pokémon integrados ao WhatsApp, com painel administrativo, histórico auditável, banco no Supabase e exportação para Excel.

## Estado atual

Primeira fundação do projeto:

- painel responsivo com visão do leilão atual;
- domínio inicial de cartas, leilões e eventos;
- endpoint de saúde em `/api/health`;
- exportação `.xlsx` de demonstração em `/api/export`;
- cliente Supabase separado entre uso público e servidor;
- schema PostgreSQL completo em `supabase/schema.sql`;
- RLS habilitado em todas as tabelas expostas e acesso público negado por padrão;
- funções atômicas para lance e ARREMATE, com idempotência por evento externo;
- trilha de auditoria (`auction_events`), compras, pagamentos e entregas separados.

> Os dados exibidos no painel ainda são demonstrativos. O próximo passo é conectar a interface ao projeto Supabase real e depois validar a integração de enquete com Baileys antes de usá-la em leilões reais.

## Arquitetura

```text
WhatsApp -> Bot/Baileys -> Backend confiável -> Supabase/PostgreSQL -> Painel
                                                     |
                                                     -> Excel (.xlsx)
```

O Supabase é a fonte oficial da verdade. WhatsApp é a interface dos participantes e Excel é uma camada de relatório/exportação.

## Desenvolvimento

Requer Node.js 22+.

```bash
npm install
cp .env.example .env.local
npm run dev
```

Abra `http://localhost:3000`.

## Variáveis de ambiente

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Nunca exponha `SUPABASE_SERVICE_ROLE_KEY` no navegador ou em código público.

## Banco

`supabase/schema.sql` descreve a primeira versão do banco. Ele foi projetado com:

- uma única disputa ativa por carta;
- um único lance ativo por participante/leilão;
- IDs externos para tornar eventos do WhatsApp idempotentes;
- ARREMATE protegido por lock de linha no PostgreSQL;
- histórico que não depende de apagar lances antigos;
- RLS e default-deny enquanto a autenticação do painel ainda não foi implementada.

## Próximas etapas

1. Criar/vincular projeto Supabase real e aplicar o schema.
2. Criar autenticação administrativa e políticas RLS específicas.
3. Trocar dados demonstrativos pelo Realtime do Supabase.
4. Fazer prova de conceito isolada com Baileys: criar enquete, votar, trocar voto, remover voto e recuperar após reinício.
5. Implementar bot apenas depois dessa validação.
6. Completar exportações Excel com filtros e dados reais.
