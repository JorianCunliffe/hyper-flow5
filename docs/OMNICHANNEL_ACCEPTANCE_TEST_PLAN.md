# HyperFlow integrated acceptance test plan

Prepared: 8 September 2026. Status: implementation plan; no tests or live communications were executed to prepare this document.

Updated acceptance precedence, 27 September 2026: the [complete Sharehouse workflow test](SHAREHOUSE_ACCEPTANCE_TEST.md) is the mandatory business baseline. This earlier cross-channel plan remains supporting coverage; passing it alone cannot establish product acceptance or waive a required Sharehouse case.

## 1. Outcome to prove

Run one business case from initial email through triage, a reviewed draft, SMS clarification, a phone response, and final human approval. Prove that HyperFlow preserves the correct person, project, conversation, and workflow state throughout. Run deliberate distractions and failures alongside it so that a successful-looking UI cannot hide incorrect routing or duplicate execution.

The central acceptance rule is: **one case stays coherent across channels; separate cases stay separate; only a valid response to the correct Ask advances its workflow.**

Use three distinct concepts in assertions:

- Provider email conversation: native message/thread IDs and reply headers.
- Communications semantic thread: the cross-channel `thread_id` containing the case history.
- Workflow execution: project, task, run, and optional `ask_id`. A shared thread alone does not authorize approval.

A thread marked resolved in the register, a resolved triage item, and an approved workflow Ask are separate state changes. Never use one as proof of another.

## 2. Current starting point

The local repository contains unit/integration coverage for triage projection, Ask interpretation, review loops, terminal callbacks, scheduling, and tenant checks. It also contains an HTTP/database-emulator suite and a synthetic Thread Register UI fixture. Extend these rather than building a second test framework for the same logic.

Thread Register code and related changes are currently uncommitted. Pin the exact HyperFlow and Communications revisions used for acceptance and confirm those features exist on the target deployment before testing them. This plan is based on local source inspection, not a claim about current production readiness. Communications-side semantic matching and provider behavior need verification in that service.

Connected Gmail/Outlook supports provider-native drafts. Sending workflow email uses a separately configured Communications service identity. Do not design the test around a connected-mailbox send operation.

## 3. Test environment and fixtures

Implement repeatable fixture setup and a run manifest before writing the journey tests.

| Fixture | Configuration |
|---|---|
| Run | Unique `HF-E2E-<timestamp>-<suffix>` in subjects, case references and evidence filenames. This is an assertion aid, not a substitute for trusted correlation. |
| Tenant A | Test organization with an owner/reviewer and ordinary authorized user. |
| Tenant B | Separate organization with similar project names and synthetic content to expose tenant leakage. |
| Mailboxes | Controlled mailbox A for triage; mailbox B for independent-cursor checks. Test Gmail first; repeat mailbox-specific checks for Outlook if offered in this release. |
| People | Alex has a controlled email and phone linked to one stable Communications person. Blair has different controlled identities. Include an unknown sender and an identity that has not been linked. |
| Projects | Tenant A: Daily Email Triage, `Alpha Equipment Delivery`, `Beta Maintenance`. Tenant B: another `Alpha Equipment Delivery`. Grant Alex Alpha and Beta; grant Blair only Beta. |
| Main case | `CASE-A`: approve an equipment delivery slot. Separate `CASE-B`: an unrelated invoice query from Alex in Alpha. Separate `CASE-C`: a maintenance query in Beta. |
| Facts | CASE-A proposes a slot on a chosen future business day at 10:00 Australia/Brisbane; later changes to 14:00. CASE-B invoice reference is `INV-TEST-042`. Use synthetic content only. |
| Channels | Controlled external mailbox, SMS-capable handset, voice-capable handset and provisioned service identities. Record actual recipients in the private run manifest. |
| Workflow | Prepare delivery summary → review Ask → revise if requested → approve → internal completion marker. Avoid an external side effect on the final node. |
| Policy | Draft-only mailbox behavior; explicit project/person grants; configured Ask reviewer and permitted response channels; auto-approval disabled for this fixture. |

Seed more than 100 threads and more than 20 communications in one thread for pagination tests. Seed a mailbox batch larger than the configured processing limit for recovery tests.

Before execution, verify both service revisions, schema migrations, mailbox health, provider identities, webhook authentication, callback URLs, permissions and scheduler availability. Use deterministic provider/model fixtures locally, then an isolated deployed tenant with controlled real providers.

