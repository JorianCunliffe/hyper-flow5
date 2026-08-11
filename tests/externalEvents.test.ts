import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createExternalEventRecord, normalizeExternalEvent } from '../lib/externalEvents';

describe('external event inbox envelope', () => {
  test('normalizes explicit communications correlation', () => {
    const event = normalizeExternalEvent({
      event_id: 'evt_987', source: 'communications', type: 'call.completed', communication_id: 'comm_123',
      correlation: { tenant_id: 'org_1', project_id: 'project_1', run_id: 'run_8', task_id: 'task_19' },
      payload: { summary: 'Jim agreed to 10:30.' }
    });
    assert.equal(event.correlation.task_id, 'task_19');
    assert.equal(event.communication_id, 'comm_123');
  });

  test('preserves explicit ask identity and structured channel response', () => {
    const event = normalizeExternalEvent({
      event_id: 'evt_ask_1', source: 'communications', type: 'ask.response.received',
      ask_id: 'ask_42', channel: 'voice', communication_id: 'comm_42', transcript_id: 'tr_42',
      correlation: { tenant_id: 'org_1', project_id: 'project_1', person_id: 'person_7' },
      response: { text: 'Approved', structured: { decision: 'approved' } }
    });
    assert.equal(event.ask_id, 'ask_42');
    assert.equal(event.channel, 'voice');
    assert.equal(event.transcript_id, 'tr_42');
    assert.equal(event.correlation.person_id, 'person_7');
    assert.deepEqual(event.response?.structured, { decision: 'approved' });
  });

  test('creates a persist-first inbox record with audit fields', () => {
    const event = normalizeExternalEvent({ event_id: 'evt_1', source: 'communications', type: 'sms.received' });
    const record = createExternalEventRecord(event, new Date('2026-08-11T00:00:00.000Z'));
    assert.deepEqual(
      { id: record.id, event_id: record.event_id, processing_status: record.processing_status, received_at: record.received_at },
      { id: 'evt_1', event_id: 'evt_1', processing_status: 'received', received_at: '2026-08-11T00:00:00.000Z' }
    );
    assert.equal(record.payload.event_id, 'evt_1', 'the complete event envelope is retained for replay and audit');
  });

  test('rejects an event without an id before it can be claimed', () => {
    assert.throws(() => normalizeExternalEvent({ source: 'communications', type: 'call.completed' }), /event_id is required/);
  });
});
