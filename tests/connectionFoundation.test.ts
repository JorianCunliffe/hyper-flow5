import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeMailboxConnectionRef,
  normalizeTenantAgentProfile,
  normalizeWorkspaceConnectionRef
} from '../lib/serverStore';

describe('tenant agent profile normalization', () => {
  test('keeps only valid service identities, policies, and actions', () => {
    const profile = normalizeTenantAgentProfile({
      agentId: 'agent_1', displayName: ' Coach ', timezone: 'Australia/Brisbane',
      serviceIdentities: { phone: '+61411111111', sms: 'not-a-number', email: 'Coach@Example.com' },
      automaticActions: ['draft', 'call', 'invalid' as any],
      allowedProjectIds: ['project_1', 'project_1', 'project_2'],
      personProjectAccess: [
        { personId: 'person_1', projectIds: ['project_1', 'project_1'] },
        { personId: 'person_1', projectIds: ['project_2'] }
      ],
      clarificationPolicy: 'when_ambiguous'
    });
    assert.deepEqual(profile.serviceIdentities, { phone: '+61411111111', email: 'coach@example.com' });
    assert.deepEqual(profile.automaticActions, ['draft', 'call']);
    assert.deepEqual(profile.allowedProjectIds, ['project_1', 'project_2']);
    assert.deepEqual(profile.personProjectAccess, [{ personId: 'person_1', projectIds: ['project_2'] }]);
    assert.equal(profile.displayName, 'Coach');
  });

  test('preserves the stable agent id on partial updates', () => {
    const existing = normalizeTenantAgentProfile({ agentId: 'agent_stable', displayName: 'Coach', timezone: 'Australia/Brisbane' });
    const updated = normalizeTenantAgentProfile({ displayName: 'Daily Coach' }, existing);
    assert.equal(updated.agentId, 'agent_stable');
    assert.equal(updated.timezone, 'Australia/Brisbane');
  });
});

describe('opaque integration connection references', () => {
  test('normalizes a mailbox reference and never copies credentials', () => {
    const connection = normalizeMailboxConnectionRef({
      id: 'mailbox_1', provider: 'gmail', mailboxAddress: 'User@Example.com',
      state: 'connected', scopes: ['gmail.readonly', 'gmail.compose'],
      credential: 'must-not-survive'
    } as any);
    assert.equal(connection.mailboxAddress, 'user@example.com');
    assert.equal((connection as any).credential, undefined);
  });

  test('normalizes a Google Workspace reference and never copies tokens', () => {
    const connection = normalizeWorkspaceConnectionRef({
      id: 'workspace_1', provider: 'google', accountEmail: 'User@Example.com',
      state: 'connected', scopes: ['documents.readonly', 'spreadsheets'],
      refreshToken: 'must-not-survive'
    } as any);
    assert.equal(connection.accountEmail, 'user@example.com');
    assert.equal((connection as any).refreshToken, undefined);
  });

  test('rejects malformed tenant connection identities', () => {
    assert.throws(() => normalizeMailboxConnectionRef({ id: 'x', provider: 'gmail', mailboxAddress: 'bad' }), /valid mailbox/);
    assert.throws(() => normalizeWorkspaceConnectionRef({ id: '', provider: 'google', accountEmail: 'user@example.com' }), /id is required/);
  });
});