Live email, SMS and calls require the user's explicit approval of recipients and call/message budget before the live stage. No approval is needed to implement or run isolated fixtures. Stop live execution if routing reaches an uncontrolled identity. Retain provider IDs and reconcile uncertain submissions before retrying.

## 4. Main journey: email → triage → SMS → phone → approval

Run this once manually with evidence, then automate its deterministic equivalent. Keep ordinary conversation routing and Ask response handling separately observable.

| ID | Tester action | Required result and evidence |
|---|---|---|
| J01 | Sign in to Tenant A. Create/select the triage service project through the wizard; choose mailbox A, `human_only`, drafts enabled, local timezone and a controlled digest recipient if delivery is enabled. Save and reopen. | Readiness must pass before creation; saved mailbox/policy/schedule match the choices. No duplicate service project or schedule after double click/refresh. |
| J02 | Alex emails: `HF-E2E-… CASE-A — Alpha Equipment Delivery: Please arrange delivery at 10:00 on <date>. I will confirm after checking access.` | Communications stores one inbound record with provider identity, stable person and tenant. Resolve the semantic thread and project through supported routing; if initial project linkage requires review, record that step explicitly. |
| J03 | Run triage from Service Configuration. Inspect the item and provider mailbox. | Exactly one triage item for that communication. Full relevant thread informs classification. A draft, if policy/confidence permits, acknowledges the tentative slot without claiming approval. Draft is visible in the correct provider conversation; no sent mail. Low-confidence output is reviewable rather than fabricated. |
| J04 | Reply in the original email conversation: `Correction: 14:00, not 10:00. Please wait for my final approval.` Run triage again. | Same native email conversation and same semantic CASE-A thread. Latest facts use 14:00 and remain tentative. Existing draft handling produces no duplicate draft for the same source communication on replay; stale text is updated, superseded, or clearly flagged for review. Different inbound messages may have distinct drafts under the implemented policy. |
| J05 | Create/select the Alpha acceptance workflow in the UI, using the reviewed CASE-A facts, and start it. Deliver its review Ask through a supported, explicitly thread-bound path. | One waiting Ask for the current run; downstream completion is blocked. Record its Ask ID, run/task IDs, delivery communication ID and semantic thread ID. Triage need not create a project/workflow automatically. If the supported API cannot bind the Ask to CASE-A, record a product gap rather than pretending same-project means same-thread. |
| J06 | Through the supported reply route, Alex texts about CASE-A: `Access is available at 14:00, but I am not approving the delivery yet.` | SMS is associated with Alex and CASE-A when trusted correlation or unambiguous supported matching exists. Facts can inform review, but this does not approve the Ask. If the reply is unscoped or multiple candidates exist, hold/clarify instead of guessing. |
| J07 | Alex emails CASE-B about invoice INV-TEST-042 and texts about CASE-C in Beta while CASE-A remains open. | CASE-B and CASE-C stay separate from CASE-A. No change to CASE-A slot, reviewer, Ask or completion state. Capture all three semantic IDs. |
| J08 | Run a controlled phone action bound to CASE-A and its current Ask, or use the supported inbound voice route with authorized project/case selection. Alex says: `The 14:00 slot is correct. Please add loading-dock access instructions before I approve.` | Voice context contains only authorized project facts and the correct latest slot. Human-completed call outcome and available transcript/summary attach to CASE-A. A supported Ask revision response records the requested change and initiates one revision; ordinary `call.completed` alone cannot approve the review gate. If voice cannot emit the required Ask response binding, this is a blocked acceptance requirement. |
| J09 | Inspect the revised summary in HyperFlow and approve the new current Ask by an authenticated reviewer through the web form/UI. | Summary includes 14:00 and loading-dock instructions. New review targets the revised run. Exactly one approval and one downstream completion. Prior Ask responses cannot satisfy the new run. |
| J10 | Close and reopen the browser, reopen the project, triage drawer and Thread Register, and load older history. | Email, SMS and voice records remain discoverable under CASE-A, with channel, direction, participant, time and readable content. Latest state persists. CASE-B/C remain separate. Provider conversation, semantic thread and workflow IDs reconcile in the evidence ledger. |
| J11 | Replay each captured callback and rerun triage with no new mail. | No additional communication projection, draft for the same input, Ask, revision, approval, completion or provider dispatch. Duplicate response is handled consistently. |

