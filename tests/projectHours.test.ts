import test from 'node:test';
import assert from 'node:assert/strict';
import { checkProjectHours, normalizeProjectHours } from '../lib/projectHours.js';
import { checkProjectHoursTask } from '../lib/checkProjectHoursTask.js';
import { evaluateContactAuthority, policyDefaults } from '../lib/cockpit/businessHours.js';
import { advanceFlow } from '../lib/flowEngine.js';
import { NodeType } from '../types.js';
import { action, decision, node, project } from './helpers.js';
import { validateProject } from '../lib/configuration/model.js';
import { projectConfiguration } from '../lib/configuration/schema.js';
import { advanceProjectFlow } from '../lib/flowOrchestrator.js';
import { durableActionExecutor, type DispatchStore } from '../lib/actionDispatch.js';
const hours = { timezone: 'Australia/Brisbane', windows: [{ days: [1,2,3,4,5], start: '09:00', end: '17:00' }] };
const check = (at: string, value: unknown = hours) => checkProjectHours(value, Date.parse(at));

test('project clock uses Brisbane, inclusive opening and exclusive closing with next weekday', () => {
  assert.equal(check('2026-10-11T22:59:59Z').hours_open, false);
  assert.equal(check('2026-10-11T23:00:00Z').hours_open, true);
  assert.equal(check('2026-10-12T07:00:00Z').hours_open, false);
  assert.equal(check('2026-10-16T07:00:00Z').hours_next_open_at, '2026-10-18T23:00:00.000Z');
});
test('multiple windows, overnight spill and closures', () => {
  const value = { timezone: hours.timezone, windows: [{days:[1],start:'22:00',end:'02:00'}, {days:[2],start:'09:00',end:'10:00'}] };
  assert.equal(check('2026-10-12T15:00:00Z', value).hours_open, true);
  assert.equal(check('2026-10-12T16:00:00Z', value).hours_next_open_at, '2026-10-12T23:00:00.000Z');
  assert.equal(check('2026-10-12T15:00:00Z', {...value,closures:['2026-10-12']}).hours_open, false);
  assert.equal(check('2026-10-12T15:00:00Z', {...value,closures:['2026-10-13']}).hours_open, false);
});
test('DST gap and repeated hour are evaluated as real instants', () => {
  const value = {timezone:'Australia/Sydney',windows:[{days:[0],start:'03:00',end:'04:00'}]};
  assert.equal(check('2026-10-03T15:59:00Z',value).hours_next_open_at,'2026-10-03T16:00:00.000Z');
  const repeated = {...value,windows:[{days:[0],start:'02:00',end:'03:00'}]};
  assert.equal(check('2026-04-04T15:30:00Z',repeated).hours_open,true);
  assert.equal(check('2026-04-04T16:30:00Z',repeated).hours_open,true);
});
test('unconfigured, permanently closed and invalid settings are distinguishable', () => {
  assert.equal(check('2026-10-12T00:00:00Z',null).hours_status,'not_configured');
  const closed=check('2026-10-12T00:00:00Z',{...hours,windows:[]});
  assert.equal(closed.hours_status,'closed'); assert.equal(closed.hours_next_open_at,null);
  assert.throws(()=>normalizeProjectHours({...hours,timezone:'invalid'}));
  assert.throws(()=>normalizeProjectHours({...hours,closures:['2026-02-30']}));
});
test('task reads only the trusted tenant/project and fresh server clock and revision', async () => {
  const reads: string[][]=[];
  let revision=3;
  const deps:any={findProject:async(...args:string[])=>{reads.push(args);return {project:{operatingHours:hours,revision:revision++}};},now:()=>Date.parse('2026-10-12T00:00:00Z')};
  assert.equal((await checkProjectHoursTask({orgId:'tenant',projectId:'project'},deps)).hours_project_revision,3);
  assert.equal((await checkProjectHoursTask({orgId:'tenant',projectId:'project'},deps)).hours_project_revision,4);
  assert.deepEqual(reads,[['tenant','project'],['tenant','project']]);
  await assert.rejects(checkProjectHoursTask({},deps),/trusted/);
  await assert.rejects(checkProjectHoursTask({orgId:'tenant',projectId:'missing'},{...deps,findProject:async()=>null}),/not found/);
});
test('hours survive configuration roundtrip and semantic validation', () => {
  const p={...project([action('H',NodeType.CHECK_HOURS,{actionConfig:{template:'{}'}})]),operatingHours:hours};
  assert.deepEqual(projectConfiguration(p).operatingHours,hours);
  assert.deepEqual(validateProject(projectConfiguration(p)),[]);
  assert.ok(validateProject({...projectConfiguration(p),operatingHours:{...hours,timezone:'invalid'}}).length);
});
test('closed is successful data: Decision explicitly selects End while open selects communication', () => {
  for (const open of [false,true]) {
    const p=project([
      action('H',NodeType.CHECK_HOURS,{actionConfig:{template:'{}',lastRun:{at:1,status:'success'}}}),
      decision('D',[{targetId:'CALL',label:'Open',conditions:[{variable:'hours_open',equals:true}]},{targetId:'END',label:'Closed'}],{dependsOn:['H']}),
      action('CALL',NodeType.PHONE_CALL,{dependsOn:['D'],actionConfig:{template:'{}',autoExecute:true}}),node('END',{nodeType:NodeType.END,dependsOn:['D']})
    ],{hours_open:open});
    const result=advanceFlow(p);
    assert.deepEqual(result.actionsToRun,open?['CALL']:[]);
    assert.equal(result.project.milestones[1].decisionConfig?.selectedTargetId,open?'CALL':'END');
  }
});
test('Wait persists the exact next-opening result across resumption; null cannot wait forever', () => {
  const at=Date.now()+3600000;
  const p=project([node('W',{nodeType:NodeType.WAIT,waitConfig:{kind:'timer',resumeAtPath:'hours_next_open_at'}})],{hours_next_open_at:new Date(at).toISOString()});
  const armed=advanceFlow(p).project;
  assert.equal(armed.milestones[0].waitConfig?.resumeAt,at);
  armed.projectData!.hours_next_open_at=new Date(at+100000).toISOString();
  assert.equal(advanceFlow(armed).project.milestones[0].waitConfig?.resumeAt,at);
  p.projectData!.hours_next_open_at=null;
  assert.throws(()=>advanceFlow(p),/valid timestamp/);
});
test('dispatch does not secretly gate hours or modes; inbound SMS cannot authorize voice', () => {
  const now=Date.parse('2026-10-12T09:00:00Z');
  const policy=policyDefaults('Australia/Brisbane',{startHour:9,endHour:17});
  const base={orgId:'org',target:'+611',from:'+612',channel:'sms',now};
  const source:any={tenantId:'org',personId:'jorian',direction:'inbound',channel:'sms',sender:'+611',recipients:['+612'],occurredAt:new Date(now-1000).toISOString()};
  for(const mode of ['reply','acknowledge','queue'] as const){
    const p={...policy,replies:{...policy.replies,mode}};
    assert.equal(evaluateContactAuthority(p,{...base,channel:'voice'}).status,'allowed');
    const reply=evaluateContactAuthority(p,{...base,source});
    assert.equal(reply.status,'allowed');assert.equal(reply.notice,undefined);assert.equal(reply.nextEligibleAt,undefined);
    assert.equal(evaluateContactAuthority(p,{...base,channel:'voice',source}).status,'needs_review');
    assert.equal(evaluateContactAuthority(p,{...base,source:{...source,tenantId:'other'}}).status,'needs_review');
  }
});

