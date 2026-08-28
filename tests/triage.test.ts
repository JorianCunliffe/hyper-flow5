import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { triageItemFromCommunication, triageItemFromEvent } from '../lib/triage/emailTriage';
import type { ExternalEventEnvelope } from '../lib/externalEvents';

const event = (overrides: Partial<ExternalEventEnvelope> = {}): ExternalEventEnvelope => ({
  event_id: 'evt_1', source: 'communications', type: 'communication.received',
  communication_id: 'comm_1', channel: 'email', occurred_at: '2026-08-28T01:00:00Z',
  correlation: { tenant_id: 'org_1' }, payload: {}, ...overrides
});

describe('tenant email triage projection', () => {
  test('excludes automatic replies, bounces, and spam from memory and workflow progression', () => {
    for (const classification of ['automatic_reply', 'bounce', 'spam']) {
      const item = triageItemFromEvent(event({ payload: { triage: classification, content: 'Automated content' } }));
      assert.equal(item.disposition, 'spam_automatic');
      assert.equal(item.memoryEligible, false);
      assert.equal(item.preview, 'Automated content');
    }
  });

  test('links a correlated human email to its Ask for interpretation', () => {
    const item = triageItemFromEvent(event({
      ask_id: 'ask_1', response: { text: 'Wednesday afternoon works.' },
      correlation: { tenant_id: 'org_1', project_id: 'project_1', run_id: 'run_1', task_id: 'EMAIL' }
    }));
    assert.equal(item.orgId, 'org_1');
    assert.equal(item.askId, 'ask_1');
    assert.equal(item.disposition, 'awaiting_interpretation');
    assert.equal(item.memoryEligible, true);
  });

  test('marks an outbound email failure as a visible delivery failure', () => {
    const item = triageItemFromEvent(event({ type: 'email.failed', payload: { error: 'Mailbox unavailable' } }));
    assert.equal(item.direction, 'outbound');
    assert.equal(item.disposition, 'delivery_failure');
  });

  test('reconciles a Communications record without crossing tenant scope', () => {
    const item = triageItemFromCommunication('org_a', {
      id: 'comm_8', status: 'completed', channel: 'email', direction: 'inbound',
      occurredAt: '2026-08-28T02:00:00Z', content: 'Please send the revised draft.',
      purpose: { type: 'human_ask', ask_id: 'ask_8' },
      correlation: { tenant_id: 'org_a', external_project_id: 'project_8', run_id: 'run_8', task_id: 'task_8' }
    });
    assert.equal(item.orgId, 'org_a');
    assert.equal(item.projectId, 'project_8');
    assert.equal(item.askId, 'ask_8');
  });
});
