import test from 'node:test';
import assert from 'node:assert/strict';
import {preserveBriefingTaskEdits} from '../lib/briefings/taskProjection.js';
import type {Project} from '../types.js';

const project = (run = 'run'): Project => ({id:'p',projectData:{flow_run_id:run},milestones:[
  {id:'n',subtasks:[{id:'t',status:'Started',commentHistory:[]}]}
]} as unknown as Project);

test('callback projection preserves confirmed status, approval and history once', () => {
  const current=project(), stale=project();
  const task=current.milestones[0].subtasks[0];
  task.status='Completed'; task.completedAt=10; task.approvalStatus='approved';
  task.commentHistory=[{text:'done',status:'Completed',timestamp:10},{text:'approved',status:'Completed',timestamp:20}];
  task.briefingEdit={id:'second',flowRunId:'run',at:20,status:'Completed',completedAt:10,approvalStatus:'approved'};
  const merged=preserveBriefingTaskEdits(current,stale);
  assert.equal(merged.milestones[0].subtasks[0].status,'Completed');
  assert.equal(merged.milestones[0].subtasks[0].approvalStatus,'approved');
  assert.equal(merged.milestones[0].subtasks[0].completedAt,10);
  assert.equal(preserveBriefingTaskEdits(current,merged).milestones[0].subtasks[0].commentHistory?.length,2);
  assert.equal(stale.milestones[0].subtasks[0].status,'Started');
  task.briefingEdit={...task.briefingEdit,id:'reopen',at:30,status:'Started',completedAt:null};
  const reopened=preserveBriefingTaskEdits(current,merged);
  assert.equal(reopened.milestones[0].subtasks[0].status,'Started');
  assert.equal(reopened.milestones[0].subtasks[0].completedAt,undefined);
});

test('confirmed changes stay in their occurrence and never expand a pinned execution graph', () => {
  const current=project();
  const edited={id:'new',status:'Completed',briefingEdit:{id:'edit',flowRunId:'run',at:1,status:'Completed'}};
  current.milestones[0].subtasks.push(edited as any);
  current.milestones.push({id:'new-node',subtasks:[{...edited,id:'other'}]} as any);
  const execution=preserveBriefingTaskEdits(current,project(),false);
  assert.equal(execution.milestones.length,1);
  assert.equal(execution.milestones[0].subtasks.length,1);
  const saved=preserveBriefingTaskEdits(current,project());
  assert.equal(saved.milestones.length,2);
  assert.equal(saved.milestones[0].subtasks.length,2);
  const next=project('next-run');
  assert.deepEqual(preserveBriefingTaskEdits(current,next),next);
});
