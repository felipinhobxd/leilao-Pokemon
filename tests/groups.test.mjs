import test from 'node:test';
import assert from 'node:assert/strict';
import { syncParticipatingGroups } from '../bot/groups.mjs';

test('syncParticipatingGroups uses Baileys participating groups and stable JIDs', async () => {
  let rpcPayload = null;
  const sock = {
    async groupFetchAllParticipating() {
      return {
        '111@g.us': { id: '111@g.us', subject: 'Grupo A' },
        '222@g.us': { id: '222@g.us', subject: 'Grupo B Renomeado' },
      };
    },
  };
  const db = {
    async rpc(name, payload) {
      assert.equal(name, 'sync_whatsapp_groups');
      rpcPayload = payload;
      return { data: { count: 2, synced_at: '2026-09-13T04:00:00.000Z' }, error: null };
    },
  };

  const result = await syncParticipatingGroups(sock, db);
  assert.deepEqual(rpcPayload, {
    p_groups: [
      { id: '111@g.us', name: 'Grupo A' },
      { id: '222@g.us', name: 'Grupo B Renomeado' },
    ],
  });
  assert.equal(result.count, 2);
});
