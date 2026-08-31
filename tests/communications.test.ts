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
      calls.push({ url: String(url), body: JSON.parse(init.body), headers: init.headers });
      return new Response(JSON.stringify({ ask_id: 'ask_1', status: 'resolved', communication_id: 'comm_answer', duplicate: true }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.resolveAsk('org_1', 'ask_1', 'comm_answer');
    assert.equal(calls[0].url, 'https://communications.example/v1/asks/ask_1/resolve');
    assert.equal(calls[0].headers['X-Tenant-Id'], 'org_1');
    assert.deepEqual(calls[0].body, { communication_id: 'comm_answer' });
    assert.equal(result.status, 'resolved');
  });

  test('requires URL and key configuration', () => {
    assert.throws(() => new HttpCommunicationsClient({ baseUrl: '', apiKey: '' }), CommunicationsConfigurationError);
  });

  test('turns non-2xx responses into a typed API error', async () => {
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify({ error: 'bad request' }), { status: 400 });
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await assert.rejects(client.getCommunication('org_1', 'comm_1'), (error: any) => error instanceof CommunicationsApiError && error.status === 400);
  });

  test('sends email with tenant isolation and a deterministic operation key', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ communication_id: 'email_1', channel: 'email', thread_id: 'thread_1' }), { status: 201 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.sendEmail({
      to: ['person@example.com'], service_identity_id: 'identity_1', subject: 'Question', text: 'Can you attend?',
      correlation: { tenant_id: 'org_1', external_project_id: 'p1', run_id: 'r1', task_id: 'EMAIL' },
      purpose: { type: 'human_ask', ask_id: 'ask_1' }
    });
    assert.equal(result.id, 'email_1');
    assert.equal(result.threadId, 'thread_1');
    assert.equal(calls[0].url, 'https://communications.example/v1/emails');
    assert.equal(calls[0].init.headers['X-Tenant-Id'], 'org_1');
    assert.equal(calls[0].init.headers['Idempotency-Key'], 'hyperflow:org_1:p1:r1:EMAIL:email:ask_1');
  });

  test('lists only inbound communications and preserves service pagination', async () => {
    let captured: any;
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      captured = { url: String(url), init };
      return new Response(JSON.stringify({
        data: [
          { communication_id: 'in_1', channel: 'email', direction: 'inbound', occurred_at: '2026-08-28T01:00:00Z' },
          { communication_id: 'out_1', channel: 'email', direction: 'outbound', occurred_at: '2026-08-28T02:00:00Z' }
        ], count: 2, limit: 20, next_cursor: 'cursor_2'
      }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.listCommunications('org_1', { channel: 'email', direction: 'inbound', limit: 20 });
    assert.deepEqual(result.data.map(item => item.id), ['in_1']);
    assert.equal(result.nextCursor, 'cursor_2');
    assert.equal(captured.init.headers['X-Tenant-Id'], 'org_1');
    assert.match(captured.url, /channel=email/);
  });

  test('loads and normalizes a tenant-scoped communication thread', async () => {
    const fetchImpl: typeof fetch = async (_url: any, init?: any) => {
      assert.equal(init.headers['X-Tenant-Id'], 'org_1');
      return new Response(JSON.stringify({ thread_id: 'thread_1', communications: [{ communication_id: 'comm_1', direction: 'inbound' }] }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.getThread('org_1', 'thread_1');
    assert.equal(result.threadId, 'thread_1');
    assert.equal(result.communications[0].id, 'comm_1');
  });

  test('uses the current Communications inbox and disposition routes', async () => {
    const calls: any[] = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), init });
      if (String(url).includes('/disposition')) {
        return new Response(JSON.stringify({ communication_id: 'comm_1', thread_id: 'thread_1', outcome: { disposition: 'human', memory_eligible: true } }), { status: 200 });
      }
      return new Response(JSON.stringify({ data: [{ communication_id: 'comm_1', thread_id: 'thread_1', direction: 'inbound', outcome: { disposition: 'candidate_human_response' } }] }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const inbox = await client.listTriageItems('org_1', { channel: 'email', limit: 25 });
    assert.equal(calls[0].url, 'https://communications.example/v1/inbox?limit=25&channel=email');
    assert.equal(inbox[0].disposition, 'candidate_human_response');
    const updated = await client.setTriageDisposition('org_1', 'comm_1', 'human');
    assert.equal(calls[1].url, 'https://communications.example/v1/communications/comm_1/disposition');
    assert.deepEqual(JSON.parse(calls[1].init.body), { disposition: 'human' });
    assert.equal(updated.disposition, 'human');
  });

  test('hydrates safe email metadata from the email detail endpoint', async () => {
    const urls: string[] = [];
    const fetchImpl: typeof fetch = async (url: any) => {
      urls.push(String(url));
      return urls.length === 1
        ? new Response(JSON.stringify({ communication_id: 'email_1', channel: 'email', content: 'Hello' }), { status: 200 })
        : new Response(JSON.stringify({
            communication_id: 'email_1', channel: 'email', content: 'Hello',
            email: { subject: 'Meeting', from_addresses: ['sender@example.com'], to_addresses: ['team@example.com'] }
          }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    const result = await client.getCommunication('org_1', 'email_1');
    assert.deepEqual(urls, [
      'https://communications.example/v1/communications/email_1',
      'https://communications.example/v1/emails/email_1'
    ]);
    assert.equal(result.subject, 'Meeting');
    assert.equal(result.sender, 'sender@example.com');
    assert.deepEqual(result.recipients, ['team@example.com']);
  });

  test('starts provider-neutral mailbox OAuth while preserving the Gmail alias', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const fetchImpl: typeof fetch = async (url: any, init?: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ authorization_url: 'https://login.example/authorize' }), { status: 200 });
    };
    const client = new HttpCommunicationsClient({ baseUrl: 'https://communications.example', apiKey: 'secret', fetchImpl });
    await client.startMailboxOAuth('org_1', 'user_1', 'https://hyperflow.example/settings', 'outlook', 'setup_1');
    await client.startGmailOAuth('org_1', 'user_1', 'https://hyperflow.example/settings');
    assert.equal(calls[0].url, 'https://communications.example/v1/mailboxes/oauth/microsoft/start');
    assert.deepEqual(calls[0].body, { initiator_id: 'user_1', return_url: 'https://hyperflow.example/settings', setup_draft_id: 'setup_1' });
    assert.equal(calls[1].url, 'https://communications.example/v1/mailboxes/oauth/google/start');
  });
});

describe('executeTask communications routing', () => {
  test('routes email through Communications with tenant identity, reply routing, and correlation', async () => {
    const original = { url: process.env.COMMUNICATIONS_API_URL, key: process.env.COMMUNICATIONS_API_KEY, publicUrl: process.env.PUBLIC_BASE_URL, fetch: globalThis.fetch };
    let request: any;
    let headers: any;
    process.env.COMMUNICATIONS_API_URL = 'https://communications.example';
    process.env.COMMUNICATIONS_API_KEY = 'secret';
    process.env.PUBLIC_BASE_URL = 'https://hyperflow.example';
    globalThis.fetch = async (_url: any, init?: any) => {
      request = JSON.parse(init.body);
      headers = init.headers;
      return new Response(JSON.stringify({ communication_id: 'comm_email_1', channel: 'email', thread_id: 'thread_1' }), { status: 201 });
    };
    try {
      const result = await executeTask('send_email', '{"to":"person@example.com","subject":"Meeting","body":"Can you attend?"}', {}, {
        communicationsEmailIdentity: 'identity_1', communicationsConnectionId: 'connection_1', communicationsReplyIdentity: 'reply@example.com',
        correlation: { orgId: 'tenant_1', projectId: 'project_1', runId: 'run_1', nodeId: 'EMAIL_1' }
      });
      assert.equal(result.httpStatus, 200);
      assert.equal(request.service_identity_id, 'identity_1');
      assert.equal(request.provider_connection_id, 'connection_1');
      assert.deepEqual(request.reply_to, ['reply@example.com']);
      assert.equal(headers['X-Tenant-Id'], 'tenant_1');
      assert.equal(headers['Idempotency-Key'], 'hyperflow:tenant_1:project_1:run_1:EMAIL_1:email:action');
      assert.equal(result.body.output.thread_id, 'thread_1');
    } finally {
      globalThis.fetch = original.fetch;
      for (const [key, value] of [['COMMUNICATIONS_API_URL', original.url], ['COMMUNICATIONS_API_KEY', original.key], ['PUBLIC_BASE_URL', original.publicUrl]] as const) {
        if (value === undefined) delete process.env[key]; else process.env[key] = value;
      }
    }
  });

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
  test('sends an email Ask through Communications with its secure fallback link', async () => {
    let request: any;
    const client: any = {
      sendEmail: async (value: any) => { request = value; return { id: 'comm_email_ask', status: 'accepted' }; }
    };
    const result = await deliverAsk({
      ask: {
        id: 'ask_email', token: 'token_email', kind: 'question', status: 'open', prompt: 'Can you attend?',
        nodeId: 'EMAIL_REVIEW', projectId: 'project_1', runId: 'run_1', personId: 'Jorian',
        assignees: ['Jorian'], channels: ['email'], createdAt: 1, responses: []
      },
      orgId: 'org_1', projectId: 'project_1', personId: 'Jorian', recipient: 'jorian@example.com',
      emailIdentity: 'identity_1', replyIdentity: 'reply@example.com', connectionId: 'connection_1', channel: 'email',
      publicBaseUrl: 'https://hyperflow.example', client
    });
    assert.equal(result.id, 'comm_email_ask');
    assert.equal(request.service_identity_id, 'identity_1');
    assert.deepEqual(request.reply_to, ['reply@example.com']);
    assert.match(request.text, /forms\/ask\/token_email/);
    assert.deepEqual(request.purpose, { type: 'human_ask', ask_id: 'ask_email', token: 'token_email' });
  });

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
