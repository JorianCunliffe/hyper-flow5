import {test} from 'node:test';
import assert from 'node:assert/strict';
import {outboundScheduleRecovery} from '../lib/outboundScheduleRecovery';
import {escalateOutboundRecovery} from '../lib/outboundRecoveryEscalation';
import {reconcileOutboundCall} from '../lib/outboundCallReconciliation';
import {scheduleRunCanBeClaimed} from '../lib/serverStore';
import {createFlowRun} from '../lib/flowRun';
import {NodeType} from '../types';
import {checkpointReviewedRun} from '../lib/asks/respondToAsk';
import {closeRecoveryReview, reviewedRecoveryRun} from '../lib/asks/closeRecoveryReview';

test('outage and uncertainty have fixed deadlines that retries cannot extend',()=>{
 const first=1000;
 for(const [code,minutes] of [['OUTBOUND_NOT_READY',60],['IDEMPOTENCY_RECONCILIATION_REQUIRED',30]] as const){
  const held=outboundScheduleRecovery({providerCode:code},first)!;
  const retry=outboundScheduleRecovery({providerCode:code},first+120000,held)!;
  assert.equal(retry.recoveryDeadlineAt, first+minutes*60000);
  const expired=outboundScheduleRecovery({providerCode:code},retry.recoveryDeadlineAt!,retry)!;
  assert.equal(expired.status,'failed');assert.equal(expired.manualReviewRequired,true);
  assert.equal(expired.providerOutcome,code==='OUTBOUND_NOT_READY'?'not_dispatched':'unknown');
  assert.equal(scheduleRunCanBeClaimed({...expired,startedAt:first} as any,first+99999999),false);
 }
 const outage=outboundScheduleRecovery({providerCode:'OUTBOUND_NOT_READY'},first)!;
 const uncertain=outboundScheduleRecovery({providerCode:'IDEMPOTENCY_IN_PROGRESS'},first+60000,outage)!;
 assert.equal(uncertain.recoveryDeadlineAt,first+1800000);
 assert.equal(scheduleRunCanBeClaimed({status:'blocked',startedAt:1,retryAfter:100},100),true);
 const next=outboundScheduleRecovery({providerCode:'OUTBOUND_NOT_READY',operationId:'second'},first+7200000,{...outage,recoveryOperationId:'first'})!;
 assert.equal(next.status,'recoverable');assert.equal(next.recoveryStartedAt,first+7200000);
 assert.equal(next.recoveryDeadlineAt,first+10800000);
});

test('reconciliation only reads the original tenant/key and requires provider evidence',async()=>{
 const row:any={id:'op:original',orgId:'tenant',providerRequests:{}};
 const seen:any[]=[];
 const read=async(tenant:string,key:string)=>{seen.push([tenant,key]);return{status:'dispatched',provider_id:'CA-original',communication_id:'comm-original'};};
 const result=await reconcileOutboundCall(row,read);
 assert.deepEqual(seen,[['tenant','op:original']]);assert.equal(result?.externalExecutionId,'comm-original');
 assert.equal(await reconcileOutboundCall(row,async()=>({status:'reserved'})),null);
 assert.equal(await reconcileOutboundCall(row,async()=>{throw new Error('timeout')}),null);
 assert.equal((await reconcileOutboundCall(row,async()=>({status:'failed'})))?.providerCode,'OUTBOUND_PROVIDER_REJECTED');
});

function fixture(){
 const project:any={id:'p',name:'Test',revision:0,projectData:{},milestones:[{id:'call',name:'Call',nodeType:NodeType.PHONE_CALL,dependsOn:[],subtasks:[],actionConfig:{template:'{}'}}]};
 let run=createFlowRun({orgId:'t',project,occurrenceId:'s:1',trigger:'schedule'});
 let operation:any={id:'op:original',orgId:'t',projectId:'p',nodeId:'call',flowRunId:run.id,occurrenceId:'s:1',request:{taskType:'outgoing_call'}};
 let workspace:any={projects:[project]};
 let failProjection=false;
 const dependencies:any={listRunDispatches:async()=>[operation],readActionDispatch:async()=>operation,findProject:async()=>({project,index:0}),readFlowRun:async()=>run,
  saveFlowRun:async(value:any)=>run=value,transact:async(_t:any,_id:any,update:any)=>operation=update(operation),
  transactWorkspaceConfiguration:async(_t:any,update:any)=>{if(failProjection){failProjection=false;throw new Error('lost response');}return workspace=update(workspace);}};
 const schedule:any={id:'s',orgId:'t',projectId:'p',activity:'flow_start'};
 const occurrence:any={id:'s:1',flowRunId:run.id,recoveryOperationId:operation.id,providerCode:'IDEMPOTENCY_RECONCILIATION_REQUIRED',providerOutcome:'unknown'};
 return {dependencies,schedule,occurrence,failNextProjection:()=>failProjection=true,get run(){return run},get operation(){return operation},get workspace(){return workspace}};
}

