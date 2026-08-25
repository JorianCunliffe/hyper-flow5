import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { externalEventHttpStatus, POST } from '../api/events.js';
import { projectIdsMatch } from '../lib/serverStore.js';

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

  test('only acknowledges accepted events and exposes retryable failures as 5xx', () => {
    assert.equal(externalEventHttpStatus({ ok: true }), 200);
    assert.equal(externalEventHttpStatus({ ok: false, retryable: true }), 503);
    assert.equal(externalEventHttpStatus({ ok: false, retryable: false }), 422);
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
