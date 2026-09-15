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

  test('keeps FlowRun, Hold and authority stores backend-only with required indexes', () => {
    for (const root of ['flow_runs', 'flow_holds', 'flow_hold_open', 'flow_hold_pending', 'capability_policy', 'workspace_resource_catalog']) {
      assert.equal(rules[root]['.read'], false);
      assert.equal(rules[root]['.write'], false);
    }
    assert.equal(rules.flow_runs.$orgId.$projectId['.indexOn'], 'updatedAt');
    assert.equal(rules.flow_hold_pending['.indexOn'], 'availableAt');
  });

  test('keeps agent profiles and integration references backend-only', () => {
    for(const root of ['agent_profiles','integration_connections','integration_credentials','oauth_states','workspace_grants','external_action_receipts','coaching_sessions','conversation_contexts','agent_voice_context_requests']){
      assert.equal(rules[root]['.read'],false);assert.equal(rules[root]['.write'],false);
      assert.match(rules[root].$orgId['.read'],/auth.token.hyperflow_runtime === true/);
      assert.match(rules[root].$orgId['.write'],/tenant_lifecycle/);
    }
    assert.equal(rules.agent_inbox_jobs['.read'],false);
    assert.equal(rules.agent_inbox_jobs['.write'],false);
    for(const root of ['agent_inbox_pending','coaching_retry_pending']){
      assert.deepEqual(rules[root]['.indexOn'],['availableAt','orgId']);
      assert.match(rules[root]['.read'],/auth.token.hyperflow_runtime === true/);
    }
  });
});
