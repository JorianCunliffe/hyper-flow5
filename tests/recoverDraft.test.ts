import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverTriageDraft } from '../lib/triage/recoverDraft.js';
import { recoverTriageDraftLink } from '../lib/serverStore.js';
import { readTriageDraftPreview } from '../lib/triage/draftPreview.js';

function fixture(connection = 'outlook', draftId = 'draft') {
  const item: any = { id: 'item', orgId: 'tenant', communicationId: 'email', channel: 'email' };
  const job: any = { orgId: 'tenant', communicationId: 'email', responseDraftId: 'receipt' };
  const draft: any = { id: 'receipt', tenant_id: 'tenant', communication_id: 'email', status: 'created', provider_connection_id: connection, provider_draft_id: draftId, provider: { id: draftId, message_id: 'separate-message', is_draft: true } };
  let saves = 0;
  const deps: any = {
    readItem: async () => item, readJob: async () => job, requireProject: async () => {},
    client: () => ({
      getMailboxDraftByReceipt: async (org: string, id: string) => { assert.deepEqual([org, id], ['tenant', 'receipt']); return draft; },
      getCommunication: async () => ({ id: 'email', connectionId: connection })
    }),
    save: async (...args: unknown[]) => { saves++; assert.deepEqual(args, ['tenant', 'item', 'email', connection, draftId, 'actor']); return { ...item, connectionId: connection, providerDraftId: draftId }; }
  };
  return { item, job, draft, deps, saves: () => saves };
}

test('recovers an existing draft by exact receipt, with no creation or replay capability', async () => {
  const f = fixture();
  assert.equal((await recoverTriageDraft('tenant', 'item', 'actor', f.deps)).providerDraftId, 'draft');
  assert.equal(f.saves(), 1);
});

test('Gmail recovery and preview use the draft ID rather than its separate message ID', async () => {
  const f = fixture('gmail', 'r-123');
  const item = await recoverTriageDraft('tenant', 'item', 'actor', f.deps);
  const preview = await readTriageDraftPreview('tenant', 'item', {
    readItem: async () => item, requireProject: async () => {},
    client: () => ({ getMailboxDraft: async (...args: string[]) => {
      assert.deepEqual(args, ['tenant', 'gmail', 'r-123']);
      return { ...f.draft, preview: { provider: 'gmail', body: 'Edited in Gmail', to: ['person@example.com'] } };
    } })
  } as any);
  assert.equal(preview.provider, 'gmail');
  assert.equal(preview.body, 'Edited in Gmail');
  assert.equal(f.saves(), 1);
});

test('rejects foreign, mismatched, failed and no-longer-draft receipts without writes', async () => {
  for (const mutation of [
    { tenant_id: 'other' }, { id: 'other' }, { communication_id: 'other' },
    { provider_connection_id: 'gmail' }, { status: 'failed' }, { provider_draft_id: '' },
    { provider: { id: 'draft', is_draft: false } }, { provider: { id: 'other', is_draft: true } }
  ]) {
    const f = fixture(); Object.assign(f.draft, mutation);
    await assert.rejects(recoverTriageDraft('tenant', 'item', 'actor', f.deps), /do not agree/);
    assert.equal(f.saves(), 0);
  }
});

test('requires a tenant-owned saved job and fails closed on unavailable provider', async () => {
  const f = fixture(); f.job.orgId = 'other';
  await assert.rejects(recoverTriageDraft('tenant', 'item', 'actor', f.deps), /No saved/);
  f.job.orgId = 'tenant'; f.deps.client = () => ({ getMailboxDraftByReceipt: async () => { throw new Error('Provider unavailable'); } });
  await assert.rejects(recoverTriageDraft('tenant', 'item', 'actor', f.deps), /Provider unavailable/);
  assert.equal(f.saves(), 0);
});

test('atomic recovery preserves review state, is repeatable and refuses conflicting linkage', async () => {
  let record: any = { id: 'item', orgId: 'tenant', communicationId: 'email', disposition: 'needs_review', audit: [] };
  const ref: any = { transaction: async (update: any) => {
    assert.equal(update(null), null);
    const result = update(record);
    if (result === undefined) return { committed: false };
    record = result; return { committed: true, snapshot: { val: () => record } };
  } };
  const save = () => recoverTriageDraftLink('tenant', 'item', 'email', 'outlook', 'draft', 'actor', ref);
  await save(); await save();
  assert.equal(record.audit.length, 1); assert.equal(record.disposition, 'needs_review');
  record.providerDraftId = 'newer-draft';
  assert.equal(await save(), null); assert.equal(record.providerDraftId, 'newer-draft');
});
