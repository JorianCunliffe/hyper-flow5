import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { assertCapabilityAllowed, capabilityMode } from '../lib/capabilityPolicy';
import { normalizeCapabilityPolicy } from '../lib/capabilityPolicyStore';
import { normalizeWorkspaceNamedResources } from '../lib/workspaceResourceCatalog';
import { resolveGoogleDocGrant, resolveGoogleSheetGrant } from '../lib/integrations/googleWorkspace';
import type { TenantAgentProfile, WorkspaceResourceGrant } from '../types';

const profile = (automaticActions: TenantAgentProfile['automaticActions'] = []): TenantAgentProfile => ({
  agentId: 'a', displayName: 'A', timezone: 'Australia/Brisbane', automaticActions
});

describe('capability policy', () => {
  test('explicit capability authority overrides legacy automaticActions', () => {
    const p = { ...profile(['call']), capabilityPolicy: { 'phone.call': 'denied' as const } };
    assert.equal(capabilityMode(p, 'phone.call'), 'denied');
    assert.throws(() => assertCapabilityAllowed({ profile: p, capability: 'phone.call', autonomous: true }), /disabled/);
  });

  test('legacy automatic action remains a migration fallback', () => {
    assert.equal(capabilityMode(profile(['call']), 'phone.call'), 'automatic');
    assert.equal(capabilityMode(profile([]), 'phone.call'), 'approval');
  });

  test('normalizer rejects malformed names and modes', () => {
    assert.deepEqual(normalizeCapabilityPolicy({ 'phone.call': 'automatic' }), { 'phone.call': 'automatic' });
    assert.throws(() => normalizeCapabilityPolicy({ 'Phone Call': 'automatic' }), /Invalid capability/);
    assert.throws(() => normalizeCapabilityPolicy({ 'phone.call': 'anything' }), /Invalid policy mode/);
  });
});

describe('named Workspace resources', () => {
  const resources = normalizeWorkspaceNamedResources([
    { name: 'source', type: 'google_doc', documentId: 'abcdefghij12345', permissions: ['read'] },
    { name: 'tasks', type: 'google_sheet_range', spreadsheetId: 'sheetid123456789', range: 'Tasks!A2:G', permissions: ['read', 'append', 'upsert'] },
    { name: 'read_only', type: 'google_sheet_range', spreadsheetId: 'sheetid987654321', range: 'Archive!A2:G', permissions: ['read'] }
  ]);
  const grant: WorkspaceResourceGrant = {
    projectId: 'p1', connectionId: 'google_1', documentId: 'legacydoc12345',
    spreadsheetId: 'legacysheet12345', sheetRange: 'Default!A2:G', resources, updatedAt: 1
  };

  test('resolves human-named resources and required permissions', () => {
    assert.equal(resolveGoogleDocGrant(grant, 'source').documentId, 'abcdefghij12345');
    assert.deepEqual(resolveGoogleSheetGrant(grant, 'append', 'tasks'), {
      spreadsheetId: 'sheetid123456789', range: 'Tasks!A2:G', resourceName: 'tasks'
    });
    assert.throws(() => resolveGoogleSheetGrant(grant, 'append', 'read_only'), /does not grant append/);
    assert.throws(() => resolveGoogleSheetGrant(grant, 'read', 'missing'), /not granted/);
  });

  test('legacy default grant remains available when no resource_name is selected', () => {
    assert.equal(resolveGoogleDocGrant(grant, undefined).documentId, 'legacydoc12345');
    assert.deepEqual(resolveGoogleSheetGrant(grant, 'upsert', undefined), {
      spreadsheetId: 'legacysheet12345', range: 'Default!A2:G'
    });
  });

  test('catalog enforces unique names and resource permissions', () => {
    assert.throws(() => normalizeWorkspaceNamedResources([
      { name: 'Tasks', type: 'google_sheet_range', spreadsheetId: 'sheetid123456789', range: 'Tasks!A2:G' },
      { name: 'tasks', type: 'google_sheet_range', spreadsheetId: 'sheetid987654321', range: 'Other!A2:G' }
    ]), /Duplicate/);
    assert.throws(() => normalizeWorkspaceNamedResources([
      { name: 'doc', type: 'google_doc', documentId: 'abcdefghij12345', permissions: ['append'] }
    ]), /supports read permission only/);
  });
});
