import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { externalEventHttpStatus, POST } from '../api/events.js';
import { claimExternalEventProcessingAtRef, projectIdsMatch, projectRevisionsMatch } from '../lib/serverStore.js';

const originalSecret = process.env.COMMUNICATIONS_WEBHOOK_SECRET;

afterEach(() => {
  if (originalSecret === undefined) delete process.env.COMMUNICATIONS_WEBHOOK_SECRET;
  else process.env.COMMUNICATIONS_WEBHOOK_SECRET = originalSecret;
});

describe('Vercel Communications event intake', () => {
  test('matches callback project IDs regardless of RTDB number/string representation', () => {
    assert.equal(projectIdsMatch(1787628008985, '1787628008985'), true);
    assert.equal(projectIdsMatch('1787628008985', '1787628008985'), true);
    assert.equal(projectIdsMatch(1787628008985, '1787628008986'), false);
  });

  test('treats missing revisions as zero and rejects stale project writes', () => {
    assert.equal(projectRevisionsMatch(undefined, 0), true);
    assert.equal(projectRevisionsMatch(3, 3), true);
    assert.equal(projectRevisionsMatch(4, 3), false);
  });

  test('only acknowledges accepted events and exposes retryable failures as 5xx', () => {
    assert.equal(externalEventHttpStatus({ ok: true }), 200);
    assert.equal(externalEventHttpStatus({ ok: false, retryable: true }), 503);
    assert.equal(externalEventHttpStatus({ ok: false, retryable: false }), 422);
  });

  test('primes the event path before claiming an existing inbox record', async () => {
    let primed = false;
    const event = { processing_status: 'received', processing_error: 'prior failure' };
    const ref = {
      get: async () => { primed = true; },
      transaction: async (update: (current: any) => any) => {
        const next = update(primed ? event : null);
        assert.deepEqual(next, { processing_status: 'processing', processing_error: null });
        return { committed: next !== undefined };
      }
    };

    assert.equal(await claimExternalEventProcessingAtRef(ref), true);
    assert.equal(primed, true);
  });

  test('reads application/json as raw bytes before signature verification', async () => {
    process.env.COMMUNICATIONS_WEBHOOK_SECRET = 'test-secret';
    const response = await POST(new Request('https://hyperflow.example/api/events', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{  "event_id": "evt_1"  }'
    }));

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Invalid or missing Communications signature' });
  });
});
