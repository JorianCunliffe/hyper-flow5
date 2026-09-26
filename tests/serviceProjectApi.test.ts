import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { serviceProjectRequest, SERVICE_PROJECT_ROUTES, serviceProjectDependencies } from '../lib/serviceProjectApi.js';
import { requestScope } from '../lib/tenantControl/clients.js';

const member = { orgId: 'tenant-a', uid: 'user-a', role: 'admin', apiClientId: 'read-client' } as any;
function fixture() {
  const calls: string[] = [];
  const schedules = Object.freeze([Object.freeze({ id: 'orphan', activity: 'communications_triage', enabled: true, nextRunAt: Date.now() + 60000 })]);
  const scoped = (org: string) => { assert.equal(org, member.orgId); calls.push(org); };
  const deps: typeof serviceProjectDependencies = {
    listTenantProjects: async org => { scoped(org); return [{ id: 'project-a', projectData: { project_template: 'email_triage' } }] as any; },
    listTenantSchedules: async org => { scoped(org); return schedules as any; },
    listWorkspaceConnectionRefs: async org => { scoped(org); return []; },
    readSchedulerHealth: async () => null as any,
    listScheduleRuns: async org => { scoped(org); return []; },
    listTenantTriageDigests: async org => { scoped(org); return []; },
    listMailboxes: async org => { scoped(org); return []; },
    readServiceSetupDraft: async (org, uid, id) => { scoped(org); assert.equal(uid, member.uid); return { id } as any; },
    saveServiceSetupDraft: async (org, uid, body) => { scoped(org); assert.equal(uid, member.uid); return body as any; },
    validateServiceSetup: async org => { scoped(org); return { ready: false } as any; },
  };
  return { deps, calls, schedules };
}

test('status is read-only for an orphan schedule and cannot select another tenant', async () => {
  const { deps, schedules, calls } = fixture();
  const r = await serviceProjectRequest('service_setup_status', { method: 'GET', query: { orgId: 'tenant-b' } }, member, deps);
  assert.equal(r.status, 200);
  assert.equal(r.body.upgradeRequired, true);
  assert.deepEqual(r.body.unboundScheduleIds, ['orphan']);
  assert.equal(r.body.schedules[0].enabled, true);
  assert.equal(r.body.schedules[0].projectId, undefined);
  assert.strictEqual(r.body.schedules, schedules);
  assert.ok(calls.length >= 4);
  assert.equal(r.body.mailboxStatus, 'available');
});

test('status distinguishes a failed mailbox lookup from an empty connected mailbox list', async () => {
  const { deps } = fixture();
  deps.listMailboxes = async () => { throw new Error('private provider error'); };
  const r = await serviceProjectRequest('service_setup_status', { method: 'GET' }, member, deps);
  assert.equal(r.body.mailboxStatus, 'unavailable');
  assert.deepEqual(r.body.mailboxes, []);
  assert.ok(!JSON.stringify(r.body).includes('private provider error'));
  assert.equal((await serviceProjectRequest('service_setup_status', { method: 'GET', query: { projectId: 'other-tenant-project' } }, member, deps)).status, 404);
});

test('draft and validation operations preserve tenant/user scope and reject unsupported methods', async () => {
  const { deps } = fixture();
  assert.equal((await serviceProjectRequest('service_setup_draft', { method: 'GET' }, member, deps)).status, 400);
  const saved = await serviceProjectRequest('service_setup_draft', { method: 'POST', body: { template: 'email_triage', orgId: 'tenant-b', uid: 'user-b' } }, member, deps);
  assert.equal(saved.status, 201);
  assert.equal(saved.body.draft.template, 'email_triage');
  assert.equal((await serviceProjectRequest('service_setup_validate', { method: 'POST', body: { setup: { template: 'email_triage' } } }, member, deps)).status, 422);
  for (const action of Object.values(SERVICE_PROJECT_ROUTES)) {
    assert.equal((await serviceProjectRequest(action, { method: 'DELETE' }, member, deps)).status, 405);
  }
});

test('both deployments register the same service-project routes with read/write scope separation', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
  for (const [route, action] of Object.entries(SERVICE_PROJECT_ROUTES)) {
    assert.equal(config.rewrites.find((r: any) => r.source === route)?.destination, '/api/communications/status?action=' + action);
    assert.equal(requestScope({ url: route, method: 'GET' }), 'service-projects:read');
    assert.equal(requestScope({ url: route, method: 'POST' }), 'service-projects:write');
  }
  assert.match(readFileSync('lib/http/express.ts', 'utf8'), /config.rewrites/);
  assert.match(readFileSync('api/communications/status.ts', 'utf8'), /SERVICE_PROJECT_ROUTES/);
});