Main journey pass: all J01–J11 pass, with one coherent CASE-A semantic thread, separate distractor threads, correct latest facts, and exactly one final workflow completion. A manual move needed to repair an expected automatic match is recorded as an automatic-routing failure even if correction succeeds.

## 5. Branch coverage for threading and triage

Use fixed expected assignments in fixtures. Do not assert only that the resolver returned some thread. For AI-assisted output, assert factual constraints and permitted actions, not exact wording.

| ID | Variant | Pass condition |
|---|---|---|
| T01 | Native email reply; subject changed; reply headers retained. | Joins the original provider conversation where the provider supports it and the correct semantic thread. Preserve header evidence. |
| T02 | Same subject in a new email conversation from another person. | Subject alone cannot merge unrelated cases. |
| T03 | Same person, same project, two active topics; unqualified SMS `yes`. | No guessed thread or Ask approval. Clarification/review is visible. |
| T04 | Same person changes channel with explicit supported correlation, then without it. | Bound case attaches correctly. Unbound case uses authorized matching or clarification; phone-number identity alone does not select an Ask. |
| T05 | Forwarded mail, CC/reply-all, a new participant, and changed sender identity. | Preserve real participants and provenance. Do not grant project access from quoted text or a forwarded address. |
| T06 | Old closed thread receives a native reply; new unrelated topic after a long gap. | Document and pin the chosen reopen/new-thread policy before implementation. No silent loss and no arbitrary merge based only on recency. |
| T07 | Wrong assignment deliberately seeded; use Review / move to existing thread, then create a new thread in a separate case. | Only selected communication moves; reason, verified actor and history persist. No send, approval or historical workflow re-execution. |
| T08 | Reprocess a corrected communication; test a later related message. | Reprocessing respects active correction. Future-message behavior follows the documented matching/identity policy; do not assume corrections train a model. |
| T09 | Out-of-office, bounce, spam, newsletter/no-reply, quoted approval text. | Fixture-specific eligibility is enforced. Automatic content cannot approve a workflow or become trusted human memory. An explicit outbound failure is visible. |
| T10 | Repeat fixtures under `all_inbound`, `human_only`, `correlated_only`. | Assert exact included/excluded communication IDs for each policy; broad ingestion never bypasses review or tenant controls. |
| T11 | Message requiring earlier context; old proposal contradicted by latest reply; attachment reference without readable content. | Uses complete available context, follows latest correction, and does not invent attachment facts. |
| T12 | Low confidence, high risk, model failure, and instruction-like text in email. | Review/failure state is explicit; no unauthorized send, permission change or workflow advancement. |
| T13 | Two triage projects use two mailboxes; overlapping timestamps and repeated sync. | Each project/mailbox cursor advances independently; no skip or duplicate processing from another mailbox's cursor. |
| T14 | Digest includes review-held, draft and delivery-failure items. | Counts and links reconcile to persisted items. Retry does not duplicate the same digest delivery; a digest is not evidence that a draft was sent. |

## 6. HyperFlow UI acceptance

Perform the following through the actual app. The existing Thread Register fixture can cover component behavior, but cannot prove authentication, persistence or provider delivery.

| ID | Surface | Checks |
|---|---|---|
| U01 | Settings and service wizard | Connection health, stale/disconnected mailbox, missing permissions, one mailbox per triage project, timezone/time validation, save/reopen, clear recovery instructions. |
| U02 | Service Configuration | Run now, running/partial/completed/failed feedback, prior/next run, last digest, pause/resume. Manual and scheduled execution produce consistent outcomes. |
| U03 | Triage list and detail | Filters/counts, empty/loading/error states, full message, response/draft status, timeline, technical IDs, review/resolve/ignore and refresh persistence. No full content hidden behind an unusable truncation. |
| U04 | Thread Register | Open/resolved/closed/all filters, project/person filters, title/summary/status edits, candidates and correction reasons, participant display, timestamps, decision/correction history. |
| U05 | Pagination | More than 100 threads and 20 messages; navigate forwards/backwards, load older communications, change filters after paging. No missing/duplicated IDs or stale selection. |
| U06 | Project workflow and approvals | Waiting state, review artifact, revision instructions, new run after revision, rejected/expired Ask, final completion. Portfolio/Kanban/Approvals and project detail agree. |
| U07 | Network/auth failures | Expired login, denied tenant, failed save, service outage and stale data. No success toast before persistence; retry recovers without duplicates or discarded edits. |
| U08 | Usability | Desktop and narrow mobile widths, keyboard-only operation, visible focus, labelled controls, readable errors, drawer close/focus restoration, long subject/body and escaped markup. |
| U09 | Browser independence | Start waiting workflow and scheduled triage, close browser, deliver callback/tick, reopen. State advanced on the server and UI reflects it. |

