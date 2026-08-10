#!/usr/bin/env node
/**
 * Verifies the security rules actually published to a LIVE Firebase Realtime
 * Database. Run this after publishing database.rules.json.
 *
 *   npm run check:live
 *
 * The important checks need no credentials: every vulnerability that was fixed
 * was reachable by an anonymous client, so an anonymous client is exactly the
 * right thing to test with.
 *
 * Optionally set FIREBASE_SERVICE_ACCOUNT (path to the JSON, or the JSON itself)
 * to additionally confirm the server can still read and write — the Admin SDK
 * bypasses rules, so this proves webhooks will work once deployed.
 *
 * IMPORTANT — why this is fussy about what counts as a refusal:
 * a denial has to be one Firebase actually issued. Behind a corporate proxy or a
 * sandbox that blocks the host, fetch() surfaces the proxy's own 403 as though it
 * were an HTTP response, and a naive "not 200 means secure" check would report a
 * clean pass without ever having reached the database. So a refusal is only
 * counted when it is HTTP 401 carrying Firebase's own "Permission denied" body;
 * anything else is reported as UNREACHABLE rather than as a pass.
 */

import fs from 'node:fs';

const DB = (process.env.FIREBASE_DATABASE_URL ||
  'https://hyper-flow-a459b-default-rtdb.asia-southeast1.firebasedatabase.app').replace(/\/+$/, '');

let pass = 0, fail = 0, unreachable = 0;
const ok = (label, detail) => { pass++; console.log(`  \x1b[32m✓\x1b[0m ${label}`); };
const bad = (label, detail) => { fail++; console.log(`  \x1b[31m✗\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`); };
const unknown = (label, detail) => { unreachable++; console.log(`  \x1b[33m?\x1b[0m ${label}${detail ? `\n      ${detail}` : ''}`); };
const section = t => console.log(`\n\x1b[1m${t}\x1b[0m`);

const request = async (path, init) => {
  try {
    const r = await fetch(`${DB}/${path}.json`, init);
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  } catch (e) {
    return { status: 0, body: '', error: e.cause?.message || e.message };
  }
};

/**
 * 'refused'    Firebase itself said no.
 * 'exposed'    the data came back — the rules are not doing their job.
 * 'unreachable' we never got a verdict from Firebase.
 */
const classify = r => {
  if (r.status === 200) return 'exposed';
  if (r.status === 401 && /permission denied/i.test(r.body)) return 'refused';
  return 'unreachable';
};

const describe = r => r.error ? `network error: ${r.error}` : `HTTP ${r.status} — ${r.body || '(empty body)'}`;

const expectRefused = (r, label) => {
  const verdict = classify(r);
  if (verdict === 'refused') ok(label);
  else if (verdict === 'exposed') bad(label, `READABLE BY ANYONE — ${describe(r)}`);
  else unknown(label, describe(r));
};

const run = async () => {
  console.log(`\nChecking ${DB}\n`);

  // Preflight: prove we can actually talk to Firebase before trusting any
  // refusal. A denied root returning Firebase's own error body is the signal.
  const probe = await request('');
  const probeVerdict = classify(probe);
  if (probeVerdict === 'unreachable') {
    console.log('\x1b[31mCannot reach the database — no checks were performed.\x1b[0m');
    console.log(`  ${describe(probe)}`);
    console.log('\nRun this from a machine with direct internet access (not behind a proxy that');
    console.log('intercepts CONNECT). Nothing below can be concluded until this succeeds.\n');
    process.exit(2);
  }

  section('Anonymous access must be refused');
  expectRefused(probe, 'the database root is not world-readable');
  // With the old rules this returned every invite token, and a token alone is
  // enough to join an organisation.
  expectRefused(await request('invites'), 'invites cannot be listed (was the org-takeover path)');
  expectRefused(await request('projects'), 'project data is not world-readable');
  expectRefused(await request('users'), 'user records are not world-readable');
  expectRefused(await request('organizations'), 'organisations are not world-readable');
  expectRefused(await request('accounts'), 'the legacy accounts tree is closed');
  expectRefused(await request('webhookEvents'), 'webhook idempotency claims are server-only');
  expectRefused(await request('serverActivity'), 'server activity log is server-only');

  section('Anonymous writes must be refused');
  expectRefused(
    await request(`invites/probe_${Date.now()}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orgId: 'attacker', invitedBy: 'nobody', createdAt: Date.now() })
    }),
    'an anonymous client cannot mint an invite'
  );

  const saEnv = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!saEnv) {
    console.log('\n\x1b[2m(skipping admin checks — set FIREBASE_SERVICE_ACCOUNT to include them)\x1b[0m');
  } else {
    section('Server (Admin SDK) can still read and write');
    let app;
    try {
      const { cert, initializeApp } = await import('firebase-admin/app');
      const { getDatabase } = await import('firebase-admin/database');

      const raw = fs.existsSync(saEnv) ? fs.readFileSync(saEnv, 'utf8') : saEnv;
      const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
      const p = JSON.parse(text);
      if (p.private_key) p.private_key = String(p.private_key).replace(/\\n/g, '\n');

      app = initializeApp({
        credential: cert({ projectId: p.project_id, clientEmail: p.client_email, privateKey: p.private_key }),
        databaseURL: DB
      }, `live-check-${Date.now()}`);
      const db = getDatabase(app);

      const ref = db.ref(`webhookEvents/_livecheck/probe`);
      await ref.set({ at: Date.now() });
      ok('admin write succeeded (rules are bypassed, as they should be)');

      const snap = await ref.get();
      snap.exists() ? ok('admin read succeeded') : bad('admin read succeeded', 'value missing after write');

      // The same transaction the webhook idempotency claim relies on.
      const claim = db.ref(`webhookEvents/_livecheck/claim`);
      await claim.remove();
      const first = await claim.transaction(cur => (cur === null ? { at: Date.now() } : undefined));
      const second = await claim.transaction(cur => (cur === null ? { at: Date.now() } : undefined));
      first.committed && !second.committed
        ? ok('the webhook idempotency transaction behaves correctly')
        : bad('the webhook idempotency transaction behaves correctly',
              `first committed=${first.committed}, second committed=${second.committed}`);

      await db.ref('webhookEvents/_livecheck').remove();
      ok('probe data cleaned up');
    } catch (e) {
      bad('admin checks', e.message);
    } finally {
      if (app) await app.delete().catch(() => {});
    }
  }

  console.log(`\n\x1b[1m${pass} passed, ${fail} failed${unreachable ? `, ${unreachable} inconclusive` : ''}\x1b[0m`);
  if (fail > 0) console.log('\x1b[31mA path returned data — the rules did not publish as expected.\x1b[0m');
  if (unreachable > 0) console.log('\x1b[33mSome checks could not reach Firebase and prove nothing.\x1b[0m');
  console.log('');
  process.exit(fail === 0 && unreachable === 0 ? 0 : 1);
};

run().catch(e => { console.error('\x1b[31mHarness error:\x1b[0m', e); process.exit(2); });
