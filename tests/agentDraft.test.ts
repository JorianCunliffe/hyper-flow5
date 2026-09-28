import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordAgentDraft } from '../lib/triage/agentDraft.js';
import { patchTenantTriageItem, setTenantTriageDisposition } from '../lib/serverStore.js';
import { readTriageDraftPreview } from '../lib/triage/draftPreview.js';

// Model RTDB's initial cold-cache callback and server-conflict retry.
function coldRef(initial: any) {
  let stored = initial;
  return {
    value: () => stored,
    transaction: async (update: (value: any) => any) => {
      const proposal = update(null);
      if (proposal === undefined) return { committed: false, snapshot: { val: () => stored } };
      stored = stored === null ? proposal : update(stored);
      return { committed: true, snapshot: { val: () => stored } };
    }
  };
}

test('agent draft links Outlook provider identity through a cold cache and can be previewed', async () => {
  const ref = coldRef({ id: 'email', orgId: 'tenant', disposition: 'new', audit: [{ action: 'received' }] });
  const id = await recordAgentDraft('tenant', 'email', 'outlook', {
    id: 'receipt', provider_draft_id: 'provider-draft'
  }, (org, item, patch, actor, action) => patchTenantTriageItem(org, item, patch, actor, action, ref as any));
  assert.equal(id, 'receipt');
  await setTenantTriageDisposition('tenant', 'email', 'needs_review', 'agent-router', 'Review draft', ref as any);
  assert.equal(ref.value().disposition, 'needs_review');
  assert.deepEqual(ref.value().audit.map((entry: any) => entry.action), ['received', 'draft:linked', 'disposition:needs_review']);
  const preview = await readTriageDraftPreview('tenant', 'email', {
    readItem: async () => ref.value(), requireProject: async () => {},
    client: () => ({ getMailboxDraft: async (...args: string[]) => {
      assert.deepEqual(args, ['tenant', 'outlook', 'provider-draft']);
      return { provider_draft_id: 'provider-draft', provider: { is_draft: true }, preview: { provider: 'outlook', body: 'Reply' } };
    } })
  } as any);
  assert.equal(preview.body, 'Reply');
});

test('missing enquiries are not recreated and linkage failure is surfaced', async () => {
  const ref = coldRef(null);
  const patch: typeof patchTenantTriageItem = (org, item, value, actor, action) => patchTenantTriageItem(org, item, value, actor, action, ref as any);
  await assert.rejects(recordAgentDraft('tenant', 'missing', 'outlook', { id: 'receipt', provider_draft_id: 'draft' }, patch), /linkage could not be saved/);
  assert.equal(await setTenantTriageDisposition('tenant', 'missing', 'needs_review', 'agent', undefined, ref as any), null);
  assert.equal(ref.value(), null);
});

test('an internal receipt ID cannot be mistaken for a provider draft ID', async () => {
  await assert.rejects(recordAgentDraft('tenant', 'email', 'outlook', { id: 'receipt' }, async () => { throw new Error('must not patch'); }), /provider draft id/);
});