test('closing recovery review survives partial saves without clearing provider uncertainty or retrying',async()=>{
 const f=fixture();await escalateOutboundRecovery(f.schedule,f.occurrence,1000,f.dependencies);
 f.run.triggerId='s';
 const ask=f.run.state.milestones[0].asks![0];
 ask.responses=[{id:'comment',at:1,via:'web',actor:'owner',text:'Existing note',needsInterpretation:true}];
 let occurrence:any={...f.occurrence,status:'failed',manualReviewRequired:true,recoveryAskId:ask.id};
 const deps:any={...f.dependencies,listTenantSchedules:async()=>[f.schedule],readScheduleRun:async()=>occurrence,
  finishScheduleRun:async(_row:any,patch:any)=>occurrence={...occurrence,...patch}};
 f.failNextProjection();
 await assert.rejects(closeRecoveryReview(f.run,ask,'owner','Reviewed; do not retry',deps),/lost response/);
 const answered=f.run.state.milestones[0].asks![0];
 await closeRecoveryReview(f.run,answered,'owner','Reviewed; do not retry',deps);
 assert.equal(f.run.status,'failed');assert.equal(occurrence.status,'failed');
 assert.equal(occurrence.providerOutcome,'unknown');assert.equal(occurrence.manualReviewRequired,false);
 assert.equal(scheduleRunCanBeClaimed({...occurrence,startedAt:1},Date.now()+9999999),false);
 assert.equal(f.run.state.milestones[0].asks![0].responses.length,2);
 assert.equal(f.workspace.projects[0].milestones[0].asks[0].status,'answered');
 assert.equal(f.operation.terminal,undefined);assert.equal(f.operation.outcome,undefined);
 assert.throws(()=>reviewedRecoveryRun(f.run,{...answered,id:'other'},'owner','note',2000),/not the recovery review/);
 assert.throws(()=>reviewedRecoveryRun(f.run,answered,'owner',' ',2000),/Enter a review note/);
});

test('saving a comment does not queue a running workflow',async()=>{
 const f=fixture();let queued=0;
 const project:any={id:'p',milestones:f.run.state.milestones,projectData:{}};
 const result=await checkpointReviewedRun({orgId:'t',projectId:'p',response:{text:'Note'},responseAction:'comment'},
  {project,index:0},f.run,project,{saveFlowRun:async r=>r,syncFlowHoldsFromRun:async()=>{queued++;},writeProject:async()=>{}} as any);
 assert.equal(queued,0);assert.deepEqual(result.pending,[]);
});

test('lost escalation save resumes with one web Ask, failed action and untouched provider outcome',async()=>{
 const f=fixture();f.failNextProjection();
 await assert.rejects(escalateOutboundRecovery(f.schedule,f.occurrence,1000,f.dependencies),/lost response/);
 const id=await escalateOutboundRecovery(f.schedule,f.occurrence,2000,f.dependencies);
 assert.equal(await escalateOutboundRecovery(f.schedule,f.occurrence,3000,f.dependencies),id);
 const asks=f.run.state.milestones[0].asks!;
 assert.equal(asks.length,1);assert.deepEqual(asks[0].channels,['web']);assert.equal(asks[0].responseContract?.automaticProgress,'never');
 assert.equal(f.workspace.projects[0].milestones[0].asks.length,1);
 assert.equal(f.run.status,'failed');assert.equal(f.run.nodeRuns.call.at(-1)?.status,'failed');
 assert.equal(f.operation.manualReviewRequired,true);assert.equal(f.operation.terminal,undefined);assert.equal(f.operation.outcome,undefined);
 assert.equal(f.run.state.milestones[0].actionConfig?.lastRun?.output.provider_outcome,'unknown');
});

test('late provider receipt prevents a false timeout failure; cross-tenant dispatch cannot escalate',async()=>{
 const f=fixture();f.operation.outcome={status:'pending',externalExecutionId:'original'};
 assert.equal(await escalateOutboundRecovery(f.schedule,f.occurrence,1000,f.dependencies),null);
 assert.equal(f.run.status,'running');assert.equal(f.operation.manualReviewRequired,undefined);
 f.operation.orgId='other';
 await assert.rejects(escalateOutboundRecovery(f.schedule,f.occurrence,1000,f.dependencies),/could not be identified/);
});

test('acknowledging the recovery Ask cannot queue workflow continuation',async()=>{
 const f=fixture();await escalateOutboundRecovery(f.schedule,f.occurrence,1000,f.dependencies);
 const project:any={id:'p',milestones:f.run.state.milestones,projectData:f.run.state.projectData};
 let queued=0;
 const result=await checkpointReviewedRun({orgId:'t',projectId:'p',response:{text:'Reviewed receipt'}},
  {project,index:0},f.run,project,{saveFlowRun:async r=>r,syncFlowHoldsFromRun:async()=>{queued++;},writeProject:async()=>{}} as any);
 assert.equal(queued,0);assert.deepEqual(result.pending,[]);assert.equal(result.run.status,'failed');
 assert.equal(result.run.outboundRecoveryHold?.operationId,'op:original');
});
