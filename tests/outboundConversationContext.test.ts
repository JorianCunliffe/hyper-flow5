import test from 'node:test';
import assert from 'node:assert/strict';
import {outboundConversationContext} from '../lib/outboundConversationContext.js';
const input={orgId:'tenant',projectId:'alpha',to:'+61400000111'};
const profile:any={primaryPersonId:'ceo',allowedProjectIds:['alpha'],conversation:{voicePrompt:'Speak briefly'}};
test('outbound context does not fetch history for another recipient or denied project',async()=>{
  let reads=0;
  const client:any={listPeople:async()=>[{id:'other',phone:input.to}],listCommunications:async()=>{reads++;throw new Error('must not read')}};
  assert.equal((await outboundConversationContext(input,client,async()=>profile)).status,'unavailable');
  assert.equal(reads,0);
  client.listPeople=async()=>[{id:'ceo',phone:input.to}];
  assert.equal((await outboundConversationContext({...input,projectId:'beta'},client,async()=>profile)).status,'unavailable');
  assert.equal(reads,0);
});
test('outbound history opt-out and lookup failure explicitly forbid guessing',async()=>{
  const client:any={listPeople:async()=>{throw new Error('unavailable')}};
  const disabled=await outboundConversationContext(input,client,async()=>({...profile,conversation:{historyEnabled:false}}));
  assert.equal(disabled.status,'disabled');assert.deepEqual(disabled.sources,[]);assert.match(disabled.instructions,/Never invent or guess/);
  const missing=await outboundConversationContext(input,client,async()=>profile);
  assert.equal(missing.status,'unavailable');assert.match(missing.instructions,/cannot verify/);
});
test('duplicate phone identities never select a contact by array order',async()=>{
 const client:any={listPeople:async()=>[{id:'ceo',phone:input.to},{id:'other',phone:input.to}]};
 assert.deepEqual((await outboundConversationContext(input,client,async()=>profile)).sources,[]);
});

test('contact fields remain available with history disabled and provider metadata is excluded', async () => {
  const client: any = { listPeople: async () => [{ id: 'ceo', name: 'Jorian', phone: input.to, email: 'name@example.com', secret: 'hidden' }],
    listCommunications: async () => { throw new Error('History must not be read'); } };
  const result = await outboundConversationContext({ ...input, contactContext: true, historyScope: 'project' }, client,
    async () => ({ ...profile, conversation: { historyEnabled: false } }));
  assert.deepEqual(result.recipient, { id: 'ceo', name: 'Jorian', phone: input.to, email: 'name@example.com' });
  assert.equal(result.status, 'disabled');
  assert.ok(!result.instructions.includes('hidden'));
});

test('explicit thread and project scope use only the authorized recipient; no-history avoids evidence reads', async () => {
  const client: any = { listPeople: async () => [{ id: 'ceo', name: 'Jorian', phone: input.to }] };
  const reads: any[] = [];
  const evidence: any = async (request: any) => { reads.push(request); return { status: 'current', sources: [], truncated: false }; };
  const readProfile = async () => profile;
  await outboundConversationContext({ ...input, contactContext: true, historyScope: 'none' }, client, readProfile, evidence);
  assert.equal(reads.length, 0);
  await outboundConversationContext({ ...input, historyScope: 'thread', threadId: 'thread-1' }, client, readProfile, evidence);
  assert.equal(reads[0].threadId, 'thread-1');
  assert.equal(reads[0].strictThread, true);
  assert.equal(reads[0].personId, 'ceo');
  assert.equal(reads[0].projectId, 'alpha');
  await outboundConversationContext({ ...input, historyScope: 'project' }, client, readProfile, evidence);
  assert.equal(reads[1].threadId, undefined);
  const denied = await outboundConversationContext({ ...input, projectId: 'beta', contactContext: true, historyScope: 'thread', threadId: 'thread-1' }, client, readProfile, evidence);
  assert.equal(denied.recipient, undefined);
  assert.equal(reads.length, 2);
});
