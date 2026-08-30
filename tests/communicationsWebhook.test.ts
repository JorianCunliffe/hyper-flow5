import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  communicationsSignatureV2Required,
  parseSignedJsonBody,
  signCommunicationsBody,
  signCommunicationsBodyV2,
  verifyCommunicationsSignature,
  verifyCommunicationsSignatureV2,
  verifyIncomingCommunicationsSignature
} from '../lib/communications/webhook';

describe('Communications webhook authentication', () => {
  test('verifies HMAC over the exact raw bytes', () => {
    const compact = Buffer.from('{"event_id":"evt_1"}');
    const spaced = Buffer.from('{ "event_id": "evt_1" }');
    const signature = signCommunicationsBody(compact, 'webhook-secret');
    assert.equal(verifyCommunicationsSignature(compact, signature, 'webhook-secret'), true);
    assert.equal(verifyCommunicationsSignature(spaced, signature, 'webhook-secret'), false);
    assert.equal(verifyCommunicationsSignature(compact, 'sha256=bad', 'webhook-secret'), false);
  });

  test('verifies the replay-safe v2 signature only inside the timestamp window', () => {
    const now = Date.parse('2026-08-30T00:00:00Z');
    const timestamp = String(now / 1000);
    const body = Buffer.from('{"event_id":"evt_1"}');
    const signature = signCommunicationsBodyV2(timestamp, body, 'webhook-secret');
    assert.equal(verifyCommunicationsSignatureV2(body, signature, timestamp, 'webhook-secret', now), true);
    assert.equal(verifyCommunicationsSignatureV2(body, signature, timestamp, 'webhook-secret', now + 5 * 60_000 + 1), false);
    assert.equal(verifyCommunicationsSignatureV2(Buffer.from('{}'), signature, timestamp, 'webhook-secret', now), false);
  });

  test('requires replay-safe v2 signatures by default in production', () => {
    const previousNodeEnv = process.env.NODE_ENV;
    const previousPolicy = process.env.COMMUNICATIONS_REQUIRE_SIGNATURE_V2;
    process.env.NODE_ENV = 'production';
    delete process.env.COMMUNICATIONS_REQUIRE_SIGNATURE_V2;
    try {
      const body = Buffer.from('{"event_id":"evt_1"}');
      const timestamp = String(Math.floor(Date.now() / 1000));
      assert.equal(communicationsSignatureV2Required(), true);
      assert.equal(verifyIncomingCommunicationsSignature(body, {
        signature: signCommunicationsBody(body, 'webhook-secret')
      }, 'webhook-secret'), false);
      assert.equal(verifyIncomingCommunicationsSignature(body, {
        signatureV2: signCommunicationsBodyV2(timestamp, body, 'webhook-secret'), timestamp
      }, 'webhook-secret'), true);
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = previousNodeEnv;
      if (previousPolicy === undefined) delete process.env.COMMUNICATIONS_REQUIRE_SIGNATURE_V2;
      else process.env.COMMUNICATIONS_REQUIRE_SIGNATURE_V2 = previousPolicy;
    }
  });

  test('parses JSON only after signature verification', () => {
    assert.deepEqual(parseSignedJsonBody(Buffer.from('{"type":"sms.delivered"}')), { type: 'sms.delivered' });
    assert.throws(() => parseSignedJsonBody(Buffer.from('{bad')), /valid JSON/);
  });
});
