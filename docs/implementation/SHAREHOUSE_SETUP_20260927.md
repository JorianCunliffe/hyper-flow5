# Isolated Sharehouse setup evidence — 27 September 2026

Source base: `71bec0c4685a07701c143daeaca66bda164a381d`, with the fixture/tests in this change. **SH-01: BLOCKED. Overall Sharehouse acceptance: NOT ACCEPTED.** No production configuration, schedule, mailbox, Sheet, SMS or call was changed.

## Field-preservation fix follow-up

The initial findings below are retained as failure evidence. After the fixture was published as `274e4a6`, `NodeConfigModal` was changed to preserve the existing `human` configuration before applying explicit edits. Static fields (including type, required flags and options), response policy and quorum now survive saves. Editable values can still be changed or cleared normally; this fix does not restore schema information already lost from a previously saved definition.

The [browser regression](../../tests/ui/sharehouse-preservation-check.js) failed on the original editor with `Static fields, types, required flags and options survive save`, then passed **9/9 checks** with the fix. It loads two static fields and a quorum policy, edits prompt/channel, saves twice, and checks dynamic schema source and escalation separately. An additional browser reload verified the stored fields, edited values and quorum remained intact. No browser errors or provider calls were reported.

Run on the isolated fixture while Vite is running:

```powershell
npx.cmd --yes agent-browser --session sharehouse-fix open http://127.0.0.1:3017/tests/ui/sharehouse-setup.html
Get-Content tests/ui/sharehouse-preservation-check.js -Raw | npx.cmd --yes agent-browser --session sharehouse-fix eval --stdin
```

The fixture now uses the supported `question` Ask kind instead of its earlier `form` value. This corrects the fixture/dropdown mismatch; the regression reproduces the field-loss bug with the supported kind before the fix. The editor defect is resolved, but complete UI/API setup, finalisation and live-provider acceptance remain open. SH-01 is not promoted to PASS by this repair.

Post-fix validation: type-check and production build passed; the full suite again passed **779/779**, with no skipped tests. The existing build-size warning remains. Browser regression: **9/9**, plus persisted-state inspection after reload. The browser script is a separate check, not included in the Node suite count.

## What ran

- [Candidate 18-node graph and synthetic data](../../tests/fixtures/sharehouse/fullWorkflow.ts): morning intake, reads, task batch, planning, native draft batch, Human Wait, draft updates, enquiry upsert, slots, notifications, audit; separate inbound acknowledgement, team Ask, reply and audit.
- [Six setup/fixture tests](../../tests/sharehouseSetup.test.ts), invoking the real configuration and test-run handlers with injected in-memory persistence, the real resource validator and pure orchestrator. This is handler-level testing, not authenticated HTTP or Firebase-emulator coverage.
- [Browser fixture](../../tests/ui/sharehouse-setup.html), using the real resource editor and node configuration modal with mocked API calls and browser-local persistence. External connections are restricted by CSP; no live executor is available. Vite served only on `127.0.0.1:3017`.

## Observed results

