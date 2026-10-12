# HyperFlow acceptance catalogue

Version: **2026-10-11.1**. This is the catalogue and operator execution contract, not a live runner or an application dashboard. Creating it has not enabled schedules, provisioned identities or contacted anyone.

Start with the [101-case operator index](CATALOGUE.md). The canonical [machine-readable catalogue](catalogue.json) contains stable IDs, prerequisites, procedures, expected results, modes, profiles, capability mappings and evidence requirements. Copy [campaign-template.json](campaign-template.json) for each release campaign; keep the populated private manifest and sensitive evidence outside Git.

## Acceptance precedence

The existing [SH-01–SH-24 business baseline](../SHAREHOUSE_ACCEPTANCE_TEST.md) remains mandatory. This catalogue expands coverage; it does not waive or replace those assertions. Also retain the [cross-channel plan](../OMNICHANNEL_ACCEPTANCE_TEST_PLAN.md) and [acceptance programme](../COMPREHENSIVE_ACCEPTANCE_PROGRAM.md). Their dated build/migration examples are historical: pin actual deployed versions for each campaign.

The [10–11 October controlled test journal](../SHAREHOUSE_TEST_2026-10-10.md) provides historical evidence, including the fresh completed v2 run and fixed direct SMS correlation. It is not blanket acceptance for this campaign. All new cases begin **NOT RUN**. Import a historical result only after checking the exact scenario, deployment, configuration and required evidence; preserve its original date and any recovery.

If an old fixture conflicts with current business configuration, record an explicit fixture variant and approve its configuration before testing. For example, a historical capacity-two fixture is not a new production group limit. Current Sharehouse defaults are 15-minute inspections, five-minute travel gaps, Brisbane dates, Martyn Street preferably 16:00 and other properties around 15:30, subject to staff availability and diary state. Synthetic answers such as 22 minutes must not update those defaults.

## Set up a campaign

1. Assign a unique campaign ID, operator, target environment and exact HyperFlow/Communications deployed commits. Snapshot discovery, task contracts, policy/workflow revisions and rules/migration readiness. Do not store secrets.
2. Resolve each profile's real resource and recipient references through supported APIs/setup forms. Keep them in the private manifest. Missing test identities, connections or permissions mean **BLOCKED**, not guessed identifiers.
3. Record the approved recipient list, call/SMS/cost caps, live window, reconciliation deadlines, Ask expiry and escalation limits. No arbitrary default spending allowance is supplied. Existing Jorian-only authorization does not authorize extra people or public activation.
4. Create paused test workflows with the existing primitives and setup files. Use normal reviewed configuration APIs/manual editors; do not inject successful values into live runtime records. Save fixture version and reset/cleanup instructions with each workflow.
5. Start with fixtures, then browser setup checks, then approved live cases. Explicitly approve any controlled schedule before enabling it. Stop if deployed fingerprints change; assess impacted results before continuing.

The existing controlled project can support Jorian-only cases. It cannot prove multi-person separation, unknown caller behavior, another receiving line or tenant isolation by itself. Those profiles remain BLOCKED until provisioned. Outlook and Gmail each require their own results. Actual email sending uses the separate `email-send` profile and remains blocked without specific authorization; Sharehouse email stays draft-only.

## Execution waves and dependencies

| Wave | Cases | Exit condition |
| --- | --- | --- |
| 0: inventory/readiness | BASE; configuration fixtures | Builds, resources and permissions pinned; no unexplained readiness failure |
| 1: deterministic coverage | ACT-*-NEG, CTL, SEC, REC, scheduler/policy fixtures | Expected failure, isolation, idempotency and concurrency assertions pass |
| 2: controlled component runs | ACT live, ASK, MAIL, ROUTE, POL, BOOK, MEET | Required provider variants and owning state transitions verified |
| 3: complete journeys | JRN-01–05 plus all SH-01–24 requirements | Three consecutive clean JRN-01 runs and all other mandatory journey variants pass |
| 4: operational soak | SCH live and SOAK-01 | Seven days within approved caps; every occurrence reconciled; no unexplained pending work |

Within a case, execute every scenario named in its procedure. Record a separate result for each required mode and variant, including Outlook/Gmail, each call disposition, each policy mode, each timezone boundary and before/after-commit timeout. A fixture pass does not count as live success. Use the same declared inputs for expected results before starting; do not rewrite expectations to match output.

