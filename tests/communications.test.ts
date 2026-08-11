import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { HttpCommunicationsClient } from '../lib/communications/client';
import { CommunicationsApiError, CommunicationsConfigurationError } from '../lib/communications/errors';
import { executeTask } from '../lib/executeTask';

describe('HttpCommunicationsClient', () => {
  test('sends provider-neutral SMS payload and bearer authentication', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ id: 'comm_1', status: 'queued', channel: 'sms' }), {
        status: 202,
        headers: { 'Content-Type': 'application/json' }
      });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example/', apiKey: 'secret', fetchImpl });
    const result = await client.sendSms({
      channel: 'sms', to: '+61400000000', content: 'Can you attend?',
      correlation: { tenant_id: 'org_1', project_id: 'p1', run_id: 'r1', task_id: 'SMS' }
    });

    assert.equal(result.id, 'comm_1');
    assert.equal(calls[0].url, 'https://communications.example/v1/messages');
    assert.equal(calls[0].init.headers.Authorization, 'Bearer secret');
    assert.deepEqual(JSON.parse(calls[0].init.body), {
      channel: 'sms', to: '+61400000000', content: 'Can you attend?',
      correlation: { tenant_id: 'org_1', project_id: 'p1', run_id: 'r1', task_id: 'SMS' }
    });
  });

  test('starts calls by capability without a provider field', async () => {
    let body: any;
    const fetchImpl: typeof fetch = async (_url: any, init?: any) => {
      body = JSON.parse(init.body);
      return new Response(JSON.stringify({ communication: { id: 'comm_2', status: 'accepted' } }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await client.startCall({
      channel: 'voice', to: '+61400000000', instruction: 'Confirm Thursday at 10:30.',
      correlation: { project_id: 'p1', run_id: 'r1', task_id: 'CALL' }
    });
    assert.equal(body.instruction, 'Confirm Thursday at 10:30.');
    assert.equal(body.provider, undefined);
  });

  test('delivers one durable ask identity through the communications API', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ id: 'comm_ask_1', status: 'queued', channel: 'email' }), { status: 202 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await client.deliverAsk({
      ask_id: 'ask_1', ask_token: 'token_1', channel: 'email', person_id: 'person_1',
      question: 'Approve the draft?', response_type: 'approval', reply_to: 'ask+token_1@example.com',
      correlation: { tenant_id: 'org_1', project_id: 'p1', task_id: 'REVIEW' }
    });
    assert.equal(calls[0].url, 'https://communications.example/v1/asks');
    assert.equal(calls[0].body.ask_id, 'ask_1');
    assert.equal(calls[0].body.reply_to, 'ask+token_1@example.com');
  });

  test('requires URL and key configuration', () => {
    assert.throws(() => new HttpCommunicationsClient({ baseUrl: '', apiKey: '' }), CommunicationsConfigurationError);
  });

  test('turns non-2xx responses into a typed API error', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await assert.rejects(
      client.getCommunication('comm_1'),
      (error: any) => error instanceof CommunicationsApiError && error.status === 400
    );
  });
});

describe('executeTask communications routing', () => {
  test('keeps send_sms while translating workflow correlation to the API contract', async () => {
    const originalUrl = process.env.COMMUNICATIONS_API_URL;
    const originalKey = process.env.COMMUNICATIONS_API_KEY;
    const originalFetch = globalThis.fetch;
    let request: any;
    process.env.COMMUNICATIONS_API_URL = 'https://communications.example';
    process.env.COMMUNICATIONS_API_KEY = 'secret';
    globalThis.fetch = async (_url: any, init?: any) => {
      request = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: 'comm_sms_1', status: 'queued' }), { status: 202 });
    };

    try {
      const result = await executeTask('send_sms', '{"to":"+61400000000","body":"Can you attend tomorrow?"}', {}, {
        correlation: { orgId: 'tenant_1', projectId: 'project_1', runId: 'run_8', nodeId: 'task_19' }
      });
      assert.equal(result.httpStatus, 202);
      assert.equal(result.body.pending, true);
      assert.equal(result.body.externalService, 'communications');
      assert.deepEqual(request.correlation, {
        tenant_id: 'tenant_1', project_id: 'project_1', run_id: 'run_8', task_id: 'task_19'
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl === undefined) delete process.env.COMMUNICATIONS_API_URL;
      else process.env.COMMUNICATIONS_API_URL = originalUrl;
      if (originalKey === undefined) delete process.env.COMMUNICATIONS_API_KEY;
      else process.env.COMMUNICATIONS_API_KEY = originalKey;
    }
  });
});
