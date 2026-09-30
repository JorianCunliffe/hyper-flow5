import test from 'node:test';
import assert from 'node:assert/strict';
import { repairUndispatchedSmsTemplate, type ActionDispatch } from '../lib/actionDispatch.js';

const context = { orgId: 'org', projectId: 'project', nodeId: 'sms', runId: 'operation', repairInvalidTemplate: true };
const replacement = '{"person_id":"jorian","body":"TEST ONLY"}';
const row: ActionDispatch = { id: 'operation', orgId: 'org', projectId: 'project', nodeId: 'sms',
  flowRunId: 'flow', attempt: 1, idempotencyKey: 'operation', state: 'dispatching',
  owner: 'old-worker', leaseUntil: 99999, createdAt: 1, updatedAt: 1,
  request: { taskType: 'send_sms', template: '<redacted>', data: {}, context } };

test('explicit manual repair keeps operation identity and audit while correcting provably undispatched SMS', () => {
  const repaired = repairUndispatchedSmsTemplate(row, replacement, context, 10);
  assert.equal(repaired.request.template, replacement);
  assert.equal(repaired.id, row.id);
  assert.equal(repaired.flowRunId, row.flowRunId);
  assert.equal(repaired.state, 'claimed');
  assert.equal(repaired.leaseUntil, 0);
  assert.deepEqual(repaired.configurationRepairs, [{ at: 10, priorTemplate: '<redacted>' }]);
});

test('ambiguous provider operations, valid original templates, and background retries remain frozen', () => {
  for (const unsafe of [
    { ...row, providerRequests: { sent: {} } }, { ...row, externalId: 'communication' },
    { ...row, outcome: { status: 'pending' as const } },
    { ...row, terminal: { status: 'success' as const } },
    { ...row, request: { ...row.request, template: '{"person_id":"other"}' } },
    { ...row, request: { ...row.request, data: { contact_phone: '+61400000000' } } },
    { ...row, request: { ...row.request, taskType: 'send_email' } }
  ]) assert.equal(repairUndispatchedSmsTemplate(unsafe, replacement, context, 10), unsafe);
  assert.equal(repairUndispatchedSmsTemplate(row, replacement, { ...context, repairInvalidTemplate: false }, 10), row);
  assert.equal(repairUndispatchedSmsTemplate(row, '{}', context, 10), row);
  assert.equal(repairUndispatchedSmsTemplate(row, replacement, { ...context, projectId: 'other' }, 10), row);
});
