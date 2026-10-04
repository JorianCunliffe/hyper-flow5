import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { HttpCommunicationsClient } from '../../lib/communications/client';
import { handleThreadRegisterRequest } from '../../lib/communications/threadRegister';

test('Phase 02: HyperFlow proxy and HTTP client use canonical Communications SQL state', async () => {
  assert.ok(process.env.PHASE02_COMMUNICATIONS_CHECKOUT, 'Set PHASE02_COMMUNICATIONS_CHECKOUT to the matching source checkout');
  const cs = process.env.PHASE02_COMMUNICATIONS_CHECKOUT!;
  const fixture = JSON.parse(await readFile(new URL('../../contracts/threading.v1.json', import.meta.url), 'utf8'));
  assert.deepEqual(fixture, JSON.parse(await readFile(resolve(cs,'contracts/threading.v1.json'),'utf8')));
  const { createPhase02Database } = await import(pathToFileURL(resolve(cs,'test/fixtures/phase02Database.js')).href);
  const key = 'local-phase02-contract-only';
  const { app, sql, close } = await createPhase02Database(fixture.tenant,key);
  try {
    const address = await app.listen({host:'127.0.0.1',port:0});
    const client = new HttpCommunicationsClient({baseUrl:address,apiKey:key});
    await sql.query("insert into tenants (tenant_id) values ('unrelated_tenant')");
    await sql.query('insert into phone_configs (tenant_id,twilio_number,call_enabled,inbound_call_prompt) values ($1,$2,true,$3),($1,$4,false,$3),($5,$6,true,$3)',
      [fixture.tenant,'+61400000001','private prompt never returned','+61400000002','unrelated_tenant','+61400000003']);
    const receptionLines = await client.listReceptionLines(fixture.tenant);
    assert.deepEqual(receptionLines.sort((a,b)=>a.identity.localeCompare(b.identity)), [
      {identity:'+61400000001',enabled:true}, {identity:'+61400000002',enabled:false}
    ]);
    await assert.rejects(client.listReceptionLines('unrelated_tenant'));
    const raw = async (path:string,body:any) => {
      const response = await fetch(address+'/v1/'+path,{method:'POST',headers:{'X-API-Key':key,'X-Tenant-Id':fixture.tenant,'Content-Type':'application/json'},body:JSON.stringify(body)});
      const data = await response.json(); assert.equal(response.ok,true,JSON.stringify(data)); return data;
    };
    await raw('contacts',fixture.person);
    const journey = [];
    for (const communication of fixture.journey) journey.push(await raw('communications',{...communication,direction:'inbound'}));
    const unrelated = await raw('communications',{...fixture.unrelated,direction:'inbound'});
    assert.equal(new Set(journey.map(row=>row.thread_id)).size,1);
    assert.notEqual(unrelated.thread_id,journey[0].thread_id);
    const member = {orgId:fixture.tenant,uid:'verified_fixture_ceo'};
    const dependencies = {client,listProjects:async()=>[{id:'alpha'},{id:'beta'}]};
    const proxy = (action:string,method:string,body?:any,query?:any) => handleThreadRegisterRequest(action,{method,body,query},member,dependencies) as Promise<any>;
    const before = await proxy('thread_register','GET',undefined,{status:'all'});
    assert.equal(before.data.length,2);
    assert.deepEqual(new Set(before.data.find((row:any)=>row.thread_id===journey[0].thread_id).communications.map((row:any)=>row.channel)),new Set(['email','sms','voice']));
    const candidates = await proxy('thread_candidates','GET',undefined,{communicationId:journey[1].communication_id});
    assert.ok(candidates.candidates.length);
    const moved = await proxy('thread_correction','POST',{...fixture.correction,communicationId:journey[1].communication_id,initiator_id:'forged'});
    assert.notEqual(moved.thread_id,journey[0].thread_id);
    await proxy('thread_update','PATCH',{threadId:moved.thread_id,title:'CEO reviewed follow-up'});
    const refreshed = await proxy('thread_register','GET',undefined,{threadId:moved.thread_id,status:'all'});
    assert.equal(refreshed.data[0].title,'CEO reviewed follow-up');
    assert.equal(refreshed.data[0].communications[0].communication_id,journey[1].communication_id);
    const audit = (await sql.query('select actor_id from thread_resolution_feedback where communication_id=$1',[journey[1].communication_id])).rows[0];
    assert.deepEqual(JSON.parse(audit.actor_id),{client_id:'legacy',user_id:'verified_fixture_ceo'});
    assert.equal((await client.getCommunication(fixture.tenant,journey[0].communication_id)).threadId,journey[0].thread_id);
    assert.equal((await client.getCommunication(fixture.tenant,journey[2].communication_id)).threadId,journey[0].thread_id);
    assert.equal((await sql.query('select count(*)::int as count from outbound_operations')).rows[0].count,0);
    await assert.rejects(client.listThreadRegister('another_tenant'));
  } finally { await close(); }
});