test('full orchestrator executes the registered check and branches on its actual output', async () => {
  for (const at of ['2026-10-12T00:00:00Z','2026-10-12T09:00:00Z']) {
    const p=project([
      action('H',NodeType.CHECK_HOURS,{actionConfig:{template:'{}',autoExecute:true}}),
      decision('D',[{targetId:'SMS',label:'Open',conditions:[{variable:'hours_open',equals:true}]},{targetId:'END',label:'Closed'}],{dependsOn:['H']}),
      action('SMS',NodeType.SMS,{dependsOn:['D'],actionConfig:{template:'{}',autoExecute:true}}),
      node('END',{nodeType:NodeType.END,dependsOn:['D']})
    ]);
    const calls:string[]=[];
    const result=await advanceProjectFlow(p,async(type)=>{
      calls.push(type);
      return {status:'success',output:type==='check_project_hours'?check(at):{fixture_sms:true}};
    },{orgId:'tenant'});
    const open=check(at).hours_open;
    assert.deepEqual(calls,open?['check_project_hours','send_sms']:['check_project_hours']);
    assert.equal(result.project.projectData?.hours_status,open?'open':'closed');
  }
});

test('failed pure hours read resolves as an error, never as an uncertain provider effect', async () => {
  let row:any=null;
  const store:DispatchStore={transact:async(_org,_id,update)=>row=structuredClone(update(row))};
  const execute=durableActionExecutor(async()=>({status:'error',error:'Project not found'}),store);
  const result=await execute('check_project_hours','{}',{}, {orgId:'tenant',projectId:'p',nodeId:'H',runId:'hours-read'});
  assert.equal(result.status,'error');assert.equal(row.state,'resolved');
});
