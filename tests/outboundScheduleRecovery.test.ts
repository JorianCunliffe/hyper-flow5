import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outboundScheduleRecovery} from '../lib/outboundScheduleRecovery';
import {ActionRecoveryRequired,durableActionExecutor} from '../lib/actionDispatch';
import {failedScheduleResults} from '../lib/scheduler';

test('known provider outage defers with backoff, uncertain/rejected operations hold for review',()=>{
 const now=1000;
 assert.equal(outboundScheduleRecovery(new ActionRecoveryRequired('unavailable','OUTBOUND_NOT_READY'),now)?.retryAfter,901000);
 assert.equal(outboundScheduleRecovery(new ActionRecoveryRequired('held','IDEMPOTENCY_RECONCILIATION_REQUIRED'),now)?.status,'blocked');
 assert.equal(outboundScheduleRecovery(new ActionRecoveryRequired('held','OUTBOUND_PROVIDER_REJECTED'),now)?.status,'failed');
 assert.equal(outboundScheduleRecovery(new Error('unexpected DB failure')),null);
 assert.deepEqual(failedScheduleResults([{scheduleId:'held',status:'blocked'},{scheduleId:'outage',status:'deferred'},{scheduleId:'broken',status:'failed'}]).map(r=>r.scheduleId),['broken']);
});
test('provider hold code survives durable dispatcher and preserves original frozen identity',async()=>{
 let row:any; const keys:string[]=[]; let now=1000;
 const store={transact:async(_org:string,_id:string,fn:any)=>row=fn(row||null)};
 const execute=durableActionExecutor(async(_task,_template,_data,ctx)=>{keys.push(ctx.runId);return {status:'error',error:'held',providerCode:'IDEMPOTENCY_RECONCILIATION_REQUIRED'};},store,()=>now);
 const ctx={orgId:'tenant',projectId:'project',nodeId:'call',runId:'original-operation'};
 for(let i=0;i<2;i++){
  await assert.rejects(execute('outgoing_call','{}',{},ctx),e=>e instanceof ActionRecoveryRequired&&e.providerCode==='IDEMPOTENCY_RECONCILIATION_REQUIRED'); now+=120001;
 }
 assert.deepEqual(keys,['original-operation']); assert.equal(row.outcome,undefined);
});

import {scheduleRunCanBeClaimed} from '../lib/serverStore';
test('held occurrences remain unclaimable after old leases expire; provider backoff is respected',()=>{
 assert.equal(scheduleRunCanBeClaimed({status:'blocked',startedAt:1},999999999),false);
 assert.equal(scheduleRunCanBeClaimed({status:'completed',startedAt:1},999999999),false);
 assert.equal(scheduleRunCanBeClaimed({status:'recoverable',startedAt:1,retryAfter:1000},999),false);
 assert.equal(scheduleRunCanBeClaimed({status:'recoverable',startedAt:1,retryAfter:1000},1000),true);
 assert.equal(scheduleRunCanBeClaimed({status:'running',startedAt:1},120002),true);
});
