# End-to-end tests

`npm test` covers the engine, orchestrator and ask logic as pure functions — no
network, no database. This suite covers what those cannot: real HTTP, real
`firebase-admin` reads and path-scoped writes, and the transaction-based webhook
idempotency claim.

It is not part of `npm test` because it needs a database emulator and a running
server.

## Why it exists

The first time this code ran against a real database it crashed on every ask
path. Firebase RTDB **does not store empty arrays** — it drops the key — and
returns populated arrays as index-keyed objects. Every newly created ask has
`responses: []`, so every ask came back malformed. No amount of unit testing
would have found it; only a round-trip through a real database does.

`tests/rtdbShape.test.ts` now pins that behaviour as unit tests, but this suite
is what caught it.

## Running it

Three terminals, or background the first two.

**1. Database emulator** (needs Java; the Android Studio bundled runtime also works):

```powershell
$env:Path = 'C:\Program Files\Android\Android Studio\jbr\bin;' + $env:Path
npx --yes firebase-tools emulators:start --project demo-hyperflow --only database --config firebase.test.json
```

If your shell has an HTTP proxy configured, unset it for this command — the CLI
uploads rules over localhost and a proxy will intercept it:

```bash
env -u HTTP_PROXY -u HTTPS_PROXY -u http_proxy -u https_proxy \
  npx --yes firebase-tools emulators:start --only database \
  --project demo-hyperflow --config firebase.test.json
```

**2. A service account.** The emulator ignores credentials, but `cert()` still
parses the key, so any syntactically valid one works:

```bash
openssl genrsa -out /tmp/fake-key.pem 2048
node -e 'const fs=require("fs");fs.writeFileSync("/tmp/sa.json",JSON.stringify({
  type:"service_account",project_id:"demo-hyperflow",private_key_id:"fake",
  private_key:fs.readFileSync("/tmp/fake-key.pem","utf8"),
  client_email:"test@demo-hyperflow.iam.gserviceaccount.com",client_id:"1"}))'
```

**3. The server, pointed at the emulator:**

```bash
NODE_ENV=production \
FIREBASE_SERVICE_ACCOUNT="$(cat /tmp/sa.json)" \
FIREBASE_DATABASE_URL="https://demo-hyperflow-default-rtdb.firebaseio.com" \
FIREBASE_DATABASE_EMULATOR_HOST="127.0.0.1:9010" \
WEBHOOK_SECRET="test-secret-123" \
COMMUNICATIONS_WEBHOOK_SECRET="test-secret-123" \
PUBLIC_BASE_URL="http://localhost:3000" \
npx tsx server.ts
```

**4. The suite:**

```bash
npm run test:e2e
```

## Gotcha: the emulator namespace

`firebase-admin` derives the emulator namespace from the **first label of the
`databaseURL` hostname**. With the URL above that is
`demo-hyperflow-default-rtdb`, *not* `demo-hyperflow`. Seeding the wrong
namespace produces a confusing `project_not_found` while the emulator plainly
holds the data — the suite's `NS` constant must match the URL.

## Security rules suite

`npm run test:rules` checks `database.rules.json` against the emulator, using the
real invite flow from `services/firebaseService.ts` plus the attacks the rules
are meant to stop. The script starts and stops the emulator automatically on
port `9010`; it needs no server and no service account. The emulator accepts
unsigned test JWTs, so the suite can act as several different users.

Rules are the only thing standing between the database and the public internet,
so changing them without running this is how you either lock everyone out or
leave a hole open. Against the rules as they were before this suite existed, 10
of its original checks failed; the current suite contains 26 checks.

## What it covers

- auth guards on every endpoint (including exact raw-body Communications HMAC verification)
- a Communications API event resolving a waiting run, merging its payload into
  project data, and a downstream decision branching on it — with no browser involved
- duplicate webhook delivery claimed and rejected via an RTDB transaction
- path-scoped writes leaving `settings` untouched and bumping `lastUpdated`
- reading and answering an ask by token, including revise-without-a-comment
  being rejected and the comment being stored as the redo instruction
- an ambiguous reply ("no problem, looks great") being recorded without
  releasing the review gate
- answering an already-answered ask returning 409
