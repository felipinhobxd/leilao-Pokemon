import test from 'node:test';
import assert from 'node:assert/strict';
import {createSerialCycle} from './serial-cycle.mjs';
test('a later scheduler tick waits for the entire opening instead of publishing early',async()=>{
 let release;const gate=new Promise(r=>release=r);const calls=[];
 const run=createSerialCycle(async()=>{calls.push('rules');await gate;calls.push('mention');calls.push('dispatch');});
 const first=run(),second=run();assert.equal(first,second);await Promise.resolve();assert.deepEqual(calls,['rules']);
 release();await Promise.all([first,second]);assert.deepEqual(calls,['rules','mention','dispatch']);
 await run();assert.equal(calls.length,6);
});
test('a failed cycle releases the lock for recovery',async()=>{let n=0;const run=createSerialCycle(async()=>{if(!n++)throw Error('offline');return 'ok';});await assert.rejects(run());assert.equal(await run(),'ok');});
