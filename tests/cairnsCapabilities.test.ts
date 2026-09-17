import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderActionTemplate, validateFlowOutput, validateOutputSchema } from '../lib/flowData';
import { mergeCloudEdits } from '../lib/cloudMerge';
import { nextDailyScheduleOccurrence, normalizeTenantSchedule } from '../lib/serverStore';
import { advanceProjectFlow, resolvePendingRun } from '../lib/flowOrchestrator';
import { resetProjectForOccurrence } from '../lib/flowOccurrence';
import { collapseCollections } from '../lib/flowCollections';
import { executeMailboxDraft } from '../lib/mailboxDraftAction';
import { reconcileEscalationCall, nextEscalationCycle, escalationStep } from '../lib/asks/askEscalation';
import { NodeType } from '../types';
import { action, project } from './helpers';
import { decision } from './helpers';
import { deliverEscalatedAsk } from '../lib/asks/deliverEscalatedAsk';
import { createHumanHoldAsk } from '../lib/flowHoldAsk';
import { durableActionExecutor, type DispatchStore } from '../lib/actionDispatch';
import { createFlowRun, materializeFlowRunProject } from '../lib/flowRun';
import { applyFlowEvent } from '../lib/flowEvents';
import { continuationHold } from '../lib/flowHoldStore';
import { updateFlowRunFromProject } from '../lib/flowRun';

test('weekday scheduling skips weekends at Brisbane local time and rejects an empty week', () => {
  const friday = Date.parse('2026-09-17T23:15:00Z');
  assert.equal(new Date(nextDailyScheduleOccurrence(friday, '09:15', 'Australia/Brisbane', [1,2,3,4,5])).toISOString(), '2026-09-20T23:15:00.000Z');
  assert.equal(new Date(nextDailyScheduleOccurrence(friday, '09:15', 'Australia/Brisbane')).toISOString(), '2026-09-18T23:15:00.000Z');
  assert.throws(() => nextDailyScheduleOccurrence(friday, '09:15', 'Australia/Brisbane', []));
});

test('typed templates preserve arrays, quotes and source braces without recursive interpolation', () => {
  const data = { plan: { rows: [['A', 2, false]], title: 'A "quote"\n{{secret}}' }, secret: 'NEVER' };
  const rendered = renderActionTemplate('{"values":"{{plan.rows}}","body":"Received {{plan.title}}"}', data);
  assert.deepEqual(rendered.templateData.values, [['A', 2, false]]);
  assert.equal(rendered.templateData.body, 'Received A "quote"\n{{secret}}');
  assert.throws(() => renderActionTemplate('{"to":"{{missing}}"}', data), /Missing flow input/);
  assert.throws(() => renderActionTemplate('{"to":"{{constructor.name}}"}', data), /Invalid data path/);
  const schema = validateOutputSchema({ type:'object', properties:{ rows:{type:'array',items:{type:'string'},maxItems:2} },required:['rows'] });
  assert.throws(() => validateFlowOutput({rows:'not an array'}, schema), /must be array/);
  assert.throws(() => validateFlowOutput({rows:[],instruction:'dial stranger'}, schema), /not in the schema/);
});

