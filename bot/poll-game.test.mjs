import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {handleGameVote,selectedGameOption,prizeWinnerText} from './poll-game.mjs';
const hash=x=>createHash('sha256').update(x).digest();

test('only a single matching encrypted answer is eligible; wrong/empty/multiple votes are ignored',()=>{
 const options=['Raichu','Pichu'];assert.equal(selectedGameOption(options,{selectedOptions:[hash('Raichu')]}),0);
 for(const selectedOptions of [[],[hash('Unknown')],[hash('Raichu'),hash('Pichu')]])assert.equal(selectedGameOption(options,{selectedOptions}),-1);
});
test('first confirmed correct vote claims once, ignores later changes and resumes from persisted winner',async()=>{
 const calls=[];const poll={id:'p',options:['A','B'],correct_index:1,game_kind:'quiz'};
 const deps={db:{async rpc(name,args){calls.push({name,args});return {data:{won:true,finished:true}}}},poll,resolveIdentity:async()=>({id:'identity'}),ensureParticipant:async()=>({id:'person'}),eventTime:()=>new Date().toISOString()};
 assert.equal(await handleGameVote({...deps,pollUpdate:{vote:{selectedOptions:[hash('A')]}}}),false);assert.equal(calls.length,0);
 const update={vote:{selectedOptions:[hash('B')]},senderTimestampMs:Date.now(),pollUpdateMessageKey:{id:'vote-id'}};
 assert.equal(await handleGameVote({...deps,pollUpdate:update}),true);assert.equal(calls.length,1);assert.equal(calls[0].args.p_option_index,1);
 assert.equal(await handleGameVote({...deps,pollUpdate:update}),false);assert.equal(calls.length,1);
 assert.equal(await handleGameVote({...deps,poll:JSON.parse(JSON.stringify(poll)),pollUpdate:update}),false);
 assert.equal(prizeWinnerText('Maria','Pikachu ex'),'🎉 Parabéns, Maria, você acertou e ganhou Pikachu ex!');
});
test('RPC failure never caches a winner, allowing the same event to be retried',async()=>{
 const poll={id:'p',options:['A','B'],correct_index:0,game_kind:'giveaway'};
 await assert.rejects(handleGameVote({db:{async rpc(){return {error:{message:'network'}}}},poll,pollUpdate:{vote:{selectedOptions:[hash('A')]},pollUpdateMessageKey:{id:'v'}},resolveIdentity:async()=>({}),ensureParticipant:async()=>({id:'p'}),eventTime:()=>new Date().toISOString()}));
 assert.equal(poll.winner_event_id,undefined);
});