## 7. Ask, delivery and recovery matrix

Parameterize the Ask-response tests across email, SMS and voice using a fresh workflow per variant.

| ID | Stimulus | Expected outcome |
|---|---|---|
| R01 | Explicit approve; explicit reject; revise with comment; ambiguous response. | Correct decision only for authorized response bound to the current Ask. Ambiguous response remains held; revision creates one new run. |
| R02 | Ordinary `communication.received` with text `approved`, sharing thread/project. | Cannot resolve an Ask. Automatic Ask handling requires the dedicated Ask-response event and explicit Ask ID. |
| R03 | Delivery accepted/sent versus delivered; call ringing versus successful human completion; voicemail/no-answer/busy/failed call. | Non-terminal delivery does not complete the action. Failed or non-human calls cannot count as successful human outcomes or approvals. |
| R04 | Signed terminal callback missing tenant/project/run/task; wrong communication ID; old run callback. | Reject/hold without completing the wrong run. Record actual response and durable processing status. |
| R05 | Identical event repeated, concurrent duplicate delivery, out-of-order statuses. | One durable application; no state regression and no duplicate external side effect. |
| R06 | Email and SMS approve simultaneously; a delayed voice reply arrives after resolution. | One accepted resolution, stable winning record and no reopened work. |
| R07 | Crash after provider accepts a dispatch but before local success save. | Reconcile by idempotency/provider record and complete the receipt without dispatching again. |
| R08 | Provider timeout, rate limit or webhook outage followed by recovery. | Visible retryable failure, bounded retry, preserved correlation and eventual single application. Permanent errors remain actionable. |
| R09 | Triage batch exceeds limit/time budget; failure mid-batch; restart; manual run races scheduled run. | Lease prevents competing execution; partial progress is durable; resume after last safe checkpoint with no skipped items or duplicate drafts/digests. Inspect cursors and processed IDs. |
| R10 | Repeat schedule tick for same occurrence; delayed/missed tick; pause/resume. | One occurrence executes under configured misfire policy. Test local-time boundaries and next-run calculation with a controlled clock. |
| R11 | Ask approved locally but Communications resolution acknowledgement fails. | Retryable acknowledgement survives restart and converges without resolving another Ask or repeating workflow completion. |
| R12 | Voice context unavailable; unknown caller; unauthorized project switch during call. | Fail closed or clarify using only allowed project names; no unrelated project content enters the call. |

## 8. Tenant and permission checks

Run each read and write with owner, authorized member, signed-out caller, and Tenant B user as applicable. Cover triage reads/updates, thread register, candidate lookup, correction, thread editing, Ask response and voice context.

- Substitute tenant/project/person/thread/communication/Ask IDs from the other tenant. Expect no disclosure or mutation; validate stored state as well as HTTP response.
- Tamper with signed callback bytes, timestamp, signature and request ID. Reject invalid/replayed-conflicting requests before side effects.
- Attempt identity-map changes without a selected person, edits to foreign projects, conflicting correction targets and forged actor IDs. Server-derived identity wins.
- An authorized thread correction must not rewrite an already executed workflow's history or implicitly replay an action. Verify both original and target workflows.
- Recordings, transcripts and attachments, where available, obey the same access boundary as the parent communication.

## 9. How to implement the suite

1. **Fixture and evidence foundation.** Build idempotent seed/cleanup helpers, fake clock, provider/model stubs, signed callback builder, run manifest and semantic-thread assertion helper. Keep cleanup scoped to the unique run/tenant. Preserve failed-run evidence before cleanup.
2. **Deterministic logic and contract tests.** Extend `triage`, `triageDigest`, `threadRegister`, `humanAsk`, `askResponses`, `communicationsWebhook`, `externalEvents`, `scheduler`, `agentRouter` and review/inbound integration tests. Add Communications-service tests for actual thread matching, correction persistence, provider IDs and identity mapping; HyperFlow's proxy tests cannot prove these.
3. **Database and HTTP journey.** Extend `tests/e2e/inbound.e2e.mjs` with J02–J11 using emulator persistence and stubbed provider responses. Exercise raw signed HTTP callbacks and restarts. Include R05–R11 and cross-tenant assertions.
4. **Browser journey.** Add a browser test runner and tests for J01/J03/J05/J09/J10 plus U01–U09. Reuse `tests/ui/thread-register.tsx` for fast fixture checks; use the real application and authenticated backend for end-to-end tests. Prefer role/label selectors and condition-based waits over fixed sleeps.
5. **Controlled deployed acceptance.** Repeat the journey against real email/SMS/voice providers after live authorization. Capture recipient receipt, provider IDs, callback application and UI state. Repeat the golden journey with fresh fixtures three times; investigate any nondeterministic routing result.