test('collection checkpoint survives callbacks, freezes inputs, and never repeats completed items', async () => {
  const batch = action('batch', NodeType.GOOGLE_SHEET_APPEND, { actionConfig: { template:'{"values":"{{item.rows}}"}', autoExecute:true, resultVariable:'written', forEach:{source:'rows',key:'id'} } });
  const original = project([batch], { flow_run_id:'flow1',flow_occurrence_id:'occ1',rows:[{id:'a',rows:[['{{literal}}']]},{id:'b',rows:[[2]]}] });
  const calls: any[] = [];
  const executor: any = async (_:string, template:string, data:any, ctx:any) => {
    calls.push({ ...renderActionTemplate(template,data).templateData, node:ctx.nodeId });
    return calls.length === 1 ? {status:'pending',externalId:'ext1'} : {status:'success',output:{saved:true}};
  };
  const first = await advanceProjectFlow(original, executor);
  assert.equal(calls.length,1);
  assert.deepEqual(calls[0].values,[['{{literal}}']]);
  const restored = JSON.parse(JSON.stringify(first.project));
  restored.projectData.rows = [];
  assert.equal(resetProjectForOccurrence(restored,'occ1'),restored);
  const pending = restored.milestones.find((m:any) => m.actionConfig?.lastRun?.status === 'pending');
  const resolved = resolvePendingRun(restored,{nodeId:pending.id,externalId:'ext1'},{status:'success',output:{saved:true},resolvedBy:'callback'})!;
  const second = await advanceProjectFlow(resolved.project,executor);
  assert.equal(calls.length,2);
  assert.deepEqual(calls[1].values,[[2]]);
  assert.equal(second.project.projectData?.written_output.count,2);
  await advanceProjectFlow(second.project,executor);
  assert.equal(calls.length,2);
  assert.equal(collapseCollections(second.project).milestones.length,1);
  assert.equal(resetProjectForOccurrence(second.project,'occ2').milestones.length,1);
});

test('cloud callback and independent node edit merge; competing edits and deletion conflicts preserve local work', () => {
  const base = { projects:[{id:'p',revision:1,milestones:[{id:'n',actionConfig:{template:'old',lastRun:null}}]}] };
  const local = structuredClone(base); local.projects[0].milestones[0].actionConfig.template='new';
  const remote:any = structuredClone(base); remote.projects[0].revision=2; remote.projects[0].milestones[0].actionConfig.lastRun={status:'success'};
  const merged = mergeCloudEdits(base,local,remote);
  assert.equal(merged.projects[0].milestones[0].actionConfig.template,'new');
  assert.deepEqual(merged.projects[0].milestones[0].actionConfig.lastRun,{status:'success'});
  remote.projects[0].milestones[0].actionConfig.template='someone else';
  assert.throws(() => mergeCloudEdits(base,local,remote), /conflict/);
  assert.throws(() => mergeCloudEdits(base,{projects:[]},remote), /conflict/);
  assert.equal(local.projects[0].milestones[0].actionConfig.template,'new');
});

test('a selected decision enters the batch; duplicate item keys fail before any effect', async () => {
  const batch=action('batch',NodeType.SMS,{dependsOn:['decision'],actionConfig:{template:'{}',autoExecute:true,forEach:{source:'items',key:'id'}}});
  const choose=decision('decision',[{targetId:'batch',label:'Selected',conditions:[]}],{decisionConfig:{branches:[],selectedTargetId:'batch'}});
  let effects=0; const execute:any=async()=>{effects++;return {status:'success'};};
  const good=await advanceProjectFlow(project([choose,batch],{items:[{id:'a'}]}),execute);
  assert.equal(effects,1);assert.equal(good.project.milestones.find(node=>node.id==='batch')?.actionConfig?.lastRun?.status,'success');
  const bad=await advanceProjectFlow(project([choose,batch],{items:[{id:'a'},{id:'a'}]}),execute);
  assert.equal(effects,1);assert.match(bad.project.milestones.find(node=>node.id==='batch')?.actionConfig?.lastRun?.error || '',/Duplicate/);
});

test('Firebase omission of empty dependency arrays does not conflict with a new local edge', () => {
  const base={id:'node',dependsOn:[] as string[]};
  assert.deepEqual(mergeCloudEdits(base,{...base,dependsOn:['upstream']},{id:'node'} as any),{id:'node',dependsOn:['upstream']});
});

