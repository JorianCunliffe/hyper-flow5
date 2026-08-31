import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rules = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, '..', 'database.rules.json'), 'utf8')
).rules;

describe('Firebase production rules configuration', () => {
  test('keeps the triage tree backend-only', () => {
    assert.equal(rules.triage_items['.read'], false);
    assert.equal(rules.triage_items['.write'], false);
  });

  test('indexes the tenant triage query used by the server', () => {
    assert.equal(rules.triage_items.$orgId['.indexOn'], 'updatedAt');
    assert.equal(rules.triage_digests.$orgId['.indexOn'], 'scheduledFor');
    assert.equal(rules.triage_digests['.read'], false);
    assert.equal(rules.triage_digests['.write'], false);
  });

  test('indexes schedule run history at the queried schedule path', () => {
    assert.equal(rules.schedule_runs.$orgId.$scheduleId['.indexOn'], 'scheduledFor');
    assert.equal(rules.schedule_runs['.read'], false);
    assert.equal(rules.schedule_runs['.write'], false);
  });

  test('keeps agent profiles and integration references backend-only', () => {
    assert.deepEqual(rules.agent_profiles, { '.read': false, '.write': false });
    assert.deepEqual(rules.integration_connections, { '.read': false, '.write': false });
    assert.deepEqual(rules.integration_credentials, { '.read': false, '.write': false });
    assert.deepEqual(rules.oauth_states, { '.read': false, '.write': false });
    assert.deepEqual(rules.workspace_grants, { '.read': false, '.write': false });
    assert.deepEqual(rules.external_action_receipts, { '.read': false, '.write': false });
    assert.deepEqual(rules.coaching_sessions, { '.read': false, '.write': false });
    assert.equal(rules.agent_inbox_jobs['.read'], false);
    assert.equal(rules.agent_inbox_jobs['.write'], false);
    assert.equal(rules.agent_inbox_pending['.indexOn'], 'availableAt');
    assert.equal(rules.agent_inbox_pending['.read'], false);
    assert.deepEqual(rules.conversation_contexts, { '.read': false, '.write': false });
    assert.deepEqual(rules.agent_voice_context_requests, { '.read': false, '.write': false });
    assert.equal(rules.coaching_retry_pending['.indexOn'], 'availableAt');
    assert.equal(rules.coaching_retry_pending['.read'], false);
  });
});
