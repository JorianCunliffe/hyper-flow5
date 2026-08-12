import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parseSignedJsonBody, signCommunicationsBody, verifyCommunicationsSignature } from '../lib/communications/webhook';

describe('Communications webhook authentication', () => {
  test('verifies HMAC over the exact raw bytes', () => {
    const compact = Buffer.from('{"event_id":"evt_1"}');
    const spaced = Buffer.from('{ "event_id": "evt_1" }');
    const signature = signCommunicationsBody(compact, 'webhook-secret');
    assert.equal(verifyCommunicationsSignature(compact, signature, 'webhook-secret'), true);
    assert.equal(verifyCommunicationsSignature(spaced, signature, 'webhook-secret'), false);
    assert.equal(verifyCommunicationsSignature(compact, 'sha256=bad', 'webhook-secret'), false);
  });

  test('parses JSON only after signature verification', () => {
    assert.deepEqual(parseSignedJsonBody(Buffer.from('{"type":"sms.delivered"}')), { type: 'sms.delivered' });
    assert.throws(() => parseSignedJsonBody(Buffer.from('{bad')), /valid JSON/);
  });
});
