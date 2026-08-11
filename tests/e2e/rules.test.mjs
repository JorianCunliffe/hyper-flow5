// Verifies database.rules.json against the RTDB emulator, exercising the real
// invite flow from services/firebaseService.ts plus the enumeration attacks the
// old rules allowed.

const DB = 'http://127.0.0.1:9010';
const NS = 'hyper-flow-a459b-default-rtdb';

let pass = 0, fail = 0;
const ok = (cond, label, detail) => {
  if (cond) { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); }
  else { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`); }
};
const section = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
/** The emulator accepts unsigned JWTs and does not verify the signature. */
const tokenFor = uid => `${b64({ alg: 'none', typ: 'JWT' })}.${b64({
  sub: uid, user_id: uid, iss: `https://securetoken.google.com/${NS}`,
  aud: NS, iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600,
  firebase: { sign_in_provider: 'password' }
})}.`;

const url = (path, auth) => {
  const u = new URL(`${DB}/${path}.json`);
  u.searchParams.set('ns', NS);
  if (auth) u.searchParams.set('auth', auth);
  return u.toString();
};

// Admin writes bypass rules — used only to set up fixtures.
const admin = async (method, path, body) => {
  const r = await fetch(url(path), {
    method,
    headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`admin ${method} ${path} -> ${r.status} ${await r.text()}`);
};

const as = async (uid, method, path, body) => {
  const r = await fetch(url(path, uid ? tokenFor(uid) : undefined), {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  return { status: r.status, ok: r.ok, text: await r.text() };
};

const DAY = 86400000;

const seed = async () => {
  await admin('PUT', '', null);
  // Two orgs, two users.
  await admin('PUT', 'users/alice', { email: 'alice@x.com', orgId: 'org_a', role: 'admin' });
  await admin('PUT', 'users/mallory', { email: 'mallory@evil.com', orgId: 'org_m', role: 'admin' });
  await admin('PUT', 'organizations/org_a', { name: 'Acme', createdAt: Date.now() });
  await admin('PUT', 'projects/org_a', { projects: [{ id: 'p1', name: 'Secret Project' }], lastUpdated: 1 });
  // A live invite into org_a, and one that has gone stale.
  await admin('PUT', 'invites/token_fresh', { orgId: 'org_a', invitedBy: 'alice', email: 'bob@x.com', createdAt: Date.now() });
  await admin('PUT', 'invites/token_stale', { orgId: 'org_a', invitedBy: 'alice', email: 'old@x.com', createdAt: Date.now() - 30 * DAY });
  await admin('PUT', 'accounts/default_user', { projectflow_v1: { projects: [] } });
  await admin('PUT', 'external_events/evt_1', { event_id: 'evt_1', processing_status: 'processed' });
};

const run = async () => {
  await seed();

  section('Invite enumeration (the org-takeover path in the old rules)');
  {
    let r = await as(null, 'GET', 'invites');
    ok(!r.ok, 'anonymous cannot list all invites', `got ${r.status}`);

    r = await as('mallory', 'GET', 'invites');
    ok(!r.ok, 'an authenticated outsider cannot list all invites', `got ${r.status} ${r.text.slice(0, 80)}`);

    r = await as('mallory', 'GET', 'invites/token_fresh');
    ok(r.ok, 'but a token you already hold is readable — the token IS the capability');
  }

  section('Invite tampering');
  {
    // The old rules allowed `data.exists() ? true : ...` — any authed user could
    // overwrite an existing invite and redirect it at their own org.
    let r = await as('mallory', 'PUT', 'invites/token_fresh',
      { orgId: 'org_m', invitedBy: 'mallory', createdAt: Date.now() });
    ok(!r.ok, 'an outsider cannot redirect an existing invite to their own org', `got ${r.status}`);

    const check = await as('mallory', 'GET', 'invites/token_fresh');
    ok(JSON.parse(check.text).orgId === 'org_a', 'the invite still points at the original org');

    r = await as('mallory', 'DELETE', 'invites/token_fresh');
    ok(!r.ok, 'an outsider cannot delete another org\'s invite', `got ${r.status}`);

    r = await as('mallory', 'PUT', 'invites/token_new',
      { orgId: 'org_a', invitedBy: 'mallory', createdAt: Date.now() });
    ok(!r.ok, 'nobody can mint an invite into an org they do not belong to', `got ${r.status}`);

    r = await as('alice', 'PUT', 'invites/token_new2',
      { orgId: 'org_a', invitedBy: 'mallory', createdAt: Date.now() });
    ok(!r.ok, 'invitedBy cannot be forged', `got ${r.status}`);
  }

  section('Expiry');
  {
    const r = await as('mallory', 'GET', 'invites/token_stale');
    ok(!r.ok, 'an invite older than 7 days is no longer readable', `got ${r.status}`);
  }

  section('The real invite flow still works');
  {
    // createInviteResultUrl: a member of org_a mints an invite.
    let r = await as('alice', 'PUT', 'invites/token_bob',
      { orgId: 'org_a', invitedBy: 'alice', email: 'bob@x.com', createdAt: Date.now() });
    ok(r.ok, 'a member can create an invite for their own org', `got ${r.status} ${r.text.slice(0, 120)}`);

    // consumeInviteToken, step 1: the invitee reads the token they were sent.
    r = await as('bob', 'GET', 'invites/token_bob');
    ok(r.ok && JSON.parse(r.text).orgId === 'org_a', 'the invitee can read the token they were sent');

    // step 2: the invitee joins by writing their own user record.
    r = await as('bob', 'PUT', 'users/bob', { email: 'bob@x.com', orgId: 'org_a', role: 'member' });
    ok(r.ok, 'the invitee can set their own membership', `got ${r.status}`);

    // step 3: cleanup — now that bob is in org_a, he may delete the invite.
    r = await as('bob', 'DELETE', 'invites/token_bob');
    ok(r.ok, 'the consumed invite can be cleaned up', `got ${r.status}`);

    // and the whole point: bob can now see the org's data.
    r = await as('bob', 'GET', 'projects/org_a');
    ok(r.ok, 'the invitee can now read the org project data');
  }

  section('Project and org isolation');
  {
    let r = await as(null, 'GET', 'projects/org_a');
    ok(!r.ok, 'anonymous cannot read project data', `got ${r.status}`);

    r = await as('mallory', 'GET', 'projects/org_a');
    ok(!r.ok, 'another org cannot read project data', `got ${r.status}`);

    r = await as('mallory', 'PUT', 'projects/org_a', { projects: [] });
    ok(!r.ok, 'another org cannot overwrite project data', `got ${r.status}`);

    r = await as('alice', 'GET', 'projects/org_a');
    ok(r.ok, 'a member can read their own org project data');

    r = await as('mallory', 'GET', 'users/alice');
    ok(!r.ok, 'user records are private to the user', `got ${r.status}`);

    r = await as('mallory', 'GET', 'organizations/org_a');
    ok(!r.ok, 'another org cannot read the org record', `got ${r.status}`);
  }

  section('Legacy and server-only trees');
  {
    let r = await as(null, 'GET', 'accounts');
    ok(!r.ok, 'the legacy accounts tree is no longer world-readable', `got ${r.status}`);

    r = await as('mallory', 'GET', 'accounts/default_user');
    ok(!r.ok, 'nor readable by an authenticated user', `got ${r.status}`);

    r = await as('mallory', 'GET', 'external_events');
    ok(!r.ok, 'external event inbox records are server-only', `got ${r.status}`);

    r = await as('mallory', 'PUT', 'external_events/evt_2', { event_id: 'evt_2' });
    ok(!r.ok, 'and cannot be forged by a client to suppress a real event', `got ${r.status}`);

    r = await as('mallory', 'GET', 'serverActivity');
    ok(!r.ok, 'server activity log is server-only', `got ${r.status}`);
  }

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed\x1b[0m\n`);
  process.exit(fail === 0 ? 0 : 1);
};

run().catch(e => { console.error('\x1b[31mHarness error:\x1b[0m', e); process.exit(2); });