Existing commands in this repository:

```powershell
npm.cmd test
npm.cmd run lint
npm.cmd run build
npm.cmd run test:rules
npm.cmd run test:e2e
```

The last two require their documented emulator/server prerequisites; see `tests/e2e/README.md`. Run them in the isolated environment. No browser-suite command exists in the inspected package scripts; add one as part of step 4. Provider smoke scripts are separate from local tests and require inspection/configuration before use.

Suggested CI tiers: deterministic tests/lint/build on each change; emulator and browser journey before merge; full failure matrix nightly in an isolated environment; controlled live acceptance before a release affecting routing/providers. CI should never silently substitute live providers when fixtures are missing.

## 10. Evidence and completion criteria

For each test record: run ID, case ID, fixture/revision/environment, expected result, observed result, pass/fail/blocked, timestamps, screenshot or trace, and defect link. No pre-filled passes.

Maintain an evidence ledger with one row per communication:

`case | channel | direction | provider message/call ID | communication_id | native email thread ID | semantic thread_id | person_id | tenant | project | task | run | ask_id | event ID | observed status`

Use null/not-applicable where a normal inbound message has no task/run/Ask. For a workflow terminal callback, missing required correlation is a failure, not not-applicable. Keep credentials and capability tokens out of shared evidence.

Proposed acceptance budgets, to validate and agree before execution: callback ingestion reflected in the UI within 60 seconds after HyperFlow receives it; scheduled occurrence starts within one configured tick interval plus 60 seconds; small triage batch of five messages finishes within five minutes. Measure provider transit, call duration and model processing separately. On deadline, fail with evidence rather than polling indefinitely. These are test targets, not measured platform guarantees.

Release gate:

- All main journey, tenant isolation, current-Ask correlation, no-wrong-merge and no-duplicate-side-effect checks pass.
- Every mandatory matrix case is executed, or explicitly marked blocked with a release decision. A blocked provider test cannot be reported as passed.
- Zero unexplained missing/duplicate communications, unintended sends/calls, cross-tenant exposure or incorrect workflow completion.
- Full UI path persists after refresh; recovery tests converge without manual database repair.
- Real provider evidence exists for email, SMS and phone. A mock ID, HTTP acceptance or green UI alone is insufficient.
- Each defect has reproduction steps and severity. Wrong tenant/person delivery, false approval and duplicate billable dispatch block release. Incorrect threading or lost/stalled processing also block this feature's acceptance.

Recommended first implementation slice: fixture foundation → J02–J11 with deterministic providers → real UI journey → recovery/negative cases → controlled live run. This produces one useful integrated regression test early while retaining the broader acceptance gate.

## Phase 04 implementation acceptance

See [P04 evidence](implementation/P04.md) and [operational state contract](architecture/COMMITMENTS.md). Deterministic acceptance covers candidate clarification, separate agreement, renegotiation with preserved terms, submission versus fulfillment, revision, dispute, cancellation, stale/concurrent replies and identity checks. Existing workflow tests continue to prove that an earlier run's approval cannot release the current run.

SQL/HTTP integration imports historical extracted evidence without inheriting its status and rejects changed sources. Firebase emulator acceptance proves durable aggregate reviews and direct-client denial. The browser fixture proves the review journey with synthetic records; it does not replace the real-member production persistence and source-permission journey. Follow-up configuration must produce no outbound operation. No live communication is required for this phase's local gate.

## Phase 12 execution index - 9 September 2026

The cross-app suite now runs in CI against pinned Communications source and isolated databases. `tests/integration/phase12.test.ts` composes cross-channel contact resolution, a reviewed contact-linked obligation, XLSX generation/review and separate service suspension/export/resume. Earlier phase scenarios remain in the same run. This is a deterministic subset: provider triage, live reply routing and the full CEO UI journey are not inferred from emulator success. Current evidence and unresolved gates are in [P12](implementation/P12.md). Email remains draft-only, superseding older live-send scenarios.
