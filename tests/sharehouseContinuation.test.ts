import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceProjectFlow, type ActionExecutor } from '../lib/flowOrchestrator.js';
import { renderActionTemplate } from '../lib/flowData.js';
import { applyAskToProject, recordAskResponse, upsertAsk } from '../lib/humanAsk.js';
import { resolveHumanWait } from '../lib/asks/respondToAsk.js';
import { createFlowRun, materializeFlowRunProject, updateFlowRunFromProject } from '../lib/flowRun.js';
import { encodeRtdbRecord, decodeRtdbRecord } from '../lib/rtdbJson.js';
import { fullWorkflow, fixtures, enquiries } from './fixtures/sharehouse/fullWorkflow.js';
import type { HumanResponse } from '../types.js';

// Synthetic planning/provider boundaries. Exercises the connected graph and
// response/runtime/persistence transformations, not live provider acceptance.
test('Sharehouse morning resumes partial answers, updates the same four drafts and does not replay effects', async () => {
  const definition = fullWorkflow();
  const run = createFlowRun({ orgId: 'sharehouse-test', project: definition, occurrenceId: 'morning-continuation', trigger: 'manual' });
  const effects: Array<{ node: string; input: any }> = [];
  const executor: ActionExecutor = async (_type, template, data, context) => {
    const input = renderActionTemplate(template, data).templateData;
    const node = context.nodeId.split('__')[0];
    effects.push({ node, input });
    if (node === 'drafts') return { status: 'success', output: { provider_draft_id: `draft-${data.item.id}` } };
    if (node === 'plan') return { status: 'success', output: { ...fixtures.plan.output, open_questions: [
      { name: 'time', type: 'text', label: 'Inspection time?', required: true },
      { name: 'capacity', type: 'number', label: 'Capacity?', required: true }
    ] } };
    if (node === 'finalise') {
      assert.deepEqual(input.answers.values, { time: '14:00', capacity: 2 });
      assert.equal(input.drafts.items.length, 4);
      return { status: 'success', output: {
        drafts: input.drafts.items.map((entry: any) => ({ provider_draft_id: entry.output.provider_draft_id, email: entry.item.email, text: entry.item.id === 'E4' ? 'Attendance recorded; no repeat invitation.' : 'Confirmed fixture response.' })),
        enquiries: enquiries.map(e => ({ email: e.email, operationId: `allocation-${e.id}`, row: ['2026-09-28', e.name, e.email, '', e.property, e.attended ? 'attended' : 'allocated', e.mobile ? '14:00' : '', e.attended, 'fixture', '2026-09-28'] })),
        slots: [{ id: 'shared-slot', rows: [['2026-09-28', '14:00', 'Fixture House', 'E1,E2', 2, 'confirmed']] }],
        notifications: enquiries.filter(e => e.mobile && !e.attended).map(e => ({ personId: `enquirer-${e.id}`, body: 'Your fixture inspection is confirmed at 14:00.' })),
        auditRows: [['2026-09-28', 'Fixture', 'sms', 'outbound', '', '', 'Two confirmed allocations']], auditOperationId: 'audit-morning'
      } };
    }
    if (node === 'update_drafts') assert.match(input.provider_draft_id, /^draft-E[1-4]$/);
    if (node === 'upsert_enquiries') assert.equal(input.values[input.key_column], input.key_value);
    return (fixtures as any)[node] || { status: 'success', output: { saved: true } };
  };
  let state = await advanceProjectFlow(materializeFlowRunProject(definition, run), executor, { orgId: 'sharehouse-test', maxRounds: 100 });
  assert.equal(effects.filter(e => e.node === 'write_tasks').length, 5);
  assert.equal(effects.filter(e => e.node === 'drafts').length, 4);
  assert.equal(effects.some(e => e.node === 'finalise'), false);
  const held = state.askedFor.find(entry => entry.nodeId === 'morning_answers')!;
  assert.ok(held);
  const answer = (id: string, values: Record<string, any>): HumanResponse => ({ id, at: 1, via: 'sms', actor: 'team-primary', values });
  let ask = recordAskResponse(held.ask, answer('partial', { time: '14:00' }));
  assert.equal(ask.status, 'open');
  let project = { ...state.project, milestones: state.project.milestones.map(n => n.id === ask.nodeId ? upsertAsk(n, ask) : n) };
  state = await advanceProjectFlow(project, executor, { orgId: 'sharehouse-test', maxRounds: 100 });
  assert.equal(effects.some(e => e.node === 'finalise'), false);
  // Simulate a worker restart through the production durable serializer.
  const persisted = decodeRtdbRecord(encodeRtdbRecord(updateFlowRunFromProject(run, state.project)));
  project = materializeFlowRunProject(definition, persisted as any);
  ask = project.milestones.find(n => n.id === 'morning_answers')!.asks!.find(a => a.id === ask.id)!;
  const finalAnswer = answer('confirmed', { capacity: 2 });
  ask = recordAskResponse(ask, finalAnswer);
  project = { ...project, milestones: project.milestones.map(n => n.id === ask.nodeId ? upsertAsk(n, ask) : n) };
  project = resolveHumanWait(applyAskToProject(project, ask.id), ask.nodeId, ask, finalAnswer, 10);
  state = await advanceProjectFlow(project, executor, { orgId: 'sharehouse-test', maxRounds: 100 });
  assert.deepEqual(effects.filter(e => e.node === 'update_drafts').map(e => e.input.provider_draft_id), ['draft-E1', 'draft-E2', 'draft-E3', 'draft-E4']);
  assert.equal(effects.filter(e => e.node === 'upsert_enquiries').length, 4);
  assert.equal(effects.filter(e => e.node === 'write_slots').length, 1);
  assert.deepEqual(effects.filter(e => e.node === 'notify').map(e => e.input.person_id), ['enquirer-E1', 'enquirer-E2']);
  assert.ok(effects.findIndex(e => e.node === 'notify') > effects.findIndex(e => e.node === 'write_slots'));
  assert.equal(effects.filter(e => e.node === 'audit').length, 1);
  const count = effects.length;
  await advanceProjectFlow(state.project, executor, { orgId: 'sharehouse-test', maxRounds: 100 });
  assert.equal(effects.length, count);
});
