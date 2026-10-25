import test from 'node:test';
import assert from 'node:assert/strict';
import {defaultCommonEndInput,validateCommonDeadline} from '../lib/common-deadline.ts';
import {buildDraftState,restoreDraftState} from '../lib/auction-draft.ts';
test('1am default handles midnight in Brasilia rather than server timezone',()=>{
  assert.equal(defaultCommonEndInput(new Date('2026-10-25T02:30:00Z')),'2026-10-25T01:00');
  assert.equal(defaultCommonEndInput(new Date('2026-10-25T04:01:00Z')),'2026-10-26T01:00');
  assert.equal(validateCommonDeadline('2026-10-25T04:00:00Z','2026-10-25T02:00:00Z',200,30),true);
  assert.equal(validateCommonDeadline('2026-10-25T03:00:00Z','2026-10-25T02:00:00Z',200,30),false);
});
test('draft round-trip preserves common cutoff while legacy drafts remain readable',()=>{
  const state=buildDraftState({step:3,firstLot:'1',groupId:'g',intervalValue:'30',intervalUnit:'seconds',publication:'now',scheduledInput:'',endMode:'common',commonEndInput:'2026-10-26T01:00',cards:[{}]});
  assert.deepEqual(restoreDraftState(JSON.parse(JSON.stringify(state))),state);
});
