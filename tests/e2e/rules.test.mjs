// Verifies the production rules against the RTDB emulator. Organization
// membership and invites are server-owned; clients may only access tenant data
// when a corresponding organizations/{orgId}/members/{uid} record exists.
const DB = 'http://127.0.0.1:9010';
const NS = 'hyper-flow-a459b-default-rtdb';

let pass = 0, fail = 0;
const ok = (condition, label, detail) => {
  if (condition) { pass++; console.log(`  PASS ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const section = label => console.log(`\n${label}`);
const b64 = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const tokenFor = uid => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, iss: `https://securetoken.google.com/${NS}`,
  aud: NS, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  firebase: { sign_in_provider: 'password' }
})}.`;

const url = (path, auth) => {
  const value = new URL(`${DB}/${path}.json`);
  value.searchParams.set('ns', NS);
  if (auth) value.searchParams.set('auth', auth);
  return value.toString();
};

const request = async (method, path, body, auth) => {
  const response = await fetch(url(path, auth), {
    method,
    headers: { 'Content-Type': 'application/json', ...(auth === 'owner' ? { Authorization: 'Bearer owner' } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { ok: response.ok, status: response.status, text: await response.text() };
};
const admin = (method, path, body) => request(method, path, body, 'owner');
const as = (uid, method, path, body) => request(method, path, body, uid ? tokenFor(uid) : undefined);

const seed = async () => {
  await admin('PUT', '', null);
  await admin('PUT', 'users/alice', { email: 'alice@example.com', orgId: 'org_a', role: 'owner' });
  await admin('PUT', 'users/mallory', { email: 'mallory@example.com', orgId: 'org_m', role: 'owner' });
  await admin('PUT', 'organizations/org_a', { name: 'Acme', createdAt: Date.now(), members: { alice: { role: 'owner' } } });
  await admin('PUT', 'organizations/org_m', { name: 'Mallory', createdAt: Date.now(), members: { mallory: { role: 'owner' } } });
  await admin('PUT', 'projects/org_a', { projects: [{ id: 'p1', name: 'Secret' }] });
  await admin('PUT', 'invites/token_bob', { orgId: 'org_a', invitedBy: 'alice', email: 'bob@example.com', createdAt: Date.now() });
  await admin('PUT', 'external_events/org_a/event_1', { event_id: 'event_1', processing_status: 'processed' });
  await admin('PUT', 'triage_items/org_a/comm_1', { communicationId: 'comm_1', disposition: 'new' });
  await admin('PUT', 'schedules/org_a/schedule_1', { id: 'schedule_1', enabled: true });
  await admin('PUT', 'schedule_runs/org_a/schedule_1/1', { status: 'completed' });
  await admin('PUT', 'communication_cursors/org_a/default', { cursor: 'cursor_1' });
  await admin('PUT', 'ask_resolutions/org_a/ask_1/comm_1', { status: 'processed' });
  await admin('PUT', 'communication_delivery/org_a/comm_1', { status: 'delivered' });
};

const run = async () => {
  await seed();

  section('Membership cannot be self-assigned');
  let result = await as('bob', 'PUT', 'users/bob', { email: 'bob@example.com', orgId: 'org_a', role: 'member' });
  ok(!result.ok, 'a user cannot write their own membership record', `got ${result.status}`);
  result = await as('mallory', 'PUT', 'organizations/org_a/members/mallory', { role: 'owner' });
  ok(!result.ok, 'an outsider cannot add themselves to another organization', `got ${result.status}`);
  result = await as('alice', 'PUT', 'organizations/org_a/members/bob', { role: 'member' });
  ok(!result.ok, 'membership writes are backend-only, including by owners', `got ${result.status}`);

  section('Invite records are backend-only');
  result = await as('bob', 'GET', 'invites/token_bob');
  ok(!result.ok, 'a client cannot read an invite record', `got ${result.status}`);
  result = await as('alice', 'PUT', 'invites/new_token', { orgId: 'org_a', invitedBy: 'alice', createdAt: Date.now() });
  ok(!result.ok, 'a client cannot create an invite record', `got ${result.status}`);
  result = await as('bob', 'DELETE', 'invites/token_bob');
  ok(!result.ok, 'a client cannot consume an invite directly', `got ${result.status}`);

  section('Tenant isolation follows server-created membership');
  result = await as(null, 'GET', 'projects/org_a');
  ok(!result.ok, 'anonymous users cannot read tenant data', `got ${result.status}`);
  result = await as('mallory', 'GET', 'projects/org_a');
  ok(!result.ok, 'another tenant cannot read tenant data', `got ${result.status}`);
  result = await as('alice', 'GET', 'projects/org_a');
  ok(result.ok, 'a server-created member can read tenant data', `got ${result.status}`);
  result = await as('alice', 'PUT', 'projects/org_a', { projects: [] });
  ok(result.ok, 'a server-created member can write tenant data', `got ${result.status}`);

  section('Private and operational trees');
  result = await as('mallory', 'GET', 'users/alice');
  ok(!result.ok, 'user profiles are private', `got ${result.status}`);
  result = await as('mallory', 'GET', 'external_events');
  ok(!result.ok, 'the event inbox is backend-only', `got ${result.status}`);
  result = await as('mallory', 'PUT', 'external_events/org_a/event_2', { event_id: 'event_2' });
  ok(!result.ok, 'clients cannot forge event inbox records', `got ${result.status}`);
  for (const root of ['triage_items', 'schedules', 'schedule_runs', 'communication_cursors', 'ask_resolutions', 'communication_delivery']) {
    result = await as('alice', 'GET', `${root}/org_a`);
    ok(!result.ok, `${root} reads are API-only, even for tenant members`, `got ${result.status}`);
    result = await as('mallory', 'PUT', `${root}/org_a/forged`, { forged: true });
    ok(!result.ok, `${root} cannot be forged across tenants`, `got ${result.status}`);
  }
  result = await as('mallory', 'GET', 'serverActivity');
  ok(!result.ok, 'server activity is backend-only', `got ${result.status}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch(error => { console.error('Harness error:', error); process.exit(2); });