test('mailbox update targets the same draft and project mailbox, even with email sending disabled', async () => {
  const calls:any[]=[];
  const deps:any = {
    findProject:async()=>({project:{emailSendingEnabled:false,projectData:{triage_connection_id:'outlook1'}}}),
    listMailboxConnectionRefs:async()=>[{id:'outlook1',state:'connected',provider:'outlook'}],
    client:()=>({updateMailboxDraft:async(...args:any[])=>{calls.push(args);return {provider_draft_id:args[2]};}})
  };
  const input = {provider_draft_id:'draft1',to:['person@example.com'],subject:'Inspection',text:'Confirmed'};
  const ctx={orgId:'org',projectId:'p',runId:'op1'};
  const result=await executeMailboxDraft('update_mailbox_draft',input,ctx,deps);
  assert.equal(result.provider_draft_id,'draft1'); assert.equal(result.draft_only,true);
  assert.equal(calls[0][1],'outlook1'); assert.equal(calls[0][4],'op1');
  await assert.rejects(executeMailboxDraft('update_mailbox_draft',{...input,connection_id:'other'},ctx,deps),/project’s mailbox/);
  await assert.rejects(executeMailboxDraft('update_mailbox_draft',{...input,provider_draft_id:''},ctx,deps),/original provider_draft_id/);
  assert.equal(calls.length,1);
});

test('escalation requires verified failure, delays the retry, and repeats weekdays with one open Ask', () => {
  const plan = {primaryPersonId:'primary',fallbackPersonId:'fallback',retryMinutes:10,repeatLocalTime:'09:15',timezone:'Australia/Brisbane',daysOfWeek:[1,2,3,4,5]};
  const now = Date.parse('2026-09-18T00:00:00Z');
  const initial={cycle:0,step:0,nextAt:now,awaitingId:'call1'};
  const pending=reconcileEscalationCall(plan,initial,{id:'call1',status:'running'},now);
  assert.equal(pending.awaitingId,'call1'); assert.equal(pending.step,0);
  const ambiguous=reconcileEscalationCall(plan,initial,{id:'call1',status:'completed'},now);
  assert.equal(ambiguous.awaitingId,'call1'); assert.match(ambiguous.error!,/not sufficient/);
  const retry=reconcileEscalationCall(plan,initial,{id:'call1',status:'completed',outcome:{disposition:'no_answer'}},now);
  assert.equal(retry.step,1); assert.equal(retry.nextAt,now+600000); assert.equal(retry.awaitingId,undefined);
  assert.deepEqual(escalationStep(plan,retry.step),{personId:'primary',channel:'voice'});
  const fallback=reconcileEscalationCall(plan,retry,{id:'call2',status:'failed'},now+600000);
  assert.deepEqual(escalationStep(plan,fallback.step),{personId:'fallback',channel:'voice'});
  assert.deepEqual(escalationStep(plan,3),{personId:'primary',channel:'sms'});
  assert.deepEqual(escalationStep(plan,4),{personId:'fallback',channel:'sms'});
  assert.equal(new Date(nextEscalationCycle(plan,{...initial,step:4},now).nextAt).toISOString(),'2026-09-20T23:15:00.000Z');
  const connected=reconcileEscalationCall(plan,initial,{id:'call1',status:'completed',output:{conversation_completed:true}},now);
  assert.equal(connected.cycle,1); assert.equal(connected.awaitingId,undefined);
});

