import type { ScheduleRun, TenantSchedule, Project } from '../types.js';
import { readFlowRun } from './flowRunStore.js';
import { readActionDispatch } from './actionDispatch.js';
import { actionAttemptIdentity } from './flowOrchestrator.js';
import { flowRunIdForOccurrence, materializeFlowRunProject } from './flowRun.js';
import { isActionNode } from './flowEngine.js';
export type ServiceRunProgress = {projectId:string;scheduleId:string;scheduledFor:number;runId?:string;status:'starting'|'running'|'waiting'|'held'|'completed'|'failed'|'cancelled';nodes:{id:string;name:string;status:'running'|'waiting'|'failed'}[];updatedAt?:number};
export async function readServiceRunProgress(schedule:TenantSchedule, occurrence:ScheduleRun|null, project:Project, scheduledFor:number, deps={readFlowRun,readActionDispatch}):Promise<ServiceRunProgress>{
 const base={projectId:String(project.id),scheduleId:schedule.id,scheduledFor,nodes:[] as ServiceRunProgress['nodes']};
 if(!occurrence)return {...base,status:'starting'};
 const held=!occurrence.recoveryResolution && !!(occurrence.manualReviewRequired||occurrence.recoveryReviewedAt||occurrence.status==='blocked');
 const runId=occurrence.flowRunId || flowRunIdForOccurrence(schedule.orgId,String(project.id),occurrence.id);
 const run=schedule.activity==='flow_start'?await deps.readFlowRun(schedule.orgId,String(project.id),runId):null;
 if(run && (run.orgId!==schedule.orgId||run.projectId!==String(project.id)||run.occurrenceId!==occurrence.id))throw Error('Run scope mismatch');
 let nodes:ServiceRunProgress['nodes']=[];
 if(run){
  const runtime=materializeFlowRunProject(project,run);
  nodes=(await Promise.all(runtime.milestones.map(async node=>{
   const saved=run.nodeRuns[node.id]?.at(-1);let status:string|undefined=saved?.status;
   if(isActionNode(node) && !['completed','skipped'].includes(status||'')){
    // A ready action is not necessarily executing. Only its own saved attempt or ledger can establish that.
    status=node.actionConfig?.lastRun?.status==='pending'?'waiting':node.actionConfig?.lastRun?.status==='error'?'failed':undefined;
    const d=await deps.readActionDispatch(schedule.orgId,node.actionConfig?.lastRun?.id||actionAttemptIdentity(runtime,node.id).runId);
    if(d && d.flowRunId===run.id && d.projectId===String(project.id) && d.nodeId===node.id){
     const outcome=d.terminal||d.outcome;
     status=outcome ? outcome.status==='pending'?'waiting':outcome.status==='error'?'failed':'completed' : d.state==='dispatching' && (d.leaseUntil||0)>Date.now()?'running':d.providerCode?'waiting':undefined;
    }
   }
   return ['running','waiting','failed'].includes(status||'')?{id:node.id,name:node.name,status:status as 'running'|'waiting'|'failed'}:null;
  }))).filter((n):n is NonNullable<typeof n>=>!!n);
 }
 const terminal=run && ['completed','failed','cancelled'].includes(run.status)?run.status:undefined;
 const status=occurrence.recoveryResolution?'failed':held||run?.outboundRecoveryHold?'held':terminal||(['completed','failed'].includes(occurrence.status)?occurrence.status:nodes.some(n=>n.status==='running')?'running':nodes.some(n=>n.status==='waiting')||run?.status==='waiting'?'waiting':'running');
 if(['completed','cancelled'].includes(status))nodes=[];
 if(status==='failed')nodes=nodes.filter(n=>n.status==='failed');
 return {...base,runId:run?.id,status:status as ServiceRunProgress['status'],nodes,updatedAt:run?.updatedAt||occurrence.completedAt||occurrence.startedAt};
}
