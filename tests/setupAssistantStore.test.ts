import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createSessionStore} from '../lib/setupAssistant/store';
import {encodeRtdbRecord} from '../lib/rtdbJson';

function fixture(record: any) {
  let listening = false, loaded = false, detached = false;
  const reference = {
    on: () => { listening = true; },
    once: (_: string, ready: () => void) => { loaded = true; ready(); },
    off: () => { listening = false; detached = true; },
    transaction: async (update: (value: any) => any) => {
      // Firebase's first callback sees null unless the reference is hydrated.
      const next = update(listening && loaded ? record : null);
      record = next;
      return {committed: true, snapshot: {val: () => record}};
    }
  };
  const store = createSessionStore(async () => ({ref: (path: string) => {
    assert.equal(path, 'setup_assistant_sessions/org/user/session');
    return reference;
  }}) as any);
  return {store, get detached() { return detached; }};
}

test('a cold session update loads persisted state before checking existence', async () => {
  const f = fixture(encodeRtdbRecord({id:'session',orgId:'org',actor:'user',revision:0,messages:[],requests:{}}));
  const saved = await f.store.update('org','user','session', s => {
    s.messages.push({role:'user',text:'Explain the prompt'}); return s;
  });
  assert.equal(saved.revision,1);
  assert.equal(saved.messages[0].text,'Explain the prompt');
  assert.deepEqual(saved.requests,{});
  assert.equal(f.detached,true);
});

test('missing sessions and rejected updates stay rejected and release listeners', async () => {
  const missing = fixture(null);
  await assert.rejects(missing.store.update('org','user','session', s => s), /Setup session not found/);
  assert.equal(missing.detached,true);
  const stale = fixture(encodeRtdbRecord({revision:3}));
  await assert.rejects(stale.store.update('org','user','session', () => {throw new Error('Revision changed');}), /Revision changed/);
  assert.equal(stale.detached,true);
});