| Check | Result | Evidence and limit |
|---|---|---|
| Graph plan/apply/read-back and request replay | PASS, supporting check | Both paths and their configuration survive JSON persistence; replay retains revision 1; a new stale-revision request is rejected. This does not create schedule/contact/resource grants. |
| Invalid dependency and email-authority injection | PASS, supporting check | Invalid graph cannot be validly planned; machine graph creation cannot set `emailSendingEnabled`. |
| Four-resource server validation | PASS, supporting check | Distinct exact ranges and permissions accepted; duplicate name and missing file ID rejected. No Google call made. |
| Morning simulation to human gate | PASS, supporting check | Five task-write intents and four draft intents; held at `morning_answers`; zero finalisation, Sheet allocation or notification dispatches. Test-run replay returns the same stored result; another client cannot read it. |
| Failed intake | PASS, supporting check | Only intake and independent reads dispatch; no downstream task/draft/finalisation work. |
| Inbound branch isolation | PASS, supporting check | Only acknowledgement dispatches, one owning-run incident Ask opens, morning nodes do not run. |
| Resource UI configuration | PASS, supporting check | Manually added tasks/enquiries/communications/inspections through editor; enabled append or upsert as specified, saved, reloaded and reselected project. Four ranges and permissions retained. Persistence is a mock, not a deployed grant. |
| Morning Human Wait editor | PASS, supporting check | Save/reload retains `plan_output.open_questions`, payload variable, primary/fallback identities, ten-minute retry and weekday 09:15 Brisbane settings. |
| Inbound Human Wait editor | **FAIL** | Opening and saving the node removes the static required `team_answer` field. The persisted definition no longer has `holdConfig.human.fields`. This blocks SH-01. |
| Browser health | PASS, supporting check | Page and editors render, no Vite error overlay or reported browser errors during this run. |

The fake intake already contains classified/deduplicated task rows and the report is a canned plan. These tests do not prove classification, business deduplication, capacity allocation or AI factual accuracy. The generic simulator supplies one canned draft receipt for the node's items; it does not prove distinct real draft identities. No real adapter executed. Post-confirmation nodes are represented but were not executed because the generic simulator does not resolve human/external Holds. These limits are not acceptance waivers.

## Reproduce the editor failure

```powershell
npx.cmd vite --host 127.0.0.1 --port 3017 --strictPort
```

Open `http://127.0.0.1:3017/tests/ui/sharehouse-setup.html`, reset the isolated fixture, select **incident answers**, then **Edit selected node** and **Save** without changing anything. The saved node initially has:

```json
"fields": [{"name":"team_answer","label":"Where is the team?","type":"string","required":true}]
```

After save, `fields` is absent. Reload and select the same node to confirm the loss persists. The original fixture file remains unchanged; **Reset isolated fixture** restores it. `NodeConfigModal.tsx` reconstructs `holdConfig.human` without preserving its static fields; response policy/quorum also need regression coverage when fixing this path. The dropdown displays Question for a stored `form` kind, another representation mismatch to review.

## Other blockers and next bounded step

1. Fix and regression-test Human Wait editor preservation of fields, schema source and response policy before attempting complete UI setup.
2. Extend the isolated harness to submit validated partial/final answers and resume through real response/persistence paths with fake transports; assert original draft IDs, exact allocations and effect counts. Do not mark Holds resolved by manually patching runtime state.
3. Configure and verify dedicated schedule/contact/grant APIs and the actual setup wizard. The fixture's schedule is an inert specification, not a saved scheduler record.
4. Resolve the inbound escalation mismatch: the shared morning escalation retries primary before fallback and sends callback SMS after failures; SH-16 requires primary no-answer → SMS primary → fallback. The candidate reuses the existing implementation to expose this gap, not to redefine the requirement.
5. Prove per-attempt contact auditing; the candidate's final audit node does not cover failed contacts as they happen. Complete compiler parity and draft/Sheet conflict cases remain open.

## Validation

```powershell
node --import tsx --test tests/sharehouseSetup.test.ts tests/cairnsCapabilities.test.ts tests/primitivesPlan.test.ts tests/flowInputs.test.ts
npm.cmd run lint
npm.cmd run build
npm.cmd test
```

Focused tests: **29/29 passed** (six new, 23 supporting). Type-check and build passed; build reports its existing large-bundle warning. Full regression suite: **779/779 passed**, no skipped tests. These green checks coexist with the reproduced browser failure: they do not cover the failed editor invariant.

Acceptance ledger: SH-01 BLOCKED with the failed editor subcase; SH-02–07 and SH-16 have partial simulated evidence only and remain NOT RUN at the required end-to-end/provider layers; SH-08–15 and SH-17–24 otherwise remain NOT RUN. No complete SH case is promoted to PASS by this fixture.
