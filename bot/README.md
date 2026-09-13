# Bot WhatsApp — Leilão Pokémon

Este processo roda no PC durante os leilões. Ele não deve ser hospedado no Netlify/Vercel.

## O que ele faz

- lê os disparos programados no Supabase;
- envia a foto/texto da carta;
- cria uma enquete de voto único;
- acompanha votos e mudanças de voto;
- registra lance, troca, retirada e ARREMATE no banco;
- encerra automaticamente leilões com `scheduled_end_at` vencido;
- anuncia ARREMATE e resultado final no grupo.

## Instalação

Use Node.js 24+.

```powershell
cd bot
npm.cmd install
copy .env.example .env
notepad .env
npm.cmd start
```

Preencha `.env` com:

- `SUPABASE_URL`: URL do projeto;
- `SUPABASE_SERVICE_ROLE_KEY`: chave privada do servidor. Nunca envie ao navegador nem ao GitHub;
- `BOT_ADMIN_USER_ID`: UUID de um `admin` ou `operator` ativo;
- `BOT_WORKER_ID`: identificador livre, por exemplo `pc-leilao-01`;
- `WHATSAPP_SESSION_DIR`: pode apontar para a sessão já usada no leitor antigo.

Exemplo no Windows, reaproveitando a sessão existente:

```env
WHATSAPP_SESSION_DIR=C:/Users/Admin/Documents/LeilaoPokemon/leitor-whatsapp/sessao
```

Antes de iniciar, feche o `monitor.mjs` antigo. Duas instâncias usando a mesma sessão podem gerar o erro `440 connectionReplaced`.

## Teste

1. Mantenha o bot aberto.
2. Entre no painel web com sua conta administrativa.
3. Crie uma carta e um leilão em rascunho.
4. Abra `/whatsapp` no site.
5. Selecione o leilão, os valores e um horário alguns minutos à frente.
6. Deixe o bot aberto. No horário programado ele envia a carta e a enquete.
7. Vote pelo WhatsApp e acompanhe os lances no painel principal.

O grupo `teste` (`120363429348829532@g.us`) já está configurado no banco de desenvolvimento atual.

## Aviso

Baileys é uma integração não oficial com o WhatsApp. Use um número separado para o bot quando possível e mantenha o volume de automação moderado.
