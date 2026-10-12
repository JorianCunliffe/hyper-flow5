import test from 'node:test';
import assert from 'node:assert/strict';
import {createScheduleRecovery, nextRecoveryTime, recoveryProviderKey, requireRecoveryAdministrator, readProvider} from '../lib/scheduleRecovery.js';
import {encodeRtdbRecord,decodeRtdbRecord} from '../lib/rtdbJson.js';
import {manualRecoveryOccurrence} from '../lib/outboundScheduleRecovery.js';
import {scheduleRunCanBeClaimed} from '../lib/serverStore.js';
import {actionAttemptIdentity} from '../lib/flowOrchestrator.js';

test('only a missing operation receipt proves pre-dispatch failure; missing detail and outages remain uncertain',async()=>{
 const row={id:'op:original',orgId:'org',providerCode:'OUTBOUND_NOT_READY'};
 const missing=async()=>{throw Object.assign(new Error('Missing'),{status:404});};
 assert.equal((await readProvider(row,{readCallOperation:missing} as any)).outcome,'not_dispatched');
 assert.equal((await readProvider({...row,providerCode:undefined},{readCallOperation:missing} as any)).outcome,'unknown');
 assert.equal((await readProvider(row,{readCallOperation:async()=>({status:'dispatched',communication_id:'existing'}),getCommunication:missing} as any)).outcome,'unknown');
 assert.equal((await readProvider(row,{readCallOperation:async()=>{throw Object.assign(new Error('Unauthorized'),{status:403});}} as any)).outcome,'unknown');
});

