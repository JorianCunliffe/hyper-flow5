import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, set, update, get } from 'firebase/database';

test('resumed intake retains earlier enquiries and delivers only the complete digest', async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, '127.0.0.1:9010');
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({ project_id: 'demo-hyperflow', client_email: 'fixture@demo-hyperflow.iam.gserviceaccount.com', private_key: privateKey });
  process.env.FIREBASE_DATABASE_URL = 'https://demo-hyperflow.firebaseio.com';
  const env = await initializeTestEnvironment({ projectId: 'demo-hyperflow', database: { host: '127.0.0.1', port: 9010, rules: readFileSync('database.rules.json', 'utf8') } });
  const { getApps, deleteApp } = await import('firebase-admin/app');
  const { runEmailTriage } = await import('../../lib/triage/runEmailTriage.js');
  const messages = Array.from({ length: 7 }, (_, i) => ({ id: `mail-${i}`, channel: 'email', direction: 'inbound',
    occurredAt: new Date(10000 + i * 1000).toISOString(), subject: `Enquiry ${i}`, content: `Question ${i}`, sender: 'fixture@example.com' }));
  const drafts: any[] = [];
  const reads: string[] = [];
  const client = {
    syncMailbox: async () => ({}),
    listCommunications: async () => ({ data: [...messages].reverse() }),
    getCommunication: async (_tenant: string, id: string) => { reads.push(id); return messages.find(m => m.id === id); },
    createMailboxDraft: async (_tenant: string, _connection: string, body: any) => { drafts.push(body); return { id: 'receipt', provider_draft_id: 'native-draft' }; }
  } as any;
  const input = { orgId: 'batch_fixture', projectId: 'morning', connectionId: 'outlook', runId: 'occurrence',
    scheduledFor: 1000, createdAt: 1000, batchSize: 5, digestChannel: 'email' as const, digestRecipient: 'fixture@example.com', createDrafts: false };
  try {
    await env.clearDatabase();
    await env.withSecurityRulesDisabled(c => set(ref(c.database(), 'projects/batch_fixture/settings/communications'), { allowedAutomaticActions: ['create_draft'] }));
    const first = await runEmailTriage(input, client);
    assert.equal(first.hasMore, true);
    assert.equal(first.items.length, 5);
    assert.equal(drafts.length, 0, 'partial digest must not be delivered');
    // Unrelated mailbox activity must not evict this occurrence's planner input.
    await env.withSecurityRulesDisabled(c => update(ref(c.database(), 'triage_items/batch_fixture'), Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`noise-${i}`, { id: `noise-${i}`, communicationId: `noise-${i}`, projectId: 'other', connectionId: 'gmail', updatedAt: Date.now() + 60000 }])
    )));
    await Promise.all(getApps().map(deleteApp));
    const resumed = await runEmailTriage(input, client);
    assert.equal(resumed.hasMore, false);
    assert.equal(resumed.items.length, 7);
    assert.equal(resumed.digest.counts.total, 7);
    assert.equal(drafts.length, 1);
    assert.match(drafts[0].text, /^7 new messages/);
    assert.equal(new Set(reads).size, 7);
    assert.equal(reads.length, 7, 'completed enquiries are not fetched and processed again');
    const rolling = await runEmailTriage({ ...input, runId: 'rolling-day', scheduledFor: 86420000, lookbackHours: 24, digestChannel: 'web' }, client);
    assert.equal(rolling.hasMore, false);
    assert.equal(rolling.items.length, 0, 'messages outside the last day stay excluded');
    const replay = await runEmailTriage({ ...input, runId: 'rolling-replay', scheduledFor: 86409000, lookbackHours: 24, digestChannel: 'web' }, client);
    assert.equal(replay.hasMore, false);
    assert.equal(replay.items.length, 7, 'rolling window includes records evicted from the recent-items list');
    assert.equal(reads.length, 7, 'overlapping windows never classify completed mail again');
    assert.equal(drafts.length, 1, 'rolling web-only intake never sends another digest or creates a draft');
    const { triageItemFromCommunication } = await import('../../lib/triage/emailTriage.js');
    const legacyId = triageItemFromCommunication(input.orgId, messages[0] as any).id;
    await env.withSecurityRulesDisabled(c => update(ref(c.database(), `triage_items/batch_fixture/${legacyId}`), {
      sourceMessage: { content: 'old preview' }, providerDraftId: 'existing-native-draft', disposition: 'resolved',
      audit: [{ action: 'triage.classification_failed', at: 1 }, { action: 'project_reconciliation', detail: 'earlier', at: 2 }]
    }));
    const refreshed = await runEmailTriage({ ...input, runId: 'full-body-refresh', scheduledFor: 86409000,
      lookbackHours: 24, digestChannel: 'web', createDrafts: true }, client);
    const repairedEmail = refreshed.items.find(item => item.communicationId === 'mail-0')!;
    assert.equal(reads.length, 8, 'legacy failed message is fetched again; other complete messages are reused');
    assert.equal(repairedEmail.sourceMessage?.content, 'Question 0');
    assert.equal(repairedEmail.sourceMessage?.contentVersion, 2);
    assert.equal(repairedEmail.providerDraftId, 'existing-native-draft');
    assert.equal(repairedEmail.disposition, 'resolved', 'source refresh preserves the human decision');
    assert.equal(drafts.length, 1, 'refresh does not duplicate the existing native draft');
    const checkpoint = 'triage_occurrence_items/batch_fixture/occurrence';
    for (const context of [env.unauthenticatedContext(), env.authenticatedContext('member')]) {
      await assertFails(get(ref(context.database(), checkpoint)));
      await assertFails(set(ref(context.database(), `${checkpoint}/forged`), { id: 'forged' }));
    }
    const runtime = env.authenticatedContext('hyperflow-runtime-v1', { hyperflow_runtime: true }).database();
    await assertSucceeds(get(ref(runtime, checkpoint)));
    // Reproduce the deployed browser bug: partial batches used different IDs.
    await env.clearDatabase();
    drafts.length = 0;
    reads.length = 0;
    await env.withSecurityRulesDisabled(c => set(ref(c.database(), 'projects/batch_fixture/settings/communications'), { allowedAutomaticActions: ['create_draft'] }));
    await runEmailTriage({ ...input, runId: 'manual-first', batchSize: 2 }, client);
    await runEmailTriage({ ...input, runId: 'manual-second', batchSize: 2 }, client);
    const { TRIAGE_BATCH_CHECKPOINT } = await import('../../lib/actionRecovery.js');
    const { NodeType } = await import('../../types.js');
    await env.withSecurityRulesDisabled(c => set(ref(c.database(), 'projects/batch_fixture/projects'), [{
      id: 'morning', projectData: {}, milestones: [{ id: 'triage', nodeType: NodeType.EMAIL_TRIAGE,
        actionConfig: { template: '{}', runHistory: [{ id: 'manual-first', at: 1, status: 'error', error: TRIAGE_BATCH_CHECKPOINT }],
          lastRun: { id: 'manual-second', at: 2, status: 'error', error: TRIAGE_BATCH_CHECKPOINT } } }]
    }]));
    await Promise.all(getApps().map(deleteApp));
    const repaired = await runEmailTriage({ ...input, runId: 'manual-second', nodeId: 'triage' }, client);
    assert.equal(repaired.hasMore, false);
    assert.equal(repaired.items.length, 7, 'earlier manual batches are recovered into the retained run');
    assert.equal(drafts.length, 1);
    assert.match(drafts[0].text, /^7 new messages/);
    assert.equal(reads.length, 7, 'repair does not classify completed batches twice');
    await env.withSecurityRulesDisabled(c => set(ref(c.database(), 'tenant_lifecycle/batch_fixture/state'), 'suspended'));
    await assertFails(get(ref(runtime, checkpoint)));
  } finally {
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
