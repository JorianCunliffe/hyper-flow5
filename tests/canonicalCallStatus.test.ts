import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpCommunicationsClient } from '../lib/communications/client';
import { reconcileEscalationCall } from '../lib/asks/askEscalation';

test('canonical no-answer detail authorizes one timed retry on the original Ask', async () => {
  const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'test',
    fetchImpl: async () => Response.json({ communication_id: 'comm_unanswered', channel: 'voice',
      outcome: { business_status: 'failed', disposition: 'no_answer', successful: false } }) });
  const communication = await client.getCommunication('org_test', 'comm_unanswered');
  assert.equal(communication.status, 'failed');
  assert.equal(communication.outcome?.disposition, 'no_answer');
  const state = reconcileEscalationCall({ primaryPersonId: 'person_test', fallbackPersonId: 'person_test',
    retryMinutes: 10, repeatLocalTime: '09:15', timezone: 'Australia/Brisbane', daysOfWeek: [1, 2, 3, 4, 5] },
    { cycle: 0, step: 0, nextAt: 1000, awaitingId: communication.id }, communication, 2000);
  assert.deepEqual(state, { cycle: 0, step: 1, nextAt: 602000 });
});

test('communication detail preserves completed outcomes and pending or explicit statuses', async () => {
  for (const [body, expected] of [
    [{ outcome: { business_status: 'completed', disposition: 'human_completed' } }, 'completed'],
    [{ outcome: { business_status: 'pending' } }, 'pending'],
    [{ status: 'queued', outcome: { business_status: 'completed' } }, 'queued'],
    [{}, 'accepted'],
  ] as const) {
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'test',
      fetchImpl: async () => Response.json({ communication_id: 'comm_test', channel: 'voice', ...body }) });
    assert.equal((await client.getCommunication('org_test', 'comm_test')).status, expected);
  }
});