function fixture(outcome='unknown') {
  let now=Date.parse('2026-10-12T05:00:00Z');
  const at=Date.parse('2026-10-04T23:00:00Z');
  const schedule:any={id:'schedule_test',orgId:'org',projectId:'project',name:'Daily coach',enabled:true,activity:'flow_start',nextRunAt:at,timezone:'Australia/Brisbane',recurrence:{kind:'daily',localTime:'09:00'},misfirePolicy:'catch_up',intervalMinutes:1440,updatedAt:1};
  const occurrence:any={id:`schedule_test:${at}`,scheduleId:schedule.id,orgId:'org',projectId:'project',scheduledFor:at,flowRunId:'fr_test',status:'failed',claimId:'old',startedAt:at,manualReviewRequired:false,recoveryReviewedAt:at+10,providerOutcome:outcome==='not_dispatched'?'not_dispatched':'unknown',providerCode:outcome==='not_dispatched'?'OUTBOUND_NOT_READY':'IDEMPOTENCY_RECONCILIATION_REQUIRED'};
  const operation='op:fr_test:CALL:1';
  const run:any={id:'fr_test',orgId:'org',projectId:'project',occurrenceId:occurrence.id,revision:4,status:'failed',nodeRuns:{},outboundRecoveryHold:{operationId:operation,askId:'review'},state:{projectData:{flow_run_id:'fr_test',flow_occurrence_id:occurrence.id},milestones:[{id:'CALL',dependsOn:[],subtasks:[],actionConfig:{template:'{}',lastRun:{id:operation,status:'error',scheduleOccurrenceId:occurrence.id}},asks:[{id:'review',status:'answered'}]}]}};
  const dispatch:any={id:operation,orgId:'org',projectId:'project',flowRunId:run.id,nodeId:'CALL',occurrenceId:occurrence.id,manualReviewRequired:true,providerCode:occurrence.providerCode,leaseUntil:0,state:'dispatching',request:{taskType:'outgoing_call',data:{},template:'{}'},providerRequests:{frozen:{to:'+61400000000',correlation:{run_id:operation}}}};
  const sp='schedules/org/schedule_test',op=`schedule_runs/org/schedule_test/${at}`,fp='flow_runs/org/project/fr_test',dp=`action_dispatches/org/${encodeURIComponent(operation)}`;
  const rows:any={[sp]:schedule,[op]:occurrence,[fp]:encodeRtdbRecord(run),[dp]:encodeRtdbRecord(dispatch)};
  let lostPath='';let provider=outcome;
  const db:any={ref:(path:string)=>({get:async()=>({val:()=>structuredClone(rows[path]||null)}),on(){},once(_event:any,ready:any){ready();},off(){},transaction:async(fn:any)=>{const next=fn(structuredClone(rows[path]||null));if(next===undefined)return {committed:false,snapshot:{val:()=>rows[path]}};rows[path]=structuredClone(next);if(lostPath===path){lostPath='';throw new Error('Lost response');}return {committed:true,snapshot:{val:()=>structuredClone(rows[path])}};}})};
  const service=createScheduleRecovery({database:async()=>db,provider:async()=>({outcome:provider,receiptStatus:provider==='not_dispatched'?'missing':'reserved'}),now:()=>now});
  const body=(preview:any,decision='resume_future')=>({id:schedule.id,scheduledFor:at,requestId:'request_0001',decision,note:'Reviewed original receipt',planHash:preview.planHash,reviewedAt:preview.reviewedAt,acceptUncertainty:true,confirmCall:true});
  return {service,rows,sp,op,fp,dp,schedule,at,body,setProvider(v:string){provider=v;},loseAt(path:string){lostPath=path;},advance(ms:number){now+=ms;}};
}
test('closed review can resume tomorrow without replaying missed days or rewriting uncertain evidence',async()=>{
 const f=fixture(); const preview=await f.service.preview('org','schedule_test',f.at);
 assert.equal(preview.canRetry,false);assert.equal(preview.nextRunAt,Date.parse('2026-10-12T23:00:00Z'));
 const original=structuredClone(f.rows[f.dp]);const flow=structuredClone(f.rows[f.fp]);
 const receipt=await f.service.apply('org','human',f.body(preview));
 assert.equal(receipt.callDispatched,false);assert.equal(receipt.originalOutcome,'unknown');
 assert.equal(f.rows[f.sp].nextRunAt,preview.nextRunAt);assert.equal(f.rows[f.op].status,'failed');
 assert.deepEqual(f.rows[f.dp],original);assert.deepEqual(f.rows[f.fp],flow);
 assert.equal(scheduleRunCanBeClaimed(f.rows[f.op],Date.now()),false);
 assert.equal(manualRecoveryOccurrence([f.rows[f.op]]),undefined);
 assert.deepEqual(await f.service.apply('org','human',f.body(preview)),receipt);
 await assert.rejects(f.service.apply('org','another_human',f.body(preview)),/another review/);
});
test('stale configuration, changed evidence, expired previews and uncertain retries are denied',async()=>{
 for(const kind of ['configuration','provider','expired','retry','ack'] as const){
  const f=fixture(); const p=await f.service.preview('org','schedule_test',f.at);const b=f.body(p);
  if(kind==='configuration')f.rows[f.sp].timezone='UTC';
  if(kind==='provider')f.setProvider('completed');
  if(kind==='expired')f.advance(600001);
  if(kind==='retry')b.decision='retry_original';
  if(kind==='ack')b.acceptUncertainty=false;
  await assert.rejects(f.service.apply('org','human',b));
  assert.equal(f.rows[f.sp].nextRunAt,f.at);
 }
 const f=fixture();await assert.rejects(f.service.preview('other','schedule_test',f.at),/not found/);
});
test('lost responses at each save resume the original command and duplicate clicks cannot advance twice',async()=>{
 for(const stage of ['sp','op'] as const){
  const f=fixture();const p=await f.service.preview('org','schedule_test',f.at);f.loseAt(f[stage]);
  await assert.rejects(f.service.apply('org','human',f.body(p)),/Lost response/);
  const pending:any=await f.service.preview('org','schedule_test',f.at);assert.equal(pending.pending.requestId,'request_0001');
  await f.service.apply('org','human',{id:'schedule_test',scheduledFor:f.at,requestId:pending.pending.requestId});
  const next=f.rows[f.sp].nextRunAt;
  await f.service.apply('org','human',f.body(p));assert.equal(f.rows[f.sp].nextRunAt,next);
 }
 const f=fixture();const p=await f.service.preview('org','schedule_test',f.at);
 const results=await Promise.allSettled([f.service.apply('org','human',f.body(p)),f.service.apply('org','human',{...f.body(p),requestId:'request_0002'})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('verified pre-dispatch retry preserves the frozen operation and requires call approval',async()=>{
 const f=fixture('not_dispatched');const p=await f.service.preview('org','schedule_test',f.at);assert.equal(p.canRetry,true);
 await assert.rejects(f.service.apply('org','human',{...f.body(p,'retry_original'),confirmCall:false}),/confirmation/);
 const frozen=decodeRtdbRecord(f.rows[f.dp]).providerRequests;
 const result=await f.service.apply('org','human',f.body(p,'retry_original'));
 const run:any=decodeRtdbRecord(f.rows[f.fp]);const dispatch:any=decodeRtdbRecord(f.rows[f.dp]);
 assert.equal(result.callDispatched,false);assert.equal(run.outboundRecoveryHold,undefined);
 assert.equal(actionAttemptIdentity({id:'project',...run.state},'CALL').runId,dispatch.id);
 assert.deepEqual(dispatch.providerRequests,frozen);assert.equal(dispatch.manualReviewRequired,false);
 assert.equal(scheduleRunCanBeClaimed(f.rows[f.op],Date.now()),true);
});
test('keep held records a decision without releasing work; active workers and identity drift block review',async()=>{
 const f=fixture();const p=await f.service.preview('org','schedule_test',f.at);await f.service.apply('org','human',f.body(p,'keep_held'));
 assert.equal(f.rows[f.sp].nextRunAt,f.at);assert.equal(f.rows[f.op].recoveryResolution,undefined);
 assert.equal(scheduleRunCanBeClaimed(f.rows[f.op],Date.now()),false);
 const active=fixture();const d:any=decodeRtdbRecord(active.rows[active.dp]);d.leaseUntil=Date.now()+864000000;active.rows[active.dp]=encodeRtdbRecord(d);
 await assert.rejects(active.service.preview('org','schedule_test',active.at),/active worker/);
 assert.equal(recoveryProviderKey({id:'legacy',providerRequests:{}}),null);
});
test('future schedule respects selected weekdays and skips every stale occurrence even with catch-up',()=>{
 const monday=Date.parse('2026-10-12T05:00:00Z');
 assert.equal(nextRecoveryTime({timezone:'Australia/Brisbane',recurrence:{kind:'daily',localTime:'09:00',daysOfWeek:[1]}},monday),Date.parse('2026-10-18T23:00:00Z'));
});
test('only human administrators can review or execute recovery',()=>{
 for(const member of [{role:'member'},{role:'admin',apiClientId:'machine'},{role:'viewer'}])assert.throws(()=>requireRecoveryAdministrator(member),/human administrator/);
 assert.doesNotThrow(()=>requireRecoveryAdministrator({role:'owner'}));
});
test('interrupted safe retries resume each stage without overwriting a later provider receipt',async()=>{
 for(const stage of ['dp','fp','op'] as const){
  const f=fixture('not_dispatched');const p=await f.service.preview('org','schedule_test',f.at);f.loseAt(f[stage]);
  await assert.rejects(f.service.apply('org','human',f.body(p,'retry_original')),/Lost response/);
  await f.service.apply('org','human',{id:'schedule_test',scheduledFor:f.at,requestId:'request_0001'});
  assert.equal(f.rows[f.sp].recoveryPendingId,null);
  const d:any=decodeRtdbRecord(f.rows[f.dp]);d.outcome={status:'pending',externalExecutionId:'original_receipt'};f.rows[f.dp]=encodeRtdbRecord(d);
  await f.service.apply('org','human',f.body(p,'retry_original'));
  assert.equal(decodeRtdbRecord(f.rows[f.dp]).outcome.externalExecutionId,'original_receipt');
 }
});
test('resuming a partial save after its approved time requires fresh time approval',async()=>{
 const f=fixture();const p=await f.service.preview('org','schedule_test',f.at);f.loseAt(f.op);
 await assert.rejects(f.service.apply('org','human',f.body(p)),/Lost response/);
 f.advance(2*86400000);
 await assert.rejects(f.service.apply('org','human',{id:'schedule_test',scheduledFor:f.at,requestId:'request_0001'}),/approved time has passed/);
 const pending:any=await f.service.preview('org','schedule_test',f.at);assert.equal(pending.pending.timeReviewRequired,true);
 await f.service.apply('org','human',{id:'schedule_test',scheduledFor:f.at,requestId:'request_0001',nextRunAt:pending.pending.nextRunAt});
 assert.equal(f.rows[f.sp].nextRunAt,pending.pending.nextRunAt);
});
