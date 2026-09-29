import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTriageDraftPreview, safeDraftWebUrl, adoptTriageDraftBaseline } from '../lib/triage/draftPreview';
import { CommunicationsApiError } from '../lib/communications/errors';

const fixture = () => {
  const item = { id: 'email', orgId: 'tenant', projectId: 'project', connectionId: 'mailbox', providerDraftId: 'draft' };
  const calls: unknown[] = [];
  const result = { provider_draft_id: 'draft', provider: { is_draft: true }, request_hash: 'not-for-ui', preview: {
    provider: 'outlook', subject: 'Reply', to: ['sender@example.com'], body: 'Latest edited draft\nSecond line', body_type: 'text', web_url: 'https://outlook.office365.com/owa/?ItemID=draft',
  } };
  const deps = {
    readItem: async (org: string, id: string) => { calls.push(['item', org, id]); return item; },
    requireProject: async (org: string, id: unknown) => { calls.push(['project', org, id]); },
    client: () => ({ getMailboxDraft: async (...args: unknown[]) => { calls.push(['provider', ...args]); return result; } })
  };
  return { item, result, calls, deps: deps as any };
};
test('existing tenant item resolves a live draft using stored mailbox identity only', async () => {
  const f = fixture();
  const draft = await readTriageDraftPreview('tenant', 'email', f.deps);
  assert.equal(draft.body, 'Latest edited draft\nSecond line');
  assert.equal(draft.webUrl, f.result.preview.web_url);
  assert.equal('request_hash' in draft, false);
  assert.deepEqual(f.calls, [['item', 'tenant', 'email'], ['project', 'tenant', 'project'], ['provider', 'tenant', 'mailbox', 'draft']]);
});
test('foreign tenant and missing draft cannot make provider calls', async () => {
  const f = fixture(); f.item.orgId = 'other';
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /not found/);
  f.item.orgId = 'tenant'; f.item.providerDraftId = '';
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /No mailbox draft/);
  assert.equal(f.calls.some((call: any) => call[0] === 'provider'), false);
});
test('sent, deleted, mismatched and legacy responses are never presented as current drafts', async () => {
  const f = fixture(); f.result.provider.is_draft = false;
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /did not confirm/);
  f.result.provider.is_draft = true; f.result.provider_draft_id = 'other';
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /did not confirm/);
  f.result.provider_draft_id = 'draft'; delete (f.result as any).preview;
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /unavailable/);
  f.deps.client = () => ({ getMailboxDraft: async () => { throw { status: 404 }; } });
  await assert.rejects(readTriageDraftPreview('tenant', 'email', f.deps), /no longer available/);
});
test('only HTTPS Outlook provider links are exposed', () => {
  for (const url of ['javascript:alert(1)', 'https://outlook.office.com.evil.test/mail', 'http://outlook.office.com/mail', 'https://secret@outlook.office.com/mail', 'https://evil.test/', 'https://outlook.office.com:8443/mail']) assert.equal(safeDraftWebUrl(url, 'outlook'), undefined);
  assert.equal(safeDraftWebUrl('https://outlook.cloud.microsoft/mail/?id=1', 'outlook'), 'https://outlook.cloud.microsoft/mail/?id=1');
});

test('legacy draft preview exposes its review hash and approval addresses only the linked draft', async () => {
  const f = fixture();
  const hash = 'a'.repeat(64);
  Object.assign(f.result, { revision: 1, provider_change_key: null });
  (f.result.preview as any).content_hash = hash;
  const draft = await readTriageDraftPreview('tenant', 'email', f.deps);
  assert.equal(draft.baselineRequired, true); assert.equal(draft.contentHash, hash); assert.equal(draft.revision, 1);
  (f.result as any).provider_change_key = 'saved';
  assert.equal((await readTriageDraftPreview('tenant', 'email', f.deps)).baselineRequired, false);

  const adoptions: unknown[][] = [];
  let failure: unknown;
  f.deps.client = () => ({ adoptMailboxDraftBaseline: async (...args: unknown[]) => {
    adoptions.push(args); if (failure) throw failure; return { provider_draft_id: 'draft', baseline_adopted: true, revision: 1 };
  } });
  await assert.rejects(adoptTriageDraftBaseline('tenant', 'email', { contentHash: 'short', revision: 1 }, 'owner:u', f.deps), /Review the current draft/);
  await assert.rejects(adoptTriageDraftBaseline('tenant', 'email', { contentHash: hash, revision: '1' }, 'owner:u', f.deps), /Review the current draft/);
  assert.equal(adoptions.length, 0);
  assert.deepEqual(await adoptTriageDraftBaseline('tenant', 'email', { contentHash: hash, revision: 1 }, 'owner:u', f.deps), { adopted: true, revision: 1 });
  assert.deepEqual(adoptions[0], ['tenant', 'mailbox', 'draft', { reviewed_content_hash: hash, expected_revision: 1, initiator_id: 'owner:u' }]);
  failure = new CommunicationsApiError('Communications API returned 409', 409, { code: 'DRAFT_PROVIDER_CHANGED' });
  await assert.rejects(adoptTriageDraftBaseline('tenant', 'email', { contentHash: hash, revision: 1 }, 'owner:u', f.deps), (error: any) => error.status === 409 && /changed in the mailbox/.test(error.message));
  f.item.providerDraftId = '';
  await assert.rejects(adoptTriageDraftBaseline('tenant', 'email', { contentHash: hash, revision: 1 }, 'owner:u', f.deps), /No mailbox draft/);
  assert.equal(adoptions.length, 2);
});
