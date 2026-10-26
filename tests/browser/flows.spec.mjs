import {test,expect} from '@playwright/test';
import {deflateSync} from 'node:zlib';
function png(color){const crc=buf=>{let n=0xffffffff;for(const x of buf){n^=x;for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;}return (n^0xffffffff)>>>0;};const chunk=(kind,bytes)=>{const type=Buffer.from(kind);const length=Buffer.alloc(4);length.writeUInt32BE(bytes.length);const hash=Buffer.alloc(4);hash.writeUInt32BE(crc(Buffer.concat([type,bytes])));return Buffer.concat([length,type,bytes,hash]);};const header=Buffer.alloc(13);header.writeUInt32BE(2,0);header.writeUInt32BE(2,4);header[8]=8;header[9]=2;const row=Buffer.from([0,...color,...color]);return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk('IHDR',header),chunk('IDAT',deflateSync(Buffer.concat([row,row]))),chunk('IEND',Buffer.alloc(0))]);}
const photo=(name,color)=>({name,mimeType:'image/png',buffer:png(color)});
test.beforeEach(async({request})=>{await request.post('/__fixture/reset');});

test('vote protection diagnostics show pending/review counts only on demand and remain accessible',async({page,request})=>{
 await request.post('/__fixture/config',{data:{operationResponse:{worker:{online:true,status:'connected',heartbeat:new Date().toISOString(),version:'0.2.11',protectionVersion:1,backup:{},database:{},votes:{pending:2,review:1,issue:'review',at:new Date().toISOString()}}}}});
 await page.goto('/');await page.getByText('Diagnóstico e recuperação da operação',{exact:true}).click();
 expect((await (await request.get('/__fixture/calls')).json()).filter(c=>c.url==='/api/operations')).toHaveLength(0);
 await page.getByRole('button',{name:'Verificar agora',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Proteção dos votos',exact:true})).toBeVisible();
 await expect(page.getByText('Revisão necessária',{exact:true})).toBeVisible();
 await expect(page.getByText('2 voto(s) pendente(s) · 1 para revisão.',{exact:true})).toBeVisible();
 await expect(page.getByText(/sem alterar o prazo de lances/)).toBeVisible();
 await page.getByRole('button',{name:'Auditar acessibilidade local',exact:true}).press('Enter');
 await expect(page.locator('#audit-result')).toHaveText('[]',{timeout:15000});
 expect((await (await request.get('/__fixture/calls')).json()).filter(c=>c.url==='/api/operations')).toHaveLength(1);
});

test('backup confirmation and deferred cleanup are distinct, accessible and fetched only on demand',async({page,request})=>{
 await page.goto('/');await page.getByText('Diagnóstico e recuperação da operação',{exact:true}).click();
 let calls=(await (await request.get('/__fixture/calls')).json()).filter(c=>c.url==='/api/operations');
 expect(calls).toHaveLength(0);
 await page.getByRole('button',{name:'Verificar agora',exact:true}).click();
 const card=page.getByRole('article',{name:'Backup e limpeza automática'});
 await expect(card.getByText('Cópia confirmada na nuvem',{exact:true})).toBeVisible();
 await expect(card.getByText('Limpeza adiada',{exact:true})).toBeVisible();
 await expect(card.getByText(/Há registros novos ou alterados depois da cópia/)).toBeVisible();
 await expect(card.getByText(/não confirma a cobertura dos dados atuais/)).toBeVisible();
 await expect(card.getByText('Válida até',{exact:true})).toBeVisible();
 await page.getByRole('button',{name:'Auditar acessibilidade local',exact:true}).press('Enter');
 await expect(page.locator('#audit-result')).toHaveText('[]',{timeout:15000});
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 calls=(await (await request.get('/__fixture/calls')).json()).filter(c=>c.url==='/api/operations');
 expect(calls).toHaveLength(1);
});

test('unavailable backup metadata and offline legacy supervisor never show a valid copy or current cleanup',async({page,request})=>{
 await request.post('/__fixture/config',{data:{operationResponse:{backupProtection:null,backupReadFailed:true,worker:{online:false,status:'starting',heartbeat:'2026-10-24T03:00:00Z',version:'0.2.8',protectionVersion:0,backup:{},database:{},cleanup:null},sectionsUnavailable:['Proteção do backup']}}});
 await page.goto('/');await page.getByText('Diagnóstico e recuperação da operação',{exact:true}).click();
 await page.getByRole('button',{name:'Verificar agora',exact:true}).click();
 const card=page.getByRole('article',{name:'Backup e limpeza automática'});
 await expect(card.getByText('Confirmação indisponível',{exact:true})).toBeVisible();
 await expect(card.getByText('Ainda não informada',{exact:true})).toBeVisible();
 await expect(card.getByText(/Supervisor sem sinal recente/)).toBeVisible();
 await expect(card.getByText(/próxima manutenção planejada/)).toBeVisible();
 await expect(card.getByText('Cópia confirmada na nuvem',{exact:true})).toHaveCount(0);
 await request.post('/__fixture/config',{data:{operationResponse:{backupProtection:{state:'expired',latestConfirmedAt:'2026-10-23T03:00:00Z',validSnapshotAt:null,validConfirmedAt:null,validUntil:null},backupReadFailed:false,sectionsUnavailable:[]}}});
 await page.getByRole('button',{name:'Atualizar diagnóstico',exact:true}).click();
 await expect(card.getByText('Cópia confirmada vencida',{exact:true})).toBeVisible();
 await expect(card.getByText(/A limpeza aguarda uma nova cópia válida/)).toBeVisible();
});
async function addQuiz(page){await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Pikachu ex');await page.getByLabel('Tipo da carta 1',{exact:true}).selectOption('quiz');await page.getByLabel('Pergunta do quiz',{exact:true}).fill('Qual é a evolução do Pikachu?');await page.getByLabel('Opções da enquete (uma por linha, 2 a 12)',{exact:true}).fill(['Pichu','Raichu','Charizard'].join(String.fromCharCode(10)));await page.getByLabel('Única opção correta',{exact:true}).selectOption('1');}
async function review(page){await page.getByRole('button',{name:'Continuar para valores →',exact:true}).click();await page.getByRole('button',{name:'Continuar para publicação →',exact:true}).click();await page.getByRole('button',{name:'Revisar fila →',exact:true}).click();}
test('type is explicit and correct answer is private in the review',async({page})=>{await addQuiz(page);await expect(page.getByText('Configuração do quiz',{exact:true})).toBeVisible();await page.getByLabel('Tipo da carta 1',{exact:true}).selectOption('giveaway');await expect(page.getByLabel('Pergunta do quiz',{exact:true})).toHaveCount(0);await expect(page.getByLabel('Única opção correta',{exact:true})).toHaveValue('1');await page.getByLabel('Tipo da carta 1',{exact:true}).selectOption('quiz');await expect(page.getByLabel('Pergunta do quiz',{exact:true})).toHaveValue('Qual é a evolução do Pikachu?');await review(page);await page.getByText('Prévia da enquete no WhatsApp',{exact:true}).click();await expect(page.getByText('Raichu · correta (somente no painel)',{exact:true})).toBeVisible();});
test('an uncertain creation resends exactly the same event and time',async({page,request})=>{await request.post('/__fixture/config',{data:{batchFailures:1}});await addQuiz(page);await review(page);await page.getByRole('button',{name:'▶ Iniciar fila agora',exact:true}).click();await expect(page.getByText('Confirmação de publicação pendente',{exact:true})).toBeVisible();await page.getByRole('button',{name:'Confirmar envio anterior',exact:true}).click();await expect(page.getByRole('heading',{name:'0 de 1 publicados'})).toBeVisible();const calls=await (await request.get('/__fixture/calls')).json();const posts=calls.filter(x=>x.url==='/api/auctions/batch');expect(posts).toHaveLength(2);expect(posts[0].body).toEqual(posts[1].body);});
test('a lost response after commit recovers without posting the queue twice',async({page,request})=>{await request.post('/__fixture/config',{data:{batchFailures:1,commitOnFailure:true}});await addQuiz(page);await review(page);await page.getByRole('button',{name:'▶ Iniciar fila agora',exact:true}).click();page.on('dialog',dialog=>dialog.accept());await page.reload();await page.getByRole('button',{name:'Confirmar envio anterior',exact:true}).click();await expect(page.getByRole('heading',{name:'0 de 1 publicados'})).toBeVisible();const calls=await (await request.get('/__fixture/calls')).json();expect(calls.filter(x=>x.url==='/api/auctions/batch')).toHaveLength(1);});
test('saving, adding another detail and reopening preserves both images',async({page,request})=>{await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Pikachu');await page.locator('.draft-fields-extra input[type=file]').setInputFiles(photo('a.png',[255,0,0]));await page.getByRole('button',{name:'💾 Salvar rascunho',exact:true}).click();await expect(page.getByText('Salvo',{exact:true})).toBeVisible();await page.locator('.draft-fields-extra input[type=file]').setInputFiles(photo('b.png',[0,255,0]));await page.getByRole('button',{name:'💾 Salvar rascunho',exact:true}).click();await expect(page.getByText('Salvo',{exact:true})).toBeVisible();const calls=await (await request.get('/__fixture/calls')).json();const posts=calls.filter(x=>x.url==='/api/auctions/drafts'&&x.method==='POST');expect(posts.at(-1).body.state.cards[0].extraImages).toHaveLength(2);await page.reload();await page.getByRole('button',{name:'Abrir',exact:true}).click();await expect(page.getByRole('img',{name:'Detalhe 1',exact:true})).toHaveCount(1);await expect(page.getByRole('img',{name:'Detalhe 2',exact:true})).toHaveCount(1);});
test('large lists keep order, paginate and focus the invalid card',async({page})=>{await page.goto('/auctions/new');for(let i=0;i<13;i++)await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();await expect(page.locator('.draft-card')).toHaveCount(12);await page.getByRole('button',{name:'Continuar para valores →',exact:true}).click();await expect(page.locator('[aria-invalid="true"]')).toBeFocused();await page.getByRole('button',{name:'Próxima →',exact:true}).click();await expect(page.locator('.draft-card')).toHaveCount(1);await expect(page.getByLabel('Tipo da carta 13',{exact:true})).toBeVisible();});
test('dashboard prioritizes operation, filters purchases and passes automated accessibility',async({page})=>{
 test.setTimeout(30000);
 await test.step('open dashboard and confirm main actions',async()=>{await page.goto('/');await expect(page.getByRole('link',{name:'＋ Novo leilão',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Saúde da operação',exact:true})).toBeHidden();});
 await test.step('filter paid and pending purchases',async()=>{await page.getByLabel('Pagamento',{exact:true}).selectOption('paid');await expect(page.getByText('Nenhuma compra encontrada para esses filtros.',{exact:true})).toBeVisible();await page.getByLabel('Pagamento',{exact:true}).selectOption('pending');await expect(page.getByRole('button',{name:/Marcar como recebido/})).toBeVisible();});
 await test.step('run accessibility audit on the complete page',async()=>{const button=page.getByRole('button',{name:'Auditar acessibilidade local',exact:true});/* Keyboard activation also checks the fixture audit control on long mobile pages. */await button.press('Enter');await expect(page.locator('#audit-result')).toHaveText('[]',{timeout:15000});});
 await test.step('verify viewport has no horizontal overflow',async()=>{expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();});
});

test('online worker exposes reconnect while WhatsApp is disconnected',async({page,request})=>{await request.post('/__fixture/config',{data:{workerStatus:'disconnected'}});await page.goto('/whatsapp');await expect(page.getByRole('button',{name:'Reconectar WhatsApp',exact:true})).toBeVisible();await page.getByRole('button',{name:'Reconectar WhatsApp',exact:true}).click();await expect(page.getByText('Comando enviado ao bot.',{exact:true})).toBeVisible();});

test('completed cleanup explains financial protection and reports preserved sales after two confirmations',async({page})=>{
 let submitted;
 await page.route('**/api/auctions/delete-completed',async route=>{submitted=route.request().postDataJSON();await route.fulfill({json:{data:{deleted_auctions:3,preserved_financial_auctions:2}}});});
 await page.goto('/');
 await page.getByRole('button',{name:'Excluir leilões encerrados',exact:true}).press('Enter');
 const dialog=page.getByRole('dialog',{name:'Excluir todos os leilões encerrados'});
 await expect(dialog.getByText(/Vendas com compras, mesmo já pagas, são preservadas/)).toBeVisible();
 const confirm=dialog.getByRole('button',{name:'Excluir encerrados definitivamente',exact:true});
 await expect(confirm).toBeDisabled();
 await dialog.getByLabel(/1ª confirmação/).fill('excluir leilões encerrados');
 await expect(confirm).toBeDisabled();
 await dialog.getByLabel(/2ª confirmação/).fill('quero excluir os encerrados');
 await confirm.press('Enter');
 await expect(page.getByText('3 leilão(ões) encerrado(s) excluído(s) definitivamente. 2 preservado(s) por terem compras vinculadas.',{exact:true})).toBeVisible();
 expect(submitted.confirm1).toBe('excluir leilões encerrados');expect(submitted.confirm2).toBe('quero excluir os encerrados');expect(submitted.eventId).toMatch(/^[a-f0-9-]{36}$/);
});

test('failed full refresh keeps cached data and warning across operation-only success, then recovers',async({page})=>{
 await page.clock.install();let fail=false,operations=0;
 await page.route('**/api/dashboard**',async route=>{
  if(route.request().url().includes('scope=operations')){operations++;await route.continue();}
  else if(fail)await route.fulfill({status:503,json:{error:'Simulated outage'}});
  else await route.continue();
 });
 await page.goto('/');const status=page.getByRole('region',{name:'Atualização do painel'});
 await expect(status.getByText('Painel atualizado',{exact:true})).toBeVisible();
 const timestamp=await status.locator('time').getAttribute('datetime');fail=true;
 await status.getByRole('button',{name:'Atualizar painel',exact:true}).click();
 await expect(status.getByText('Falha ao atualizar o painel',{exact:true})).toBeVisible();
 await expect(page.getByRole('heading',{name:'#1 Pikachu ex',exact:true})).toBeVisible();
 await page.clock.runFor(30_001);await expect.poll(()=>operations).toBeGreaterThan(0);
 await expect(status.getByText('Falha ao atualizar o painel',{exact:true})).toBeVisible();
 await expect(status.locator('time')).toHaveAttribute('datetime',timestamp);
 fail=false;await status.getByRole('button',{name:'Tentar novamente',exact:true}).click();
 await expect(status.getByText('Painel atualizado',{exact:true})).toBeVisible();
 await expect(status.locator('time')).not.toHaveAttribute('datetime',timestamp);
});

test('offline dashboard is visibly distinct from bot state and reconnects with one complete read',async({page,context})=>{
 await page.goto('/');const status=page.getByRole('region',{name:'Atualização do painel'});
 await expect(status.getByText('Painel atualizado',{exact:true})).toBeVisible();
 await context.setOffline(true);
 await expect(status.getByText('Painel sem conexão',{exact:true})).toBeVisible();
 await expect(status.getByRole('button',{name:'Tentar novamente',exact:true})).toBeDisabled();
 await expect(status.getByText('Esta conexão é do painel; o status do bot aparece na área de operação.',{exact:true})).toBeVisible();
 await context.setOffline(false);
 await expect(status.getByText('Painel atualizado',{exact:true})).toBeVisible();
});

test('unsaved bulk navigation can be cancelled without losing typed card data',async({page})=>{
 await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Rascunho protegido');
 await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('link',{name:'Painel',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Sair da criação do leilão?',exact:true});
 await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Continuar editando',exact:true})).toBeFocused();
 await dialog.getByRole('button',{name:'Continuar editando',exact:true}).click();
 await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Rascunho protegido');await expect(page).toHaveURL(/\/auctions\/new$/);
});

test('save-and-leave keeps a draft that can be reopened from a new wizard visit',async({page})=>{
 await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Salvar antes de sair');
 await page.getByRole('link',{name:'← Cancelar',exact:true}).click();
 await page.getByRole('dialog').getByRole('button',{name:'Salvar rascunho e sair',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:3214/');
 await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('link',{name:'Criar leilão',exact:true}).click();
 await page.getByRole('button',{name:'Abrir',exact:true}).click();
 await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Salvar antes de sair');
});

test('failed save-and-leave keeps the wizard and edits available for another try',async({page,request})=>{
 await request.post('/__fixture/config',{data:{draftFailures:1}});
 await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Não perder na falha');
 await page.getByRole('link',{name:'← Cancelar',exact:true}).click();
 const dialog=page.getByRole('dialog');await dialog.getByRole('button',{name:'Salvar rascunho e sair',exact:true}).click();
 await expect(dialog.getByRole('alert')).toContainText('O rascunho não foi salvo por completo');
 await expect(page).toHaveURL(/\/auctions\/new$/);await dialog.getByRole('button',{name:'Continuar editando',exact:true}).click();
 await expect(page.getByLabel('Nome',{exact:true})).toHaveValue('Não perder na falha');
});

test('a fully saved draft leaves without another confirmation',async({page})=>{
 await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Já salvo');await page.getByRole('button',{name:'💾 Salvar rascunho',exact:true}).click();
 await expect(page.getByText('Salvo',{exact:true})).toBeVisible();
 await page.getByRole('navigation',{name:'Navegação principal'}).getByRole('link',{name:'Painel',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:3214/');await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('single wizard confirms intentional discard and never publishes while navigating away',async({page,request})=>{
 await page.goto('/single');await page.getByLabel('Nome',{exact:true}).fill('Cadastro único');
 await page.getByRole('link',{name:'← Cancelar',exact:true}).click();
 const dialog=page.getByRole('dialog');await expect(dialog.getByRole('button',{name:'Salvar rascunho e sair',exact:true})).toHaveCount(0);
 await dialog.getByRole('button',{name:'Sair sem salvar alterações',exact:true}).click();
 await expect(page).toHaveURL('http://127.0.0.1:3214/');
 const calls=await(await request.get('/__fixture/calls')).json();expect(calls.filter(c=>c.url==='/api/auctions/new'&&c.method==='POST')).toHaveLength(0);
});

test('bulk selection survives pagination, filtering and reordering and saves only selected changes',async({page,request})=>{
 await page.goto('/auctions/new');for(let i=0;i<13;i++)await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Pikachu');await page.getByRole('checkbox',{name:'Selecionar carta 1',exact:true}).check();
 await page.getByRole('button',{name:'Próxima →',exact:true}).click();await page.locator('.draft-card').getByRole('button',{name:'Editar',exact:true}).click();
 await page.getByLabel('Nome',{exact:true}).fill('Eevee');await page.getByRole('checkbox',{name:'Selecionar carta 13',exact:true}).check();
 const editor=page.getByRole('region',{name:'Editar cartas selecionadas'});
 await expect(editor.getByText('2 cartas selecionadas · 1 fora desta página',{exact:true})).toBeVisible();
 await page.getByLabel('Buscar carta',{exact:true}).fill('Eevee');
 await editor.getByLabel('Idioma a aplicar',{exact:true}).selectOption('ja');
 await editor.getByRole('button',{name:'Aplicar em 2 cartas',exact:true}).click();
 await expect(editor.getByRole('status').filter({hasText:'Última aplicação:'})).toContainText('2 cartas alteradas');
 await page.getByLabel('Buscar carta',{exact:true}).fill('');await page.getByRole('button',{name:'Próxima →',exact:true}).click();
 await page.getByRole('button',{name:'Mover carta 13 para cima',exact:true}).click();await page.getByRole('button',{name:'← Anterior',exact:true}).click();
 await expect(page.getByRole('checkbox',{name:'Selecionar carta 12',exact:true})).toBeChecked();
 await page.getByRole('button',{name:'💾 Salvar rascunho',exact:true}).press('Enter');await expect(page.getByText('Salvo',{exact:true})).toBeVisible();
 const calls=await(await request.get('/__fixture/calls')).json();const saved=calls.filter(c=>c.url==='/api/auctions/drafts'&&c.method==='POST').at(-1).body.state.cards;
 expect(saved).toHaveLength(13);expect(saved[0].name).toBe('Pikachu');expect(saved[11].name).toBe('Eevee');
 expect(saved.filter(c=>c.language==='ja').map(c=>c.name)).toEqual(['Pikachu','Eevee']);expect(saved.filter(c=>c.language==='pt-BR')).toHaveLength(11);
});

test('shared editing and undo keep quiz answer and a later typed card name',async({page})=>{
 await addQuiz(page);await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();
 await page.locator('.draft-card').nth(1).getByRole('button',{name:'Editar',exact:true}).click();await page.locator('.draft-card').nth(1).getByLabel('Nome',{exact:true}).fill('Leilão');
 const editor=page.getByRole('region',{name:'Editar cartas selecionadas'});await editor.getByRole('button',{name:'Selecionar esta página',exact:true}).click();
 await editor.getByLabel('Campo para as selecionadas',{exact:true}).selectOption('variant');await editor.getByLabel('Variante a aplicar',{exact:true}).fill('Holo');
 await editor.getByRole('button',{name:'Aplicar em 2 cartas',exact:true}).click();
 await expect(page.locator('.draft-card').nth(0).getByLabel('Variante',{exact:true})).toHaveValue('Holo');
 await page.locator('.draft-card').nth(1).getByLabel('Nome',{exact:true}).fill('Nome editado depois');
 await editor.getByRole('button',{name:'Desfazer última aplicação',exact:true}).click();
 await expect(page.locator('.draft-card').nth(0).getByLabel('Variante',{exact:true})).toHaveValue('Normal');
 await expect(page.locator('.draft-card').nth(1).getByLabel('Nome',{exact:true})).toHaveValue('Nome editado depois');
 await expect(page.getByLabel('Única opção correta',{exact:true})).toHaveValue('1');await expect(page.getByLabel('Tipo da carta 1',{exact:true})).toHaveValue('quiz');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBeTruthy();
 await page.getByRole('button',{name:'Auditar acessibilidade local',exact:true}).press('Enter');await expect(page.locator('#audit-result')).toHaveText('[]',{timeout:15000});
});

test('an invalid bulk price rejects the entire selection instead of applying a partial edit',async({page})=>{
 await page.goto('/auctions/new');await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();await page.getByLabel('Nome',{exact:true}).fill('Primeira');
 await page.getByRole('button',{name:'Adicionar sem imagem',exact:true}).click();await page.locator('.draft-card').nth(1).getByRole('button',{name:'Editar',exact:true}).click();await page.locator('.draft-card').nth(1).getByLabel('Nome',{exact:true}).fill('Segunda');
 await page.getByRole('button',{name:'Continuar para valores →',exact:true}).click();await page.locator('.value-row').nth(1).getByLabel('ARREMATE',{exact:true}).fill('8');
 const editor=page.getByRole('region',{name:'Editar cartas selecionadas'});await editor.getByRole('button',{name:'Selecionar resultados (2)',exact:true}).click();
 await editor.getByLabel('Campo para as selecionadas',{exact:true}).selectOption('startingPrice');await editor.getByLabel('Valor a aplicar',{exact:true}).fill('10');
 await editor.getByRole('button',{name:'Aplicar em 2 cartas',exact:true}).click();await expect(editor.getByRole('alert')).toContainText('enquete inválida');
 await expect(page.locator('.value-row').nth(0).getByLabel('Inicial',{exact:true})).toHaveValue('5');await expect(page.locator('.value-row').nth(1).getByLabel('Inicial',{exact:true})).toHaveValue('5');
});
