// Verifies the production rules against the RTDB emulator. Organization
// membership and invites are server-owned; clients may only access tenant data
// when a corresponding organizations/{orgId}/members/{uid} record exists.
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, set } from 'firebase/database';

const PROJECT_ID = 'hyper-flow-a459b';
const RULES = readFileSync(new URL('../../database.rules.json', import.meta.url), 'utf8');

let pass = 0;
let fail = 0;
let testEnv;

const ok = (condition, label, detail) => {
  if (condition) {
    pass++;
    console.log(`  PASS ${label}`);
  } else {
    fail++;
    console.log(`  FAIL ${label}${detail ? `\n      ${detail}` : ''}`);
  }
};

const section = label => console.log(`\n${label}`);

const request = async (uid, method, path, body) => {
  const context = uid
    ? testEnv.authenticatedContext(uid)
    : testEnv.unauthenticatedContext();
  const target = ref(context.database(), path);

  try {
    if (method === 'GET') await get(target);
    else if (method === 'PUT') await set(target, body);
    else if (method === 'DELETE') await remove(target);
    else throw new Error(`Unsupported method: ${method}`);
    return { ok: true };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) };
  }
};

const seed = async () => {
  await testEnv.clearDatabase();
  await testEnv.withSecurityRulesDisabled(async context => {
    await set(ref(context.database()), {
      users: {
        alice: { email: 'alice@example.com', orgId: 'org_a', role: 'owner' },
        mallory: { email: 'mallory@example.com', orgId: 'org_m', role: 'owner' }
      },
      organizations: {
        org_a: { name: 'Acme', createdAt: Date.now(), members: { alice: { role: 'owner' } } },
        org_m: { name: 'Mallory', createdAt: Date.now(), members: { mallory: { role: 'owner' } } }
      },
      projects: { org_a: { projects: [{ id: 'p1', name: 'Secret' }] } },
      invites: {
        token_bob: { orgId: 'org_a', invitedBy: 'alice', email: 'bob@example.com', createdAt: Date.now() }
      },
      external_events: { org_a: { event_1: { event_id: 'event_1', processing_status: 'processed' } } },
      triage_items: { org_a: { comm_1: { communicationId: 'comm_1', disposition: 'new' } } },
      schedules: { org_a: { schedule_1: { id: 'schedule_1', enabled: true } } },
      schedule_runs: { org_a: { schedule_1: { 1: { status: 'completed' } } } },
      communication_cursors: { org_a: { default: { cursor: 'cursor_1' } } },
      ask_resolutions: { org_a: { ask_1: { comm_1: { status: 'processed' } } } },
      communication_delivery: { org_a: { comm_1: { status: 'delivered' } } }
    });
  });
};

const run = async () => {
  testEnv = await initializeTestEnvironment({
    projectId: PROJECT_ID,
    database: { host: '127.0.0.1', port: 9010, rules: RULES }
  });

  try {
    await seed();

    section('Membership cannot be self-assigned');
    let result = await request('bob', 'PUT', 'users/bob', { email: 'bob@example.com', orgId: 'org_a', role: 'member' });
    ok(!result.ok, 'a user cannot write their own membership record', result.detail);
    result = await request('mallory', 'PUT', 'organizations/org_a/members/mallory', { role: 'owner' });
    ok(!result.ok, 'an outsider cannot add themselves to another organization', result.detail);
    result = await request('alice', 'PUT', 'organizations/org_a/members/bob', { role: 'member' });
    ok(!result.ok, 'membership writes are backend-only, including by owners', result.detail);

    section('Invite records are backend-only');
    result = await request('bob', 'GET', 'invites/token_bob');
    ok(!result.ok, 'a client cannot read an invite record', result.detail);
    result = await request('alice', 'PUT', 'invites/new_token', { orgId: 'org_a', invitedBy: 'alice', createdAt: Date.now() });
    ok(!result.ok, 'a client cannot create an invite record', result.detail);
    result = await request('bob', 'DELETE', 'invites/token_bob');
    ok(!result.ok, 'a client cannot consume an invite directly', result.detail);

    section('Tenant isolation follows server-created membership');
    result = await request(null, 'GET', 'projects/org_a');
    ok(!result.ok, 'anonymous users cannot read tenant data', result.detail);
    result = await request('mallory', 'GET', 'projects/org_a');
    ok(!result.ok, 'another tenant cannot read tenant data', result.detail);
    result = await request('alice', 'GET', 'projects/org_a');
    ok(result.ok, 'a server-created member can read tenant data', result.detail);
    result = await request('alice', 'PUT', 'projects/org_a', { projects: [] });
    ok(result.ok, 'a server-created member can write tenant data', result.detail);

    section('Private and operational trees');
    result = await request('mallory', 'GET', 'users/alice');
    ok(!result.ok, 'user profiles are private', result.detail);
    result = await request('mallory', 'GET', 'external_events');
    ok(!result.ok, 'the event inbox is backend-only', result.detail);
    result = await request('mallory', 'PUT', 'external_events/org_a/event_2', { event_id: 'event_2' });
    ok(!result.ok, 'clients cannot forge event inbox records', result.detail);
    for (const root of ['triage_items', 'schedules', 'schedule_runs', 'scheduler_health', 'service_setup_drafts', 'communication_cursors', 'ask_resolutions', 'communication_delivery']) {
      result = await request('alice', 'GET', `${root}/org_a`);
      ok(!result.ok, `${root} reads are API-only, even for tenant members`, result.detail);
      result = await request('mallory', 'PUT', `${root}/org_a/forged`, { forged: true });
      ok(!result.ok, `${root} cannot be forged across tenants`, result.detail);
    }
    result = await request('mallory', 'GET', 'serverActivity');
    ok(!result.ok, 'server activity is backend-only', result.detail);
  } finally {
    await testEnv.cleanup();
  }

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exitCode = fail === 0 ? 0 : 1;
};

run().catch(error => {
  console.error('Harness error:', error);
  process.exitCode = 2;
});
