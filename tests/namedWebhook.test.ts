import test from 'node:test';
import assert from 'node:assert/strict';
import { executeNamedWebhook } from '../lib/namedWebhook.js';

const secret = 'private-token-123456';
const url = `https://example.com/availability?zapikey=${secret}`;
const env = {
  WEBHOOK_CONNECTIONS_JSON: JSON.stringify({ rooms: { orgId: 'org1', projectIds: ['project1'],
    urlEnv: 'WEBHOOK_SECRET_ROOMS', responsePath: ['details', 'userMessage'], successField: 'code', successValue: 'success' } }),
  WEBHOOK_SECRET_ROOMS: url
};
const scope = { orgId: 'org1', projectId: 'project1' };
const input = { connection_name: 'rooms', method: 'GET' };
const response = (userMessage: unknown) => ({ ok: true, status: 200, url,
  text: JSON.stringify({ code: 'success', details: { userMessage }, internalUrl: url }) });

test('returns only selected fresh evidence, preserves empty availability, and never exposes secret envelope', async () => {
  for (const rooms of [[], ['The Martyn-U2-R6']]) {
    const result = await executeNamedWebhook(input, scope, env, async (target, init) => {
      assert.equal(target, url); assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'error');
      assert.equal(init.body, undefined); return response(rooms);
    });
    assert.deepEqual(result.webhook_response, rooms);
    assert.ok(result.webhook_fetched_at); assert.equal(JSON.stringify(result).includes(secret), false);
  }
});

test('rejects missing or wrong trusted scope before making any request', async () => {
  for (const badScope of [undefined, {}, { orgId: 'other', projectId: 'project1' }, { orgId: 'org1', projectId: 'other' }]) {
    await assert.rejects(executeNamedWebhook(input, badScope, env, async () => { assert.fail('must not fetch'); }), /not configured/);
  }
});

test('cannot override destination, headers, method or payload', async () => {
  for (const extra of [{ url: 'https://attacker.example' }, { headers: {} }, { payload: {} }, { method: 'POST' }]) {
    await assert.rejects(executeNamedWebhook({ ...input, ...extra }, scope, env), /GET only/);
  }
});

test('fails closed without leaking transport errors, credentials, malformed or provider-failure responses', async () => {
  for (const fetcher of [
    async () => { throw new Error(`failed ${url}`); },
    async () => response(secret),
    async () => response(encodeURIComponent(url)),
    async () => ({ ...response([]), ok: false, status: 500 }),
    async () => ({ ...response([]), text: '{bad json' }),
    async () => ({ ...response([]), text: '{"code":"error","details":{"userMessage":[]}}' }),
    async () => ({ ...response([]), text: '{"code":"success","details":{}}' })
  ]) {
    await assert.rejects(executeNamedWebhook(input, scope, env, fetcher), error => {
      assert.equal(String(error).includes(secret), false); assert.match(String(error), /invalid response/); return true;
    });
  }
});

test('invalid registry and missing secret are explicit configuration failures', async () => {
  await assert.rejects(executeNamedWebhook(input, scope, { WEBHOOK_CONNECTIONS_JSON: '{' }), /configuration is invalid/);
  await assert.rejects(executeNamedWebhook(input, scope, { ...env, WEBHOOK_SECRET_ROOMS: '' }), /secret is missing/);
});
