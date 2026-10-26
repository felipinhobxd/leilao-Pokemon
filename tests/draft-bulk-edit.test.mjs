import test from 'node:test';import assert from 'node:assert/strict';
import {applyDraftBulkEdit,undoDraftBulkEdit} from '../lib/draft-bulk-edit.ts';
import {cardConditions} from '../lib/auction-wizard.ts';
function card(id,extra={}){return {id,name:id,giveaway:false,language:'pt-BR',condition:cardConditions[0],variant:'Normal',pricingMode:'increment',startingPrice:'5',increment:'1',buyout:'',optionCount:'6',durationMinutes:'2',customValues:'',customBuyoutLast:true,lotNumber:id,cardNumber:'7/100',imageUrl:'https://example.invalid/'+id,extraFiles:[{name:id}],giveawayQuestion:'Pergunta '+id,giveawayCorrectIndex:'1',...extra};}

test('200-card selection follows IDs after reordering and only changes the selected shared field',()=>{
 const cards=Array.from({length:200},(_,index)=>card(String(index+1)));const ordered=[cards[199],...cards.slice(0,199)];
 const result=applyDraftBulkEdit(ordered,new Set(['1','200']),{field:'language',value:'ja'});
 assert.deepEqual(result.cards.map(c=>c.id),ordered.map(c=>c.id));assert.equal(result.changes.length,2);
 assert.equal(result.cards.filter(c=>c.language==='ja').length,2);assert.equal(result.cards[2],ordered[2]);
 for(const value of result.cards){const original=ordered.find(c=>c.id===value.id);assert.equal(value.extraFiles,original.extraFiles);assert.equal(value.cardNumber,original.cardNumber);assert.equal(value.imageUrl,original.imageUrl);assert.equal(value.giveawayQuestion,original.giveawayQuestion);}
});

test('automatic pricing skips quizzes, giveaways and custom-price auctions',()=>{
 const cards=[card('auto'),card('custom',{pricingMode:'custom',customValues:'1, 2, 5'}),card('quiz',{giveaway:true,giveawayKind:'quiz'}),card('gift',{giveaway:true,giveawayKind:'giveaway'})];
 const result=applyDraftBulkEdit(cards,new Set(cards.map(c=>c.id)),{field:'startingPrice',value:'7,50'});
 assert.equal(result.cards[0].startingPrice,'7.5');assert.equal(result.skipped,3);for(let i=1;i<4;i++)assert.equal(result.cards[i],cards[i]);
 assert.throws(()=>applyDraftBulkEdit(cards,new Set(['quiz']),{field:'increment',value:'1'}),/Nenhuma selecionada/);
 assert.throws(()=>applyDraftBulkEdit([card('buyout',{buyout:'10'})],new Set(['buyout']),{field:'optionCount',value:'12'}),/Nenhuma selecionada/);
});

test('a price conflict in one target rejects the complete operation without mutating any card',()=>{
 const cards=[card('first'),card('second',{buyout:'8'})],original=structuredClone(cards);
 assert.throws(()=>applyDraftBulkEdit(cards,new Set(['first','second']),{field:'startingPrice',value:'10'}),/enquete inválida/);
 assert.deepEqual(cards,original);
 for(const value of ['','NaN','-1','1e3','1.234','10000000000'])assert.throws(()=>applyDraftBulkEdit(cards,new Set(['first']),{field:'startingPrice',value}));
});

test('explicit custom values validate options and never change quiz answers',()=>{
 const cards=[card('auction'),card('game',{giveaway:true})],ids=new Set(['auction','game']);
 const result=applyDraftBulkEdit(cards,ids,{field:'customValues',value:'1, 2, 5, 10',buyoutLast:false});
 assert.equal(result.cards[0].pricingMode,'custom');assert.equal(result.cards[0].customBuyoutLast,false);assert.equal(result.cards[1],cards[1]);
 assert.throws(()=>applyDraftBulkEdit(cards,ids,{field:'customValues',value:'5, 5, 3',buyoutLast:true}));
});

test('copy only shares configuration; identity, media, card type and game answers stay individual',()=>{
 const source=card('source',{language:'en',variant:'Holo',startingPrice:'10',durationMinutes:'9'}),target=card('target'),game=card('game',{giveaway:true,giveawayKind:'quiz'});
 const result=applyDraftBulkEdit([source,target,game],new Set(['target','game']),{field:'copy',sourceId:'source'});
 assert.equal(result.cards[1].startingPrice,'10');assert.equal(result.cards[1].durationMinutes,'2');assert.equal(result.cards[2].startingPrice,'5');
 for(const [index,original] of [[1,target],[2,game]]){const updated=result.cards[index];assert.equal(updated.language,'en');assert.equal(updated.variant,'Holo');for(const key of ['id','name','cardNumber','lotNumber','imageUrl','extraFiles','giveaway','giveawayQuestion','giveawayCorrectIndex'])assert.equal(updated[key],original[key],key);}
 const fromGame=applyDraftBulkEdit([source,game],new Set(['source']),{field:'copy',sourceId:'game'},{allowDuration:true});assert.equal(fromGame.cards[0].giveaway,false);assert.equal(fromGame.cards[0].startingPrice,'10');
 for(const field of ['name','id','imageUrl','giveawayCorrectIndex','lotNumber'])assert.throws(()=>applyDraftBulkEdit([source,target],new Set(['target']),{field,value:'not allowed'}),/não pode ser alterado/);
});

test('undo preserves later edits, uploads, deletions and the current ordering',()=>{
 const original=[card('a'),card('b'),card('deleted')];const applied=applyDraftBulkEdit(original,new Set(['a','b','deleted']),{field:'variant',value:'Holo'});
 const newFiles=[{name:'new-upload'}];const later=[{...applied.cards[1],variant:'Promo'},{...applied.cards[0],name:'Edited after apply',extraFiles:newFiles}];
 const undo=undoDraftBulkEdit(later,applied.changes);
 assert.deepEqual(undo.cards.map(c=>c.id),['b','a']);assert.equal(undo.cards[0].variant,'Promo');assert.equal(undo.cards[1].variant,'Normal');assert.equal(undo.cards[1].extraFiles,newFiles);assert.equal(undo.cards[1].name,'Edited after apply');assert.equal(undo.restored,1);assert.equal(undo.conflicts,1);
 const price=applyDraftBulkEdit([card('p',{buyout:'10'})],new Set(['p']),{field:'buyout',value:'12'});
 const changed=[{...price.cards[0],startingPrice:'11'}];assert.deepEqual(undoDraftBulkEdit(changed,price.changes).cards,changed);
});

test('individual duration is gated by the common deadline and applies to custom-price auctions',()=>{
 const cards=[card('c',{pricingMode:'custom',customValues:'1, 2, 5'}),card('q',{giveaway:true})],ids=new Set(['c','q']);
 assert.throws(()=>applyDraftBulkEdit(cards,ids,{field:'durationMinutes',value:'5'}),/encerramento comum/);
 const result=applyDraftBulkEdit(cards,ids,{field:'durationMinutes',value:'5'},{allowDuration:true});assert.equal(result.cards[0].durationMinutes,'5');assert.equal(result.cards[1],cards[1]);
});
