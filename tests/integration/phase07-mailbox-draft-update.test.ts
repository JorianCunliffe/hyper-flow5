import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HttpCommunicationsClient } from '../../lib/communications/client.js';

const checkout = process.env.PHASE02_COMMUNICATIONS_CHECKOUT;

function commFile(path: string): string {
  if (!checkout) throw new Error('PHASE02_COMMUNICATIONS_CHECKOUT is required for cross-service acceptance');
  return readFileSync(join(checkout, path), 'utf8');
}

test('pinned Communications checkout exposes durable in-place mailbox draft revision', () => {
  const v1 = commFile('v1.js');
  const service = commFile('mailboxDraftUpdate.js');
  const migration = commFile('migrations/026_mailbox_draft_updates.sql');
  const outlook = commFile('outlookMailbox.js');
  const gmail = commFile('gmailMailbox.js');

  assert.match(v1, /fastify\.patch\('\/mailboxes\/:connectionId\/drafts\/:draftId'/);
  assert.match(service, /type:\s*'mailbox_draft_update'/);
  assert.match(service, /providerDraft\?\.id\s*!==\s*draftId/);
  assert.match(service, /Provider changed the draft identity during update/);
  assert.match(migration, /mailbox_draft_update/);
  assert.match(outlook, /updateOutlookDraft/);
  assert.match(outlook, /isDraft\s*!==\s*true/);
  assert.match(outlook, /method:\s*'PATCH'/);
  assert.doesNotMatch(outlook.slice(outlook.indexOf('export async function updateOutlookDraft')), /\/send/);
  assert.match(gmail, /updateGmailDraft/);
  assert.match(gmail, /method:\s*'PUT'/);
  assert.match(gmail, /updated\.id\s*!==\s*draftId/);
});

test('HyperFlow client contract matches the pinned Communications draft PATCH route', async () => {
  let seen: { url: string; method?: string; tenant?: string; key?: string } | null = null;
  const client = new HttpCommunicationsClient({
    baseUrl: 'http://communications.test', apiKey: 'test-key',
    fetchImpl: (async (url: string | URL | Request, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string>;
      seen = { url: String(url), method: init?.method, tenant: headers['X-Tenant-Id'], key: headers['Idempotency-Key'] };
      return new Response(JSON.stringify({
        id: 'row-1', provider_draft_id: 'provider-draft-1', provider_message_id: 'provider-draft-1',
        provider_thread_id: 'thread-1', status: 'created'
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch,
  });

  const result = await client.updateMailboxDraft('tenant-a', 'mailbox-a', 'provider-draft-1', {
    to: ['person@example.com'], subject: 'Confirmed', text: 'Inspection confirmed for 2:30pm'
  }, 'hyperflow:run-1:draft-1:revision-2');

  assert.equal(result.provider_draft_id, 'provider-draft-1');
  assert.deepEqual(seen, {
    url: 'http://communications.test/v1/mailboxes/mailbox-a/drafts/provider-draft-1',
    method: 'PATCH', tenant: 'tenant-a', key: 'hyperflow:run-1:draft-1:revision-2'
  });
});