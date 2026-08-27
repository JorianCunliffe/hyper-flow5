import assert from 'node:assert/strict';
import { afterEach, describe, test } from 'node:test';
import { externalEventHttpStatus, POST } from '../api/events.js';
import { createExternalEventRecord, normalizeExternalEvent } from '../lib/externalEvents.js';
import { beginExternalEventProcessingAtRef, projectIdsMatch, projectRevisionsMatch } from '../lib/serverStore.js';

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

  test('atomically inserts and claims when Firebase starts with an empty local cache', async () => {
    const event = createExternalEventRecord(normalizeExternalEvent({
      event_id: 'evt_new', source: 'communications', type: 'communication.created'
    }), new Date('2026-08-26T00:00:00.000Z'));
    let stored: any = null;
    const ref = {
      transaction: async (update: (current: any) => any) => {
        stored = update(null);
        return { committed: stored !== undefined, snapshot: { val: () => stored } };
      }
    };

    const claim = await beginExternalEventProcessingAtRef(
      ref, event, 'claim_new', new Date('2026-08-26T00:00:01.000Z')
    );
    assert.equal(claim.claimed, true);
    assert.equal(claim.record?.processing_status, 'processing');
    assert.equal(claim.record?.processing_claim_id, 'claim_new');
  });

  test('claims the server record after an initial empty-cache callback', async () => {
    const incoming = createExternalEventRecord(normalizeExternalEvent({
      event_id: 'evt_retry', source: 'communications', type: 'call.completed', payload: { version: 'incoming' }
    }), new Date('2026-08-26T00:00:00.000Z'));
    const canonical = {
      ...incoming,
      received_at: '2026-08-25T23:59:00.000Z',
      payload: { ...incoming.payload, payload: { version: 'canonical' } },
      processing_status: 'received' as const
    };
    const ref = {
      transaction: async (update: (current: any) => any) => {
        assert.equal(update(null).processing_claim_id, 'claim_retry');
        const stored = update(canonical);
        return { committed: stored !== undefined, snapshot: { val: () => stored } };
      }
    };

    const claim = await beginExternalEventProcessingAtRef(
      ref, incoming, 'claim_retry', new Date('2026-08-26T00:00:01.000Z')
    );
    assert.equal(claim.claimed, true);
    assert.equal(claim.record?.received_at, canonical.received_at);
    assert.deepEqual(claim.record?.payload.payload, { version: 'canonical' });
  });

  test('does not claim a processed or actively-processing duplicate, but recovers a stale claim', async () => {
    const event = createExternalEventRecord(normalizeExternalEvent({
      event_id: 'evt_duplicate', source: 'communications', type: 'communication.created'
    }), new Date('2026-08-26T00:00:00.000Z'));
    const run = async (serverRecord: any, claimId: string) => beginExternalEventProcessingAtRef({
      transaction: async (update: (current: any) => any) => {
        update(null); // Firebase's local-cache callback must never abort the transaction.
        const stored = update(serverRecord);
        return { committed: stored !== undefined, snapshot: { val: () => stored ?? serverRecord } };
      }
    }, event, claimId, new Date('2026-08-26T00:10:00.000Z'), 60_000);

    assert.equal((await run({ ...event, processing_status: 'processed' }, 'processed')).claimed, false);
    assert.equal((await run({
      ...event, processing_status: 'processing', processing_started_at: '2026-08-26T00:09:30.000Z'
    }, 'active')).claimed, false);
    const stale = await run({
      ...event, processing_status: 'processing', processing_started_at: '2026-08-26T00:08:00.000Z'
    }, 'stale');
    assert.equal(stale.claimed, true);
    assert.equal(stale.record?.processing_claim_id, 'stale');
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
