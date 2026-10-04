# Project reception verification — 2026-10-04

Status: implementation verified locally; **provider acceptance NOT RUN**. The feature defaults off. No production configuration, calls, SMS or bookings were changed during implementation.

| Check | Result | Evidence |
|---|---|---|
| HyperFlow complete test suite | PASS | `npm test`: 910 passed, zero failed. |
| Reception / setup assistant / Ask escalation regression | PASS | 41 passed, zero failed. Includes routing combinations, caller-only history, disabled history, staff authority, revision and replay checks, partial Ask answers, verification, booking conflicts and uncertain writes. |
| Communications complete isolated suite | PASS | `npm test`: 479 passed, zero failed; no live providers. |
| TypeScript | PASS | `npm run lint`. |
| API generation and drift | PASS | `npm run api:generate`, `npm run api:check`. |
| Production build | PASS | `npm run build`; existing bundle-size warning remains. |
| Database rules | PASS | 34 emulator checks, including browser denial for reception records. Firebase CLI 14.22.0 with installed Java 17; latest CLI needs Java 21. No rules deployed. |
| Browser: create/edit/review/save | PASS | Real Receptionists component against isolated fixture transport. Saving leaves the line paused. Named diary/staff controls and 15/5 defaults displayed. |
| Browser: preview/activation/operator review | PASS | Public preview leaves revision unchanged; activation has its own review/action; enquiry review changes status. Fixture effects only. |
| Cross-service production deployment and routing | NOT RUN | Matching releases and Firebase rules must be deployed with feature off first. |
| Handset, voice model, verification SMS, availability and diary providers | NOT RUN | Must pass the controlled scenarios below before public activation. |

Browser fixture: `npx vite --host 127.0.0.1 --port 5176`, then `/tests/e2e/reception.html`. It uses the real panel with an in-memory transport; it does not exercise authenticated production APIs. Screenshot: [reception-browser-fixture.png](reception-browser-fixture.png).

Rules command, with `JAVA_HOME` pointing to the installed Java 17 runtime:

```powershell
npx.cmd --yes firebase-tools@14.22.0 emulators:exec --project hyper-flow-a459b --only database --config firebase.test.json "node tests/e2e/rules.test.mjs"
```

## Controlled provider gate

1. Deploy both services and rules with `PROJECT_RECEPTION_ENABLED=false`; verify authenticated line discovery and the exact named diary, staff identity, named availability connection and permissions.
2. Configure a test line binding for the public label Cairns Sharehouse, with the approved Sharehouse history sources and Jorian's configured test identity. Review saved settings before separate activation in the controlled environment.
3. Test unknown, singly associated and multiply associated callers, private/disabled services, ambiguous enquiries and service switches. Confirm staff can find unassigned requests and selected-project intake.
4. Verify caller-only email/SMS/voice history, unavailable history, draft-versus-sent distinctions, verification failure and access revocation. Attempt source-content instruction injection.
5. Return a missed staff call: verify identity, select the exact current Ask, submit partial answers, reconnect, finish, and confirm outbound retries are suppressed. Repeat with multiple and superseded Asks.
6. With explicitly approved TEST ONLY bookings, test normal readback/write/receipt, two concurrent callers and the morning workflow, external edits, missing staff availability and a lost provider response. Reconcile the owning operation; do not send a replacement write.
7. Keep email draft-only. No booking SMS is sent by this release's receptionist action set. Publish the public line only after recording all required provider cases as passed.

Google Sheets cannot provide a transaction against external editors. Conflicting or uncertain writes remain held for operator reconciliation. Fixture success does not establish live provider success.
