import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAskRecipient } from '../lib/asks/resolveAskRecipient.js';
import { reconciliationCursor, communicationsAfterCursor } from '../lib/triage/runEmailTriage.js';

const personId = '39edc52f-7af6-43c1-a2db-53ad43bd9ddf';
test('stable Ask identity uses Communications with the original tenant, project and channel', async () => {
  for (const channel of ['voice', 'sms', 'email'] as const) {
    const profile: any = { personProjectAccess: [{ personId, projectIds: ['project'] }] };
    const recipient = await resolveAskRecipient('tenant', 'project', personId, channel, {
      readTenantAgentProfile: async () => profile,
      resolveTeamMemberIdentity: async () => { throw new Error('legacy lookup must not run'); },
      resolveGrantedPersonTarget: async input => {
        assert.deepEqual(input, { orgId: 'tenant', projectId: 'project', personId, channel, profile });
        return '+61400000000';
      }
    });
    assert.equal(recipient, '+61400000000');
  }
});

test('missing or denied stable contacts cannot fall back to legacy identities', async () => {
  await assert.rejects(resolveAskRecipient('tenant', 'other', personId, 'voice', {
    readTenantAgentProfile: async () => null,
    resolveGrantedPersonTarget: async () => { throw new Error('not granted'); },
    resolveTeamMemberIdentity: async () => '+61400000000'
  }), /not granted/);
});

test('existing name-based team members remain supported', async () => {
  assert.equal(await resolveAskRecipient('tenant', 'project', 'Jorian', 'voice', {
    readTenantAgentProfile: async () => null,
    resolveGrantedPersonTarget: async () => { throw new Error('unexpected stable lookup'); },
    resolveTeamMemberIdentity: async (org, name, channel) => {
      assert.deepEqual([org, name, channel], ['tenant', 'Jorian', 'voice']);
      return '+61400000000';
    }
  }), '+61400000000');
});

test('24 hour window recovers earlier mail even after an empty intake committed a newer cursor', () => {
  const end = Date.parse('2026-09-30T00:00:00Z');
  const cutoff = reconciliationCursor('2026-09-29T23:00:00Z', end, 24, end);
  assert.equal(cutoff, '2026-09-29T00:00:00.000Z');
  const messages = [
    { id: 'old', occurredAt: '2026-09-28T23:59:59Z' },
    { id: 'test', occurredAt: '2026-09-29T12:11:17Z' },
    { id: 'new', occurredAt: '2026-09-29T23:30:00Z' }
  ];
  assert.deepEqual(communicationsAfterCursor(messages, cutoff).map(item => item.id), ['test', 'new']);
  assert.equal(reconciliationCursor('2026-09-29T23:00:00Z', end), '2026-09-29T23:00:00Z');
  for (const invalid of [0, -1, NaN, 169]) assert.throws(() => reconciliationCursor(undefined, end, invalid, end), /lookback_hours/);
});
