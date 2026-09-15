import test from 'node:test';
import assert from 'node:assert/strict';
import { HttpCommunicationsClient } from '../lib/communications/client.js';

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('updateMailboxDraft PATCHes the same provider draft with tenant and idempotency headers', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const client = new HttpCommunicationsClient({
    baseUrl: 'https://communications.example.com',
    apiKey: 'secret',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return jsonResponse(200, {
        id: 'row-1', provider_draft_id: 'draft-1', provider_message_id: 'draft-1',
        provider_thread_id: 'thread-1', status: 'created', updated_at: '2026-09-16T00:00:00.000Z'
      });
    }) as typeof fetch,
  });

  const result = await client.updateMailboxDraft('tenant-a', 'connection-a', 'draft-1', {
    to: ['alex@example.com'], subject: 'Inspection confirmed', text: 'Confirmed for 2:30pm',
  }, 'draft:update:run-1:revision-2');

  assert.equal(result.provider_draft_id, 'draft-1');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://communications.example.com/v1/mailboxes/connection-a/drafts/draft-1');
  assert.equal(calls[0].init?.method, 'PATCH');
  const headers = calls[0].init?.headers as Record<string, string>;
  assert.equal(headers['X-Tenant-Id'], 'tenant-a');
  assert.equal(headers['Idempotency-Key'], 'draft:update:run-1:revision-2');
  assert.equal(headers['X-API-Key'], 'secret');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    to: ['alex@example.com'], subject: 'Inspection confirmed', text: 'Confirmed for 2:30pm',
  });
});

test('updateMailboxDraft fails closed if Communications changes the provider draft identity', async () => {
  const client = new HttpCommunicationsClient({
    baseUrl: 'https://communications.example.com', apiKey: 'secret',
    fetchImpl: (async () => jsonResponse(200, {
      id: 'row-1', provider_draft_id: 'replacement-draft', status: 'created'
    })) as typeof fetch,
  });
  await assert.rejects(
    () => client.updateMailboxDraft('tenant-a', 'connection-a', 'draft-1', {
      to: ['alex@example.com'], subject: 'Confirmed', text: '2:30pm'
    }, 'draft:update:1'),
    /changed or omitted the provider draft identity/
  );
});