import test from 'node:test';
import assert from 'node:assert/strict';
import {parsePollGame} from '../lib/poll-game.ts';
import {buildDraftState,restoreDraftState} from '../lib/auction-draft.ts';

test('games require exactly one selected correct answer, unique options and a named prize',()=>{
  const base={kind:'quiz',question:'Evolução do Pikachu?',prizeName:'Pikachu ex',options:['Raichu','Pichu'],correctIndex:0};
  assert.equal(parsePollGame(base).correctIndex,0);
  for(const patch of [{correctIndex:null},{correctIndex:'0'},{correctIndex:-1},{correctIndex:2},{options:['A','A']},{options:['A']},{question:''},{prizeName:''}])assert.throws(()=>parsePollGame({...base,...patch}));
  assert.equal(parsePollGame({...base,kind:'giveaway',question:''}).kind,'giveaway');
  assert.equal(parsePollGame({...base,kind:'legacy',correctIndex:null,prizeName:''}).correctIndex,null);
});

test('quiz type, question and correct index survive draft save/restore without new schema version',()=>{
 const state=buildDraftState({step:2,firstLot:'1',groupId:'g',intervalValue:'30',intervalUnit:'seconds',publication:'now',scheduledInput:'',cards:[{name:'Pikachu',giveaway:true,giveawayKind:'quiz',giveawayQuestion:'Quem evolui?',giveawayCorrectIndex:'1',giveawayOptions:'A\nB'}]});
 const restored=restoreDraftState(JSON.parse(JSON.stringify(state)));
 assert.equal(restored.cards[0].giveawayKind,'quiz');assert.equal(restored.cards[0].giveawayQuestion,'Quem evolui?');assert.equal(restored.cards[0].giveawayCorrectIndex,'1');
});
