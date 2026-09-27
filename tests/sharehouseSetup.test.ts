import test from 'node:test';
import assert from 'node:assert/strict';
import { handleConfiguration } from '../lib/configuration/api.js';
import { handleTestRuns, simulateProject } from '../lib/configuration/testRuns.js';
import { validateProject } from '../lib/configuration/model.js';
import { advanceProjectFlow } from '../lib/flowOrchestrator.js';
import { createFlowRun, materializeFlowRunProject } from '../lib/flowRun.js';
import { applyFlowEvent } from '../lib/flowEvents.js';
import { normalizeWorkspaceNamedResources } from '../lib/workspaceResourceCatalog.js';
import { fullWorkflow, fixtures, setup, enquiries } from './fixtures/sharehouse/fullWorkflow.js';

const actor = { orgId: setup.orgId, uid: 'fixture-user', apiClientId: 'fixture-client' };
const post = (body: object) => ({ method: 'POST', body });
test('SH-01 all four distinct resource bindings satisfy the real catalog validator', () => {
  const resources = setup.resources.map(r => ({ name: r.name, type: 'google_sheet_range', spreadsheetId: setup.spreadsheet, range: r.range, permissions: r.operations }));
  const normalized = normalizeWorkspaceNamedResources(resources);
  assert.equal(normalized.length, 4);
  assert.deepEqual(normalized.map(r => r.range), ['Tasks!A2:H', 'Enquiries!A2:J', 'Communications!A2:G', 'Inspections!A2:F']);
  assert.deepEqual(normalized.find(r => r.name === 'enquiries')?.permissions, ['read', 'upsert']);
  assert.throws(() => normalizeWorkspaceNamedResources([...resources, resources[0]]), /Duplicate/);
  assert.throws(() => normalizeWorkspaceNamedResources([{ ...resources[0], spreadsheetId: '' }]), /valid spreadsheetId/);
});
async function configured() {
  let stored: any = null;
  const deps = { read: async () => structuredClone(stored), transact: async (_org: string, mutate: any) => {
    stored = JSON.parse(JSON.stringify(mutate(structuredClone(stored)))); return stored;
  } };
  const input = { expectedRevision: 0, requestId: 'sharehouse_setup_001', changes: [{ resource: 'project', operation: 'create', value: fullWorkflow() }] };
  const plan: any = await handleConfiguration(post({ ...input, operation: 'plan' }), actor, deps);
  assert.equal(plan.valid, true, JSON.stringify(plan.issues));
  const apply = { ...input, operation: 'apply', planHash: plan.planHash };
  await handleConfiguration(post(apply), actor, deps);
  return { deps, apply, stored };
}
test('SH-01 configuration handler saves and reloads both complete graph paths without granting dispatch authority', async () => {
  const { deps, stored, apply } = await configured();
  const result: any = await handleConfiguration({ method: 'GET', query: { resource: 'projects', id: 'sharehouse-fixture' } }, actor, deps);
  assert.deepEqual(validateProject(result.item), []);
  assert.deepEqual(result.item.milestones, fullWorkflow().milestones.map((n: any) => ({ ...n, estimatedDuration: 0 })));
  assert.equal(result.item.emailSendingEnabled, undefined);
  assert.equal(result.item.milestones.find((n: any) => n.id === 'morning_answers').holdConfig.human.escalation.retryMinutes, 10);
  assert.equal(stored.dataRevision, 1);
  const replay: any = await handleConfiguration(post(apply), actor, deps);
  assert.equal(replay.revision, 1);
  await assert.rejects(handleConfiguration(post({ ...apply, requestId: 'stale_setup_002' }), actor, deps), /Workspace changed/);
});
test('SH-01 invalid dependencies and authority injection cannot produce an applicable setup', async () => {
  const { deps } = await configured();
  const invalid = fullWorkflow(); invalid.id = 'bad-fixture'; invalid.milestones[0].dependsOn = ['missing'];
  const input = { operation: 'plan', expectedRevision: 1, changes: [{ resource: 'project', operation: 'create', value: invalid }] };
  const plan: any = await handleConfiguration(post(input), actor, deps);
  assert.equal(plan.valid, false);
  assert.ok(plan.issues.some((issue: any) => issue.message.includes('Invalid graph reference')));
  const unauthorized = { ...fullWorkflow(), id: 'unauthorized', emailSendingEnabled: true };
  await assert.rejects(handleConfiguration(post({ ...input, changes: [{ resource: 'project', operation: 'create', value: unauthorized }] }), actor, deps), /server-owned/);
});
test('SH-02–07 fixture processes five tasks and four drafts, then remains held before all finalisation effects', async () => {
  const { stored } = await configured();
  let rows: any = {};
  const deps = { workspace: async () => stored, read: async () => structuredClone(rows), transact: async (_org: string, mutate: any) => (rows = mutate(structuredClone(rows))) };
  const input = { requestId: 'sharehouse_sim_001', expectedRevision: 1, projectId: 'sharehouse-fixture', fixtures, maxRounds: 100, assertions: [{ path: 'data.plan_output.summary', operator: 'exists' }] };
  const { item }: any = await handleTestRuns(post(input), actor, deps);
  assert.equal(item.result.status, 'held', JSON.stringify(item.result));
  assert.equal(item.result.providerCalls, 0);
  assert.equal(item.result.dispatches.filter((d: any) => d.nodeId.startsWith('write_tasks__')).length, 5);
  const drafts = item.result.dispatches.filter((d: any) => d.nodeId.startsWith('drafts__'));
  assert.deepEqual(drafts.map((d: any) => d.inputs.to[0]), enquiries.map(e => e.email));
  assert.ok(item.result.nodes.some((n: any) => n.id === 'morning_answers' && !n.complete));
  assert.equal(item.result.dispatches.some((d: any) => ['finalise', 'update_drafts', 'upsert_enquiries', 'write_slots', 'notify', 'audit', 'acknowledge', 'reply'].some(id => d.nodeId === id || d.nodeId.startsWith(id + '__'))), false);
  const replay: any = await handleTestRuns(post(input), actor, deps);
  assert.equal(replay.duplicate, true);
  assert.equal(Object.keys(rows).length, 1);
  await assert.rejects(handleTestRuns({ method: 'GET', query: { id: item.id } }, { ...actor, apiClientId: 'another-client' }, deps), /not found/);
});
test('failed intake cannot dispatch tasks, drafts, or finalisation', async () => {
  const result = await simulateProject(fullWorkflow(), { fixtures: { ...fixtures, triage: { status: 'error', error: 'Mailbox unavailable' } }, maxRounds: 100, assertions: [{ path: 'dispatches.0', operator: 'exists' }] }, 'failed-intake');
  assert.equal(result.status, 'failed');
  assert.ok(result.dispatches.every(d => ['triage', 'read_enquiries', 'read_inspections'].includes(d.nodeId)));
});
test('SH-16 isolated inbound event acknowledges only its branch and holds for the team answer', async () => {
  const source = fullWorkflow();
  const incoming = applyFlowEvent(source, { id: 'fixture-event', type: 'communication.received', occurredAt: 1790553600000, personId: 'enquirer-E1', channel: 'sms', direction: 'inbound' });
  const run = createFlowRun({ orgId: setup.orgId, project: incoming.project, occurrenceId: incoming.occurrenceId, trigger: 'event', triggerId: 'fixture-event' });
  const sent: string[] = [];
  const result = await advanceProjectFlow(materializeFlowRunProject(source, run), async (_type, _template, _data, ctx) => { sent.push(ctx.nodeId); return { status: 'success', output: { delivered: true } }; }, { maxRounds: 100 });
  assert.deepEqual(sent, ['acknowledge']);
  assert.equal(result.askedFor.length, 1);
  assert.equal(result.askedFor[0].nodeId, 'incident_answers');
  assert.equal(result.askedFor[0].ask.runId, run.id);
});
