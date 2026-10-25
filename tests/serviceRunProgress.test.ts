import test from 'node:test';
import assert from 'node:assert/strict';
import {readServiceRunProgress} from '../lib/serviceRunProgress.js';
import {NodeType} from '../types.js';
import {serviceProjectRequest,serviceProjectDependencies} from '../lib/serviceProjectApi.js';
import {dailyCoachingTemplate} from '../lib/projectTemplates.js';
import {progressBusy} from '../lib/serviceProgressState.js';
const schedule:any={id:'s',orgId:'org',projectId:'p',activity:'flow_start'};
const occurrence:any={id:'s:123',scheduledFor:123,status:'running'};
const project:any={id:'p',milestones:[],projectData:{}};
function fixture(){
 const run:any={id:'flow',orgId:'org',projectId:'p',occurrenceId:'s:123',status:'running',startedAt:1,updatedAt:2,dispatchVersion:1,nodeRuns:{A:[{status:'running'}],B:[{status:'running'}]},state:{projectData:{flow_run_id:'flow',flow_occurrence_id:'s:123',flow_dispatch_version:1},milestones:['A','B'].map(id=>({id,name:`Step ${id}`,nodeType:NodeType.PHONE_CALL,dependsOn:[],subtasks:[],actionConfig:{template:'{}'}}))}};
 const rows:any={};const deps={readFlowRun:async()=>run,readActionDispatch:async(_org:string,id:string)=>rows[id]||null};return {run,rows,deps};
}
test('only an executing ledger attempt is highlighted; readiness alone is not running',async()=>{
 const f=fixture();let p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.deepEqual(p.nodes,[]);
 f.rows['op:flow:A:1']={flowRunId:'flow',projectId:'p',nodeId:'A',state:'dispatching',leaseUntil:Date.now()+10000};
 p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.deepEqual(p.nodes,[{id:'A',name:'Step A',status:'running'}]);
 f.rows['op:flow:B:1']={flowRunId:'flow',projectId:'p',nodeId:'B',outcome:{status:'pending'}};
 p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.equal(p.nodes.length,2);assert.equal(p.nodes[1].status,'waiting');
});
test('waiting, held, failed, completed and cancelled remain distinct and do not leak action data',async()=>{
 const f=fixture();f.run.nodeRuns={A:[{status:'waiting'}]};f.run.state.milestones[0].nodeType=NodeType.WAIT;
 let p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.equal(p.status,'waiting');
 p=await readServiceRunProgress(schedule,{...occurrence,status:'blocked'},project,123,f.deps);assert.equal(p.status,'held');
 for(const status of ['completed','cancelled']){f.run.status=status;p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.equal(p.status,status);assert.deepEqual(p.nodes,[]);}
 f.run.status='failed';f.rows['op:flow:B:1']={flowRunId:'flow',projectId:'p',nodeId:'B',outcome:{status:'error',error:'private secret'}};
 p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);assert.equal(p.status,'failed');assert.equal(p.nodes[0].id,'B');assert.ok(!JSON.stringify(p).includes('private secret'));
});
test('progress lookup reads the exact occurrence, stays scoped, and never calls mailbox providers',async()=>{
 let at=0;const deps:any={...serviceProjectDependencies,listTenantProjects:async()=>[project],listTenantSchedules:async()=>[schedule],readScheduleRun:async(_s:any,value:number)=>{at=value;return occurrence;},readServiceRunProgress:async()=>({scheduledFor:123}),listMailboxes:async()=>{throw Error('must not call');}};
 const req:any={method:'GET',query:{progress:'true',projectId:'p',scheduleId:'s',scheduledFor:'123'}};
 assert.equal((await serviceProjectRequest('service_setup_status',req,{orgId:'org'} as any,deps)).status,200);assert.equal(at,123);
 req.query.projectId='other';assert.equal((await serviceProjectRequest('service_setup_status',req,{orgId:'org'} as any,deps)).status,404);
 const f=fixture();f.run.projectId='other';await assert.rejects(readServiceRunProgress(schedule,occurrence,project,123,f.deps),/scope/);
});

test('a coaching review releases Start now while an active phone call keeps it disabled',async()=>{
 const f=fixture();const template=dailyCoachingTemplate({reviewer:'human',email:'human@example.invalid'});
 f.run.status='waiting';f.run.nodeRuns={};f.run.state.milestones=template.milestones;
 f.run.state.projectData={...template.projectData,coaching_requires_review:true,coaching_call_result_success:true};
 for(const id of ['COACH_DOC','COACH_TRACKER','COACH_CALL','COACH_EXTRACT']){
  f.run.state.milestones.find((n:any)=>n.id===id).actionConfig.lastRun={id,status:'success',at:1};
 }
 const route=f.run.state.milestones.find((n:any)=>n.id==='COACH_CALL_ROUTE');route.decisionConfig.selectedTargetId='COACH_EXTRACT';route.decisionConfig.decidedAt=1;
 f.run.state.milestones.find((n:any)=>n.id==='COACH_EXTRACT').asks=[{id:'approval',kind:'approval',status:'open',runId:'COACH_EXTRACT',channels:['web'],assignees:['human']}];
 let p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);
 assert.equal(p.awaitingReview,true);assert.equal(p.canStartNewRun,true);assert.equal(progressBusy(p),false);
 f.run.state.milestones.find((n:any)=>n.id==='COACH_CALL').actionConfig.lastRun.status='pending';
 p=await readServiceRunProgress(schedule,occurrence,project,123,f.deps);
 assert.equal(p.canStartNewRun,false);assert.equal(progressBusy(p),true);
});

