import test from 'node:test';
import assert from 'node:assert/strict';
import {createBriefingTask,briefingTaskResult} from '../lib/briefings/createTask.js';

test('task creation saves once, reconciles lost replies, and enforces caller and project scope',async()=>{
  let workspace:any={projects:[{id:'p',name:'Project',milestones:[]}],scratchTasks:[],activityLogs:[],dataRevision:1};
  const deps:any={transact:async(_org:any,fn:any)=>workspace=fn(structuredClone(workspace)),read:async()=>workspace};
  const member={orgId:'org',uid:'alice',email:'alice@example.test'};
  const input={projectId:'p',title:'Revamp daily coaching',requestId:'new-task-1'};
  await assert.rejects(createBriefingTask(member,{...input,title:''},['p'],'call',deps),/description/);
  await assert.rejects(createBriefingTask(member,input,[],'call',deps),/outside/);
  await assert.rejects(createBriefingTask(member,{...input,projectId:'missing'},undefined,'call',deps),/not found/);
  const result=await createBriefingTask(member,input,['p'],'call',deps);
  assert.equal(result.status,'completed');
  assert.equal(result.item.projectId,'p');
  assert.equal(result.item.assigneeUid,'alice');
  assert.equal((await createBriefingTask(member,input,['p'],'call',deps)).id,result.id);
  assert.equal(workspace.scratchTasks.length,1);
  assert.equal(workspace.activityLogs.length,1);
  assert.equal((await briefingTaskResult(member,result.id,'call',deps)).saved,true);
  await assert.rejects(briefingTaskResult(member,result.id,'other-call',deps),/not found/);
  await assert.rejects(createBriefingTask(member,{...input,title:'Different'},['p'],'call',deps),/different task/);
});
