import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { HttpCommunicationsClient } from '../lib/communications/client';
import { CommunicationsApiError, CommunicationsConfigurationError } from '../lib/communications/errors';
import { executeTask } from '../lib/executeTask';
import { deliverAsk } from '../lib/asks/deliverAsk';
import { resolveIdentityFromSettings } from '../lib/serverStore';

const fixture = (name: string): any => JSON.parse(readFileSync(
  new URL(`./fixtures/communications/${name}`, import.meta.url), 'utf8'
));

describe('HttpCommunicationsClient current Communications Service contract', () => {
  test('sends the real SMS fixture with X-API-Key and reads communication_id', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(fixture('sms-response.json')), { status: 201 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example/', apiKey: 'secret', fetchImpl });
    const request = fixture('sms-request.json');
    const result = await client.sendSms(request);

    assert.equal(result.id, 'comm_1');
    assert.equal(calls[0].url, 'https://communications.example/v1/messages');
    assert.equal(calls[0].init.headers['X-API-Key'], 'secret');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'hyperflow:org_1:p1:r1:SMS:sms:action');
    assert.equal(calls[0].init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(calls[0].init.body), request);
  });

  test('accepts legacy id only as a response fallback', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ id: 'comm_legacy', status: 'queued' }), { status: 202 });
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    assert.equal((await client.sendSms(fixture('sms-request.json'))).id, 'comm_legacy');
  });

  test('starts calls with from and allow-listed voice overrides', async () => {
    let body: any;
    const fetchImpl: typeof fetch = async (_url: any, init?: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ communication_id: 'comm_2', channel: 'voice' }), { status: 201 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await client.startCall({
      to: '+61400000000', from: '+61411111111',
      overrides: { systemMessage: 'Confirm Thursday.', greetingText: 'Ask about Thursday.', aiSpeaksFirst: true, liveTranscript: true },
      callback_url: 'https://hyperflow.example/api/events',
      correlation: { tenant_id: 'org_1', project_id: 'p1', run_id: 'r1', task_id: 'CALL' }
    });
    assert.equal(body.from, '+61411111111');
    assert.deepEqual(Object.keys(body.overrides).sort(), ['aiSpeaksFirst', 'greetingText', 'liveTranscript', 'systemMessage']);
    assert.equal(body.provider, undefined);
  });

  test('resolves an Ask idempotently from the service response', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ ask_id: 'ask_1', status: 'resolved', communication_id: 'comm_answer', duplicate: true }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.resolveAsk('ask_1', 'comm_answer');
    assert.equal(calls[0].url, 'https://communications.example/v1/asks/ask_1/resolve');
    assert.deepEqual(calls[0].body, { communication_id: 'comm_answer' });
    assert.equal(result.status, 'resolved');
  });

  test('requires URL and key configuration', () => {
    assert.throws(() => new HttpCommunicationsClient({ baseUrl: '', apiKey: '' }), CommunicationsConfigurationError);
  });

  test('turns non-2xx responses into a typed API error', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await assert.rejects(client.getCommunication('comm_1'), (error: any) => error instanceof CommunicationsApiError && error.status === 400);
  });
});

describe('executeTask communications routing', () => {
  test('translates SMS into the current request and preserves workflow correlation', async () => {
    const original = {
      url: process.env.COMMUNICATIONS_API_URL, key: process.env.COMMUNICATIONS_API_KEY,
      from: process.env.COMMUNICATIONS_FROM_NUMBER, publicUrl: process.env.PUBLIC_BASE_URL,
      fetch: globalThis.fetch
    };
    let request: any;
    process.env.COMMUNICATIONS_API_URL = 'https://communications.example';
    process.env.COMMUNICATIONS_API_KEY = 'secret';
    process.env.COMMUNICATIONS_FROM_NUMBER = '+61411111111';
    process.env.PUBLIC_BASE_URL = 'https://hyperflow.example';
    globalThis.fetch = async (_url: any, init?: any) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify({ communication_id: 'comm_sms_1', channel: 'sms' }), { status: 201 });
    };

    try {
      const result = await executeTask('send_sms', '{"to":"+61400000000","body":"Can you attend tomorrow?"}', {}, {
        correlation: { orgId: 'tenant_1', projectId: 'project_1', runId: 'run_8', nodeId: 'task_19' }
      });
      assert.equal(result.httpStatus, 202);
      assert.equal(request.body, 'Can you attend tomorrow?');
      assert.equal(request.from, '+61411111111');
      assert.equal(request.callback_url, 'https://hyperflow.example/api/events');
      assert.deepEqual(request.correlation, { tenant_id: 'tenant_1', external_project_id: 'project_1', run_id: 'run_8', task_id: 'task_19' });
      assert.equal(result.body.logs.some((line: string) => line.includes(request.body) || line.includes(request.to)), false);
    } finally {
      globalThis.fetch = original.fetch;
      for (const [key, value] of [['COMMUNICATIONS_API_URL', original.url], ['COMMUNICATIONS_API_KEY', original.key], ['COMMUNICATIONS_FROM_NUMBER', original.from], ['PUBLIC_BASE_URL', original.publicUrl]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });
});

describe('channel-specific Ask delivery', () => {
  test('sends an SMS Ask through /v1/messages semantics, never /v1/asks', async () => {
    let request: any;
    const client: any = {
      sendSms: async (value: any) => { request = value; return { id: 'comm_ask', status: 'accepted' }; },
      startCall: async () => { throw new Error('wrong channel'); },
      getCommunication: async () => { throw new Error('not used'); },
      resolveAsk: async () => { throw new Error('not used'); }
    };
    const result = await deliverAsk({
      ask: {
        id: 'ask_1', token: 'token_1', kind: 'approval', status: 'open', prompt: 'Approve?',
        nodeId: 'REVIEW', projectId: 'project_1', runId: 'run_1', personId: 'Jorian',
        assignees: ['Jorian'], channels: ['sms'], createdAt: 1, responses: []
      },
      orgId: 'org_1', projectId: 'project_1', personId: 'Jorian', recipient: '+61400000000',
      fromNumber: '+61411111111', channel: 'sms', publicBaseUrl: 'https://hyperflow.example', client
    });
    assert.equal(result.id, 'comm_ask');
    assert.equal(request.body, 'Approve?');
    assert.deepEqual(request.purpose, { type: 'human_ask', ask_id: 'ask_1', token: 'token_1' });
    assert.equal(request.callback_url, 'https://hyperflow.example/api/events');
  });

  test('resolves exact configured identities and fails closed on ambiguity', () => {
    assert.equal(resolveIdentityFromSettings({ Jorian: { phone: '+61400000000' } }, 'Jorian', 'sms'), '+61400000000');
    assert.throws(
      () => resolveIdentityFromSettings({ Jorian: { phone: '+61400000000' }, jorian: { phone: '+61400000001' } }, 'JORIAN', 'voice'),
      /ambiguous/
    );
    assert.throws(() => resolveIdentityFromSettings({ Jorian: {} }, 'Jorian', 'sms'), /no configured phone/);
  });
});
