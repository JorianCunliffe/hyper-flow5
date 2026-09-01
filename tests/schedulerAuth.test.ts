import assert from 'node:assert/strict';
import test from 'node:test';
import { signCommunicationsBodyV2 } from '../lib/communications/webhook.js';
import { isSchedulerTickAuthorized, schedulerAuthenticationConfigured } from '../lib/schedulerAuth.js';

const now = Date.UTC(2026, 7, 31, 7, 0, 0);
const timestamp = String(Math.floor(now / 1000));

test('scheduler authentication reports every supported backend credential', () => {
  assert.equal(schedulerAuthenticationConfigured({}), false);
  assert.equal(schedulerAuthenticationConfigured({ schedulerSecret: 'scheduler' }), true);
  assert.equal(schedulerAuthenticationConfigured({ cronSecret: 'cron' }), true);
  assert.equal(schedulerAuthenticationConfigured({ communicationsWebhookSecret: 'webhook' }), true);
});

test('accepts a current Communications HMAC for an empty POST body', () => {
  const secret = 'shared-webhook-secret';
  assert.equal(isSchedulerTickAuthorized({
    method: 'POST',
    headers: {
      'x-communications-timestamp': timestamp,
      'x-communications-signature-v2': signCommunicationsBodyV2(timestamp, '', secret)
    }
  }, { communicationsWebhookSecret: secret }, now), true);
});

test('rejects stale, malformed, or GET Communications signatures', () => {
  const secret = 'shared-webhook-secret';
  const signature = signCommunicationsBodyV2(timestamp, '', secret);
  assert.equal(isSchedulerTickAuthorized({ method: 'GET', headers: {
    'x-communications-timestamp': timestamp,
    'x-communications-signature-v2': signature
  } }, { communicationsWebhookSecret: secret }, now), false);
  assert.equal(isSchedulerTickAuthorized({ method: 'POST', headers: {
    'x-communications-timestamp': timestamp,
    'x-communications-signature-v2': signature
  } }, { communicationsWebhookSecret: secret }, now + 6 * 60_000), false);
  assert.equal(isSchedulerTickAuthorized({ method: 'POST', headers: {
    'x-communications-timestamp': timestamp,
    'x-communications-signature-v2': 'sha256=invalid'
  } }, { communicationsWebhookSecret: secret }, now), false);
});

test('retains scheduler-secret and cron bearer compatibility', () => {
  assert.equal(isSchedulerTickAuthorized({ method: 'GET', headers: {
    'x-hyperflow-scheduler-secret': 'scheduler'
  } }, { schedulerSecret: 'scheduler' }, now), true);
  assert.equal(isSchedulerTickAuthorized({ method: 'POST', headers: {
    authorization: 'Bearer cron'
  } }, { cronSecret: 'cron' }, now), true);
});
