import { continuationHold } from '../lib/flowHoldStore.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CaptureError, normalizeIntent, selectReviewItems, transition, type CapturedWorkItem } from '../lib/capturedWork/model.js';
import { captureIdentity, replayOrCreate } from '../lib/capturedWork/store.js';
import { handleCapturedWork, capturedWorkDependencies } from '../lib/capturedWork/api.js';
import { reviewCapturedWork, reviewDependencies } from '../lib/capturedWork/review.js';
import { advanceProjectFlow } from '../lib/flowOrchestrator.js';
import { createFlowRun, deriveFlowRunStatus } from '../lib/flowRun.js';
import { resetProjectForOccurrence } from '../lib/flowOccurrence.js';
import { NodeType, type Milestone, type Project } from '../types.js';
import { requestScope } from '../lib/tenantControl/clients.js';
const item = (id = 'capture_1', extra: Partial<CapturedWorkItem> = {}): CapturedWorkItem => ({ id, orgId: 'org', capturedForUserId: 'user', rawText: 'Meet the Edmonton buyer at one today', status: 'captured', createdAt: 1, updatedAt: 1, version: 1, captureFingerprint: 'same', ...extra });
const reviewNode = (): Milestone => ({ id: 'review', name: 'Review', nodeType: NodeType.CAPTURE_REVIEW, subtasks: [], dependsOn: [], captureReviewConfig: { capturedForUserId: 'user', maxItems: 5 } } as Milestone);
const project = (node = reviewNode()): Project => ({ id: 'sharehouse', name: 'Sharehouse', company: 'Test', type: 'other', startDate: 1, createdAt: 1, updatedAt: 1, milestones: [node], projectData: { flow_run_id: 'new-run', flow_started_at: 10 } } as Project);
function harness(rows: CapturedWorkItem[]) {
  const records = new Map(rows.map(row => [row.id, row]));
  const deps: typeof reviewDependencies = {
    ...reviewDependencies,
    listCaptures: async () => [...records.values()],
    readCapture: async (_org, _user, id) => records.get(id) || null,
    mutateCapture: async (_org, _user, id, op, body) => { const next = transition(records.get(id)!, op, body); records.set(id, next); return next; },
    readTenantAgentProfile: async () => ({ primaryUserId: 'user' } as any),
    requireOrganizationMember: async () => ({ uid: 'user', orgId: 'org', role: 'owner' } as any),
    listTenantProjects: async () => [{ id: 'edmonton', name: 'Edmonton' } as Project],
    requireProjectInTenant: async (_org, id) => { if (id !== 'edmonton') throw new CaptureError(403, 'foreign project'); }
  };
  return { records, deps };
}
function answer(node: Milestone, value: string): Milestone {
  return { ...node, asks: node.asks!.map(ask => ask.id !== node.captureReviewState!.askId ? ask : { ...ask, status: 'answered', responses: [{ id: 'response', at: 20, via: 'web', actor: 'owner:user', values: { capture_answer: value } }] }) };
}
test('retry identity separates tenants, users and distinct utterances; conflicting replay fails', () => {
  const a = captureIdentity('org', 'user', 'turn-1:0');
  assert.equal(a, captureIdentity('org', 'user', 'turn-1:0'));
  assert.notEqual(a, captureIdentity('other', 'user', 'turn-1:0'));
  assert.notEqual(a, captureIdentity('org', 'other', 'turn-1:0'));
  assert.notEqual(a, captureIdentity('org', 'user', 'turn-2:0'));
  const current = item(); assert.equal(replayOrCreate(current, item()), current);
  assert.throws(() => replayOrCreate(current, item('capture_1', { captureFingerprint: 'different' })), /Idempotency/);
});
test('capture accepts incomplete work; later review survives source run completion and ambiguous project', () => {
  const rows = [item('old', { sourceRunId: 'completed-run', proposedProjectName: 'Edmonton' }), item('new', { createdAt: 20, sourceRunId: 'new-run' }), item('other-user', { capturedForUserId: 'other' })];
  assert.deepEqual(selectReviewItems(rows, {}, { userId: 'user', projectId: 'sharehouse', runId: 'new-run' }).map(i => i.id), ['old', 'new']);
  assert.deepEqual(selectReviewItems(rows, { scope: 'current_run' }, { userId: 'user', projectId: 'sharehouse', runId: 'new-run' }).map(i => i.id), ['new']);
  assert.deepEqual(selectReviewItems(rows, { includeOlderItems: false }, { userId: 'user', projectId: 'sharehouse', startedAt: 10 }).map(i => i.id), ['new']);
});
test('tenant/user context is derived from authentication, source provenance is checked', async () => {
  let captured: any;
  const deps: typeof capturedWorkDependencies = { ...capturedWorkDependencies,
    captureWorkItem: async (org, user, body) => { captured = { org, user, body }; return item(); },
    requireProjectInTenant: async (_org, id) => { if (id !== 'sharehouse') throw new CaptureError(403, 'foreign project'); },
    readFlowRun: async () => null,
    listCaptures: async (org, user) => { assert.equal(org, 'trusted'); assert.equal(user, 'human'); return []; }
  };
  await handleCapturedWork({ method: 'POST', body: { orgId: 'evil', capturedForUserId: 'victim', rawText: 'Bank', idempotencyKey: '1' } }, { orgId: 'trusted', uid: 'human' }, deps);
  assert.equal(captured.org, 'trusted'); assert.equal(captured.user, 'human');
  await assert.rejects(handleCapturedWork({ method: 'POST', body: { sourceProjectId: 'foreign' } }, { orgId: 'trusted', uid: 'human' }, deps), /foreign/);
  await assert.rejects(handleCapturedWork({ method: 'POST', body: { sourceProjectId: 'sharehouse', sourceRunId: 'fake' } }, { orgId: 'trusted', uid: 'human' }, deps), /outside/);
  await handleCapturedWork({ method: 'GET' }, { orgId: 'trusted', uid: 'human' }, deps);
  assert.equal(requestScope({ url: '/api/captured-work-items', method: 'POST' }), 'captured-work-items:write');
  assert.equal(requestScope({ url: '/api/gemini?action=captured-work-items', query: { action: 'captured-work-items' }, method: 'GET' }), 'captured-work-items:read');
});
test('resolution requires explicit confirmation and kind-specific fields; stale edits cannot close work', () => {
  const initial = item();
  assert.throws(() => transition(initial, 'resolve', { version: 1, intent: { kind: 'task', title: 'Bank' } }), /confirmation/);
  assert.throws(() => normalizeIntent({ kind: 'meeting', title: 'Buyer', at: 1000, mode: 'in_person' }, 'intent'), /location/);
  assert.throws(() => normalizeIntent({ kind: 'reminder', title: 'Mail' }, 'intent'), /time/);
  assert.throws(() => transition(initial, 'dismiss', { version: 0 }), /changed/);
  const resolved = transition(initial, 'resolve', { version: 1, confirmed: true, intent: { kind: 'task', title: 'Bank' } });
  assert.equal(resolved.resolvedObjectId, resolved.intent!.id);
  assert.equal(resolved.intent!.executionStatus, 'not_executed');
  assert.throws(() => transition(resolved, 'update', { version: 2, title: 'Changed' }), /closed/);
  assert.equal(transition(resolved, 'resolve', { confirmed: true, intent: { kind: 'task', title: 'Bank' } }), resolved);
});
test('same-run review confirms a task, leaves interrupted second item durable, and resumes in a later run', async () => {
  const { records, deps } = harness([item('one', { title: 'Call Peter', kind: 'task', proposedProjectId: 'edmonton' }), item('two')]);
  let p = project();
  const hook = (p: Project, n: Milestone, org: string) => reviewCapturedWork(p, n, org, deps);
  const executor = async () => { throw new Error('No external action should run'); };
  let result = await advanceProjectFlow(p, executor, { orgId: 'org', reviewCaptures: hook });
  assert.equal(result.askedFor.length, 1);
  assert.equal(result.project.milestones[0].captureReviewState!.stage, 'confirm');
  assert.equal(deriveFlowRunStatus(result.project), 'waiting');
  p = { ...result.project, milestones: [answer(result.project.milestones[0], 'confirm')] };
  assert.ok(continuationHold({ id: 'run', status: 'running', orgId: 'org', projectId: p.id } as any, p), 'answer must schedule durable review continuation');
  assert.ok(continuationHold({ id: 'run', status: 'waiting', orgId: 'org', projectId: p.id } as any, p), 'other waiting branches must not stall this answered review');
  result = await advanceProjectFlow(p, executor, { orgId: 'org', reviewCaptures: hook });
  assert.equal(records.get('one')!.status, 'resolved');
  assert.equal(records.get('two')!.status, 'captured');
  assert.equal(result.project.milestones[0].captureReviewState!.itemIds[result.project.milestones[0].captureReviewState!.cursor], 'two');
  assert.equal(result.project.projectData!.capture_review_results.review.length, 1);
  const later = resetProjectForOccurrence(result.project, 'tomorrow');
  assert.equal(later.milestones[0].captureReviewState, undefined);
  const resumed = await hook(later, later.milestones[0], 'org');
  assert.deepEqual(resumed.node.captureReviewState!.itemIds, ['two']);
});
test('a meeting asks only for missing details and deferring does not resolve it', async () => {
  const { deps, records } = harness([item('meeting', { kind: 'meeting', title: 'Buyer', proposedProjectId: 'edmonton', proposedAt: 1000 })]);
  let n = (await reviewCapturedWork(project(), reviewNode(), 'org', deps)).node;
  assert.equal(n.captureReviewState!.stage, 'mode');
  n = (await reviewCapturedWork(project(), answer(n, 'in_person'), 'org', deps)).node;
  assert.equal(n.captureReviewState!.stage, 'location');
  n = (await reviewCapturedWork(project(), answer(n, 'defer'), 'org', deps)).node;
  assert.ok(n.completedAt); assert.equal(records.get('meeting')!.status, 'captured');
});
test('concurrent review changes trigger fresh confirmation and external dismissal cancels the open Ask', async () => {
  const { deps, records } = harness([item('one', { title: 'Bank', kind: 'task', proposedProjectId: 'edmonton' })]);
  let n = (await reviewCapturedWork(project(), reviewNode(), 'org', deps)).node;
  records.set('one', transition(records.get('one')!, 'update', { version: 1, title: 'Different task' }));
  n = (await reviewCapturedWork(project(), answer(n, 'confirm'), 'org', deps)).node;
  assert.equal(records.get('one')!.status, 'clarifying');
  assert.match(n.asks!.at(-1)!.prompt, /Different task/);
  records.set('one', transition(records.get('one')!, 'dismiss', { version: 2 }));
  n = (await reviewCapturedWork(project(), n, 'org', deps)).node;
  assert.ok(n.completedAt); assert.equal(n.asks!.filter(a => a.status === 'open').length, 0);
});
test('empty review completes the flow; browser clients cannot write capture storage directly', async () => {
  const { deps } = harness([]);
  const n = (await reviewCapturedWork(project(), reviewNode(), 'org', deps)).node;
  assert.equal(deriveFlowRunStatus(project(n)), 'completed');
  const rules = JSON.parse(readFileSync(new URL('../database.rules.json', import.meta.url), 'utf8')).rules;
  assert.equal(rules.captured_work_items['.write'], false);
  assert.match(rules.captured_work_items.$orgId['.write'], /hyperflow-runtime-v1/);
  assert.doesNotMatch(rules.captured_work_items.$orgId['.write'], /members/);
});
