import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createExternalEventRecord, normalizeExternalEvent, terminalExternalEventResult, terminalExternalEventStatus } from '../lib/externalEvents';

const fixture = (name: string): any => JSON.parse(readFileSync(
  new URL(`./fixtures/communications/${name}`, import.meta.url), 'utf8'
));

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

  test('normalizes the real SMS Ask event fixture after authenticated source defaulting', () => {
    const event = normalizeExternalEvent(fixture('ask-response-event.json'), 'communications');
    assert.equal(event.source, 'communications');
    assert.equal(event.ask_id, 'ask_42');
    assert.equal(event.channel, 'sms');
    assert.equal(event.response?.text, 'Approved');
  });

  test('normalizes structured voice transcript evidence without classifying it', () => {
    const transcript = { segments: [{ speaker: 'caller', text: 'Maybe, let me check.' }] };
    const event = normalizeExternalEvent({
      event_id: 'evt_voice', type: 'ask.response.received', purpose: { ask_id: 'ask_1' },
      correlation: {}, payload: { channel: 'voice', transcript }
    }, 'communications');
    assert.equal(event.response?.text, JSON.stringify(transcript));
    assert.deepEqual(event.payload.transcript, transcript);
  });

  test('uses an explicit terminal event map', () => {
    assert.equal(terminalExternalEventStatus('call.completed'), 'success');
    assert.equal(terminalExternalEventStatus('call.failed'), 'error');
    assert.equal(terminalExternalEventStatus('sms.delivered'), 'success');
    assert.equal(terminalExternalEventStatus('sms.failed'), 'error');
    assert.equal(terminalExternalEventStatus('transcript.completed'), null);
    assert.equal(terminalExternalEventStatus('future.completed'), null);
  });

  test('classifies current Communications sms.sent payload statuses', () => {
    assert.equal(terminalExternalEventStatus('sms.sent', { status: 'failed' }), 'error');
    assert.equal(terminalExternalEventStatus('sms.sent', { status: 'undelivered' }), 'error');
    assert.equal(terminalExternalEventStatus('sms.sent', { status: 'delivered' }), 'success');
    assert.equal(terminalExternalEventStatus('sms.sent', { status: 'queued' }), null);
  });

  test('uses failed-call disposition and reason and rejects contradictory completed events', () => {
    const failed = normalizeExternalEvent({
      event_id: 'evt_failed', source: 'communications', type: 'call.failed', correlation: {},
      payload: { disposition: 'voicemail', successful: false, memory_eligible: false, failure_reason: 'Answering machine detected' }
    });
    assert.deepEqual(terminalExternalEventResult(failed), {
      status: 'error', error: 'Answering machine detected',
      log: 'Communication failed (voicemail): Answering machine detected'
    });

    const contradictory = normalizeExternalEvent({
      event_id: 'evt_bad_completed', source: 'communications', type: 'call.completed', correlation: {},
      payload: { disposition: 'wrong_number', successful: false, memory_eligible: false }
    });
    assert.equal(terminalExternalEventResult(contradictory)?.status, 'error');
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