test('retry delivery survives a lost state save, respects the ten-minute delay and stops on answered Ask', async () => {
  let now=Date.parse('2026-09-17T00:00:00Z'); let sent=0;
  const rows=new Map<string,any>();
  const store:DispatchStore={async transact(org,id,update){const key=`${org}/${id}`;const row=JSON.parse(JSON.stringify(update(rows.get(key)||null)));rows.set(key,row);return row;}};
  const plan={primaryPersonId:'p',fallbackPersonId:'f',retryMinutes:10,repeatLocalTime:'09:15',timezone:'Australia/Brisbane',daysOfWeek:[1,2,3,4,5]};
  const wait:any={id:'wait',name:'Team answers',nodeType:NodeType.WAIT,dependsOn:[],subtasks:[],holdConfig:{kind:'human',human:{kind:'question',channels:['voice'],prompt:'Confirm the plan',fields:[{name:'slot',type:'string',required:true,label:'Inspection time'}],escalation:plan}}};
  const p=project([wait],{flow_run_id:'run',flow_occurrence_id:'day'});
  const ask=createHumanHoldAsk(p,wait);
  const deps:any={now:()=>now,client:()=>({getCommunication:async()=>({id:'c1',status:'completed',outcome:{disposition:'no_answer'}})}),readTenantAgentProfile:async()=>({automaticActions:['call','sms']}),readTenantCapabilityPolicy:async()=>({}),resolveGrantedPersonTarget:async()=>'+61412318519',claimContactDispatch:async()=>({allowed:true}),readTenantCommunicationsSettings:async()=>({fromNumber:'+61411111111'}),durableActionExecutor:(execute:any)=>durableActionExecutor(execute,store,()=>now),deliverAsk:async()=>({id:`c${++sent}`,status:'accepted'})};
  const first=await deliverEscalatedAsk(p,'org',ask,plan,deps);
  const replay=await deliverEscalatedAsk(p,'org',ask,plan,deps);
  assert.equal(sent,1);assert.equal(first.escalationState?.awaitingId,replay.escalationState?.awaitingId);
  now+=60_000;
  const failed=await deliverEscalatedAsk(p,'org',first,plan,deps);
  assert.equal(failed.escalationState?.step,1);
  now+=599_999;await deliverEscalatedAsk(p,'org',failed,plan,deps);assert.equal(sent,1);
  now+=1;const retry=await deliverEscalatedAsk(p,'org',failed,plan,deps);assert.equal(sent,2);
  assert.equal(retry.id,ask.id);assert.deepEqual(retry.fields,ask.fields);
  await deliverEscalatedAsk(p,'org',{...retry,status:'answered'},plan,deps);assert.equal(sent,2);
});

test('scheduled and inbound branches stay isolated in the same project, including batches', async () => {
  const morning=action('morning',NodeType.MAILBOX_DRAFT,{actionConfig:{template:'{}',autoExecute:true,forEach:{source:'items',key:'id'}}});
  const event:any={id:'inbound',name:'Inbound',nodeType:NodeType.EVENT_TRIGGER,dependsOn:[],subtasks:[],eventTriggerConfig:{eventTypes:['communication.received']}};
  const reply=action('reply',NodeType.SMS,{dependsOn:['inbound'],actionConfig:{template:'{}',autoExecute:true}});
  const p=project([morning,event,reply],{items:[{id:'one'}]});
  const nodes:string[]=[];const execute:any=async (_:any,_t:any,_d:any,ctx:any)=>{nodes.push(ctx.nodeId);return {status:'success'};};
  const scheduled=createFlowRun({orgId:'org',project:p,occurrenceId:'morning',trigger:'schedule'});
  await advanceProjectFlow(materializeFlowRunProject(p,scheduled),execute);
  assert.deepEqual(nodes,['morning__item_0']);
  nodes.length=0;
  const incoming=applyFlowEvent(p,{id:'event1',type:'communication.received',occurredAt:Date.now(),personId:'caller'});
  const inbound=createFlowRun({orgId:'org',project:incoming.project,occurrenceId:incoming.occurrenceId,trigger:'event',triggerId:'event1'});
  await advanceProjectFlow(materializeFlowRunProject(p,inbound),execute);
  assert.deepEqual(nodes,['reply']);
});

test('a long synchronous batch requests a durable continuation instead of depending on a provider callback', async () => {
  const batch=action('batch',NodeType.MAILBOX_DRAFT,{actionConfig:{template:'{}',autoExecute:true,forEach:{source:'items',key:'id'}}});
  const p=project([batch],{items:Array.from({length:8},(_,id)=>({id}))});
  const run=createFlowRun({orgId:'org',project:p,occurrenceId:'long',trigger:'manual'});
  let effects=0;const execute:any=async()=>{effects++;return {status:'success'};};
  const first=await advanceProjectFlow(materializeFlowRunProject(p,run),execute);
  const checkpoint=updateFlowRunFromProject(run,first.project);
  const wake=continuationHold(checkpoint,first.project,1000);
  assert.equal(wake?.source,'continuation');assert.equal(wake?.availableAt,2000);
  let current=first.project;
  for(let i=0;i<3;i++)current=(await advanceProjectFlow(current,execute)).project;
  assert.equal(effects,8);
  assert.equal(continuationHold(updateFlowRunFromProject(checkpoint,current),current),null);
});