The first volume budget proposal is 10–15 calls, 20–30 SMS exchanges and 10 email threads over several sessions. It is a planning estimate, not authorization or a release criterion. Additional identities, recipient-specific caps and the seven-day schedule must be reviewed before dispatch. Required coverage may need more volume; stop at the approved cap and record remaining work as BLOCKED.

## Evidence and results

Each result identifies case/variant/mode, catalogue version, pinned builds, workflow/policy revision, operator, timestamps, expected and observed assertions, defect links, recovery and cleanup. Campaign-level values may be inherited only while unchanged. Attach sanitized receipt references for project, occurrence, run, node, Ask, source communication, semantic/provider thread and operation where relevant.

- **PASS:** every assertion and required evidence item for this specific variant is satisfied.
- **FAIL:** observed behavior violates an assertion. Record the defect and reproduction inputs.
- **BLOCKED:** prerequisite, authority, provider or human participation is unavailable; explain exactly what is missing.
- **NOT RUN:** no qualifying execution/evidence yet. Missing ledger entries count as NOT RUN.

Keep `recoveryUsed` explicit. A designed retry journey can pass its recovery assertions. A happy-path result needing administrative state repair cannot count toward the three consecutive clean runs. Retests append a new result; never erase the original failure. A new build invalidates affected coverage until reviewed and rerun.

Required effect evidence:

| Effect | Evidence required beyond acceptance |
| --- | --- |
| SMS/email send | Correct controlled destination plus terminal delivery/bounce/failure receipt; send acceptance is not delivery |
| Call | Disposition, eligible confirmed answers and owning Ask progression; phone connection alone is insufficient |
| Mailbox draft | Same original provider ID on update, trusted version/change key, draft-only status, no send |
| Diary/resource write | Stable operation/business key, write receipt, fresh matching readback and duplicate count |
| Enquiry/commitment | Acknowledged persistence, correct project/source, review authority and explicit unresolved obligations |
| Workflow | Authoritative terminal state, correct active/inactive branches, owning receipts and matching UI after reload |

Do not publish keys, OAuth tokens, response-form secrets, full personal transcripts or raw email bodies. Keep sensitive original evidence in its owning service; the ledger links to authorized records and uses redacted summaries.

## Fault injection and cleanup

Inject provider timeouts, model quota errors, lost responses, concurrent callbacks and worker restarts only into isolated fixtures/deployments. Never drain real Twilio credits, revoke production OAuth or interrupt production calls to manufacture failures. For an actual uncertain effect, reconcile its original receipt before any retry; never replay under a new ID.

Stop live execution on unauthorized contact, cross-tenant exposure, duplicate effects, lost ownership, cap exhaustion or unavailable critical readiness. Preserve evidence and disable only the campaign's schedules through supported controls. Cancellation of a run does not undo a provider effect.

At campaign end, disable test schedules, reconcile in-flight work, expire temporary contact exceptions, and review outstanding test requests/bookings. Remove or label only the campaign's own fixtures through supported reversible operations; retain the evidence ledger. Never delete shared or unrelated provider data as cleanup.

## Release decision

Every release-required case and variant in this catalogue, and every mandatory SH case, must pass with current evidence. Any FAIL, BLOCKED or NOT RUN keeps the overall result **NOT ACCEPTED**. Require three consecutive clean complete reference journeys, verified security boundaries, no duplicated effects, bounded unresolved-operation outcomes and completed soak evidence. Public reception and production schedule activation remain separate reviewed actions after acceptance.

This is a finite risk-based catalogue, not a claim that every possible input has been tested. Add cases for defects and new capabilities. Keep all historical failures visible.

## Maintain and validate

```powershell
npm.cmd run test:catalogue
# After editing the canonical JSON:
npm.cmd run test:catalogue -- --render
```

The offline checker compares coverage with `TASK_TYPES`, action/node mappings, `NodeType` and task contracts, validates IDs/dependencies/profiles, and detects stale generated documentation. It makes **zero provider calls**. Adding a primitive without catalogue coverage fails this check. Run it during release preparation alongside existing tests; this change does not install a live runner or change CI automatically.
