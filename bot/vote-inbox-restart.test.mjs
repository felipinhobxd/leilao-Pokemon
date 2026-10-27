import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

test('a hard process exit after a simulated commit replays pending votes with stable identity and order', t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'leilao-process-restart-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const script = path.join(directory, 'fixture.mjs');
  const moduleUrl = new URL('./vote-inbox.mjs', import.meta.url).href;
  writeFileSync(script, `
    import assert from 'node:assert/strict';
    import {readFileSync,writeFileSync,existsSync} from 'node:fs';
    import path from 'node:path';
    import {createVoteInbox} from ${JSON.stringify(moduleUrl)};
    const root=process.argv[2], phase=process.argv[3], file=path.join(root,'effects.json');
    const effects=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{accepted:[],attempts:[]};
    const inbox=createVoteInbox({directory:path.join(root,'inbox'),processVote:async message=>{
      const id=message.key.id, update=message.message.pollUpdateMessage;
      assert.equal(update.senderTimestampMs,1793064600123);
      assert.deepEqual(update.vote.encIv,Buffer.from([1,2]));
      assert.deepEqual(update.vote.encPayload,Buffer.from([3,4]));
      effects.attempts.push(id);
      // Models an idempotent command commit whose response/ack is lost.
      if(!effects.accepted.includes(id))effects.accepted.push(id);
      writeFileSync(file,JSON.stringify(effects));
      if(phase==='crash')process.exit(23);
    }});
    if(phase==='crash')for(const id of ['first','second'])inbox.enqueue(
      {key:{id,remoteJid:'isolated-test@g.us',participant:id+'@lid'},pushName:'Synthetic test'},
      {pollUpdateMessage:{pollCreationMessageKey:{id:'isolated-poll'},senderTimestampMs:1793064600123,vote:{encIv:Buffer.from([1,2]),encPayload:Buffer.from([3,4])}}}
    );
    assert.equal(inbox.status().pending,2);
    await inbox.drain();
    assert.equal(inbox.status().pending,0);
    assert.deepEqual(inbox.finalizationGuard(),{safe:true,pollIds:[]});
  `);
  const run = phase => spawnSync(process.execPath, [script, directory, phase], { timeout: 10000, encoding: 'utf8', windowsHide: true });
  const crashed = run('crash');
  assert.equal(crashed.status, 23, crashed.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'effects.json'), 'utf8')), { accepted: ['first'], attempts: ['first'] });
  const recovered = run('recover');
  assert.equal(recovered.status, 0, recovered.stderr);
  assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'effects.json'), 'utf8')), { accepted: ['first', 'second'], attempts: ['first', 'first', 'second'] });
});
