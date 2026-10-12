import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { operationalEvent, recordOperationalEvent, operationalLogLocalHealth, logQuery, selectLogPage } from '../lib/operationalLog.js';
import { createOperationalLogHandler } from '../lib/operationalLogApi.js';

test('operational events exclude raw content and credentials, retain correlation and revision evidence',()=>{
  const event=operationalEvent({tenantId:'org_a',type:'project.revision_conflict',runId:'fr_1',operationId:'op:fr_1:n1:1',at:1700000000000,dedupeKey:'stable',details:{expectedRevision:2011,storedRevision:2010,body:'private content',authorization:'Bearer secret',model:'https://host/?apikey=secret',promptVersion:'v1',tokens:42}});
  assert.deepEqual(event.details,{expectedRevision:2011,storedRevision:2010,promptVersion:'v1',tokens:42});
  assert.equal(event.operationId,'op:fr_1:n1:1');
  assert.doesNotMatch(JSON.stringify(event),/private content|Bearer|apikey/);
  assert.equal(event.id,operationalEvent({tenantId:'org_a',type:'project.revision_conflict',at:1700000000000,dedupeKey:'stable'}).id);
  assert.throws(()=>operationalEvent({tenantId:'org_a/other',type:'event.test'}));
});
test('logging failure cannot turn a provider effect into a failed action; health exposes gap',async()=>{
  await assert.doesNotReject(recordOperationalEvent({tenantId:'org_a',type:'action.transition'},async()=>{throw Error('Bearer private');}));
  assert.equal(operationalLogLocalHealth().status,'degraded');
  assert.ok(operationalLogLocalHealth().failedWrites>0);
});
test('bounded filtered pages retain cursor even when no matches and tied timestamps do not skip',()=>{
  const rows=Object.fromEntries(Array.from({length:205},(_,i)=>{const e=operationalEvent({tenantId:'org_a',type:'run.saved',runId:'other',at:1700000000000,dedupeKey:String(i)});return [e.id,e];}));
  const first=selectLogPage(rows,{runId:'target'});
  assert.equal(first.items.length,0);assert.equal(first.scanned,200);assert.ok(first.next);
  const second=selectLogPage(rows,{before:first.next!});
  assert.equal(second.items.length,5);assert.equal(second.next,null);
  assert.throws(()=>logQuery({before:'../../org_b'}));
  assert.throws(()=>logQuery({from:20,to:10}));
});
test('browser roles cannot access operational records directly',()=>{
  const rules=JSON.parse(readFileSync(new URL('../database.rules.json',import.meta.url),'utf8')).rules;
  for(const root of ['operational_events','operational_event_archive','operational_log_health','operational_log_policy']){
    assert.equal(rules[root]['.read'],false);assert.equal(rules[root]['.write'],false);
  }
});
test('timeline API enforces administrator authority and scopes reads to authenticated tenant',async()=>{
  let reads=0;let role='member';
  const handler=createOperationalLogHandler({authenticate:async()=>({uid:'u',orgId:'org_a',role} as any),health:async()=>({status:'ok'} as any),read:async(org,q)=>{reads++;assert.equal(org,'org_a');assert.equal(q.runId,'fr_1');return {items:[],scanned:200,next:'1700000000000_'+'a'.repeat(32)};}});
  const response=()=>({code:0,headers:{} as Record<string,string>,body:null as any,setHeader(k:string,v:string){this.headers[k]=v;},status(c:number){this.code=c;return this;},json(v:any){this.body=v;return this;},send(v:any){this.body=v;return this;}});
  let res=response();await handler({method:'GET',query:{orgId:'org_b',runId:'fr_1'},headers:{}} as any,res as any);
  assert.equal(res.code,403);assert.equal(reads,0);
  role='admin';res=response();await handler({method:'GET',query:{runId:'fr_1',format:'ndjson'},headers:{}} as any,res as any);
  assert.equal(res.code,200);assert.equal(res.body,'');assert.ok(res.headers['X-Next-Cursor']);assert.equal(reads,1);
  res=response();await handler({method:'GET',query:{before:'bad'},headers:{}} as any,res as any);
  assert.equal(res.code,422);assert.equal(reads,1);
});
