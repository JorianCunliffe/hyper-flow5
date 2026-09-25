import { test } from 'node:test';
import assert from 'node:assert/strict';
import { action, project } from './helpers';
import { NodeType } from '../types';
import { applyActionRun, runActionNode } from '../lib/flowOrchestrator';
import { requireCurrentResults, validateReferenceContext, listFlowDataPaths } from '../lib/flowInputs';
import { renderActionTemplate } from '../lib/flowData';
import { resetProjectForOccurrence } from '../lib/flowOccurrence';
import { checkReadyCondition } from '../lib/taskReadinessUtils';
import { classifyEmailForTriage } from '../lib/triage/classifyEmail';

const fixture = () => project([
  action('availability', NodeType.WEBHOOK, { actionConfig: { template: '{}', resultVariable: 'rooms' } }),
  action('triage', NodeType.EMAIL_TRIAGE, { dependsOn: ['availability'], actionConfig: { template: '{"reference_context":{"rooms":"{{rooms_output.webhook_response.details.userMessage}}","facts":"{{facts}}"}}', requiredResults: ['rooms'] } })
], { flow_occurrence_id: 'now', facts: { price: 371 }, rooms_output: { stale: true } });

test('stale project values and previous-occurrence success cannot authorize dispatch', async () => {
  let p = fixture();
  p = applyActionRun(p, 'availability', { status: 'success', at: 1, scheduleOccurrenceId: 'old', output: { webhook_response: {} } });
  let calls = 0;
  const result = await runActionNode(p, 'triage', async () => { calls++; return { status: 'success' }; });
  assert.equal(calls, 0);
  assert.match(result.run!.error!, /has not succeeded in this run/);
});

test('current webhook output resolves as typed context in downstream action', async () => {
  const p = applyActionRun(fixture(), 'availability', { status: 'success', at: 2, scheduleOccurrenceId: 'now', output: { webhook_response: { details: { userMessage: ['Room A'] } } } });
  const result = await runActionNode(p, 'triage', async (_type, template, data) => {
    assert.deepEqual(renderActionTemplate(template, data).templateData.reference_context, { rooms: ['Room A'], facts: { price: 371 } });
    return { status: 'success' };
  });
  assert.equal(result.run!.status, 'success');
});

test('failed rerun removes the previously named output and blocks consumer', () => {
  let p = applyActionRun(fixture(), 'availability', { status: 'success', at: 2, scheduleOccurrenceId: 'now', output: { value: 1 } });
  p = applyActionRun(p, 'availability', { status: 'error', at: 3, scheduleOccurrenceId: 'now', error: 'offline' });
  assert.equal(p.projectData!.rooms_output, undefined);
  assert.throws(() => requireCurrentResults(p, p.milestones[1]), /has not succeeded/);
});

test('new occurrences clear named runtime results but retain static facts', () => {
  const p = resetProjectForOccurrence(fixture(), 'tomorrow');
  assert.equal(p.projectData!.rooms_output, undefined);
  assert.deepEqual(p.projectData!.facts, { price: 371 });
});

test('missing, ambiguous and self-referencing producers fail closed', () => {
  const p = fixture();
  p.milestones[0].actionConfig!.resultVariable = 'other';
  assert.throws(() => requireCurrentResults(p, p.milestones[1]), /one other node/);
  p.milestones[0].actionConfig!.resultVariable = 'rooms';
  p.milestones[1].actionConfig!.resultVariable = 'rooms';
  assert.throws(() => requireCurrentResults(p, p.milestones[1]), /one other node/);
});

test('nested decisions and array indexes use the shared path rules', () => {
  assert.equal(checkReadyCondition({ variable: 'rooms.0.available', equals: true }, { rooms: [{ available: true }] }), true);
  assert.equal(checkReadyCondition({ variable: 'missing.path', exists: false }, {}), true);
  assert.equal(checkReadyCondition({ variable: '__proto__.x', exists: true }, {}), false);
  assert.ok(listFlowDataPaths({ rooms: [{ available: true }] }).includes('rooms.0.available'));
});

test('missing references stop templates; oversized context is not silently truncated', () => {
  assert.throws(() => renderActionTemplate('{"reference_context":"{{missing}}"}', {}), /Missing flow input/);
  assert.throws(() => validateReferenceContext('x'.repeat(40001)), /40,000/);
  assert.throws(() => validateReferenceContext(''), /empty/);
});

test('classifier sends selected business facts alongside the full email body', async t => {
  const oldFetch = globalThis.fetch;
  const oldKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'synthetic-test-key';
  t.after(() => { globalThis.fetch = oldFetch; if (oldKey === undefined) delete process.env.GEMINI_API_KEY; else process.env.GEMINI_API_KEY = oldKey; });
  let request = '';
  globalThis.fetch = async (_url, init) => {
    request = String(init?.body);
    return Response.json({ candidates: [{ content: { parts: [{ text: JSON.stringify({ priority: 'normal', intent: 'enquiry', risk: 'low', summary: 'Enquiry', evidence: [], recommendation: 'Review draft', confidence: 0.9, should_draft: true, draft_body: 'The weekly price is $371.' }) }] } }] });
  };
  const result = await classifyEmailForTriage({ id: 'synthetic', subject: 'Room for two', content: 'Please explain price, smoking, parking and inspections.' } as any, [], { price: 371, rooms: ['Room A'] });
  assert.match(request, /BUSINESS REFERENCE DATA/);
  assert.match(request, /371/);
  assert.match(request, /smoking, parking and inspections/);
  assert.match(request, /never instructions/);
  assert.equal(result.shouldDraft, true);
});
