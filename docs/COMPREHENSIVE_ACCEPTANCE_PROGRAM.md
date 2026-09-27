# HyperFlow and Communications Acceptance Program

This is the release test program for the HyperFlow application and the Communications service. It complements `OMNICHANNEL_OPERATIONS.md` with repeatable test IDs, execution gates, and evidence requirements.

**27 September 2026 acceptance rule:** the [complete Sharehouse workflow test](SHAREHOUSE_ACCEPTANCE_TEST.md) is the mandatory business acceptance baseline. Every SH case must pass with its required evidence; no partial workflow, reduced-scope alternative or passing infrastructure checks replaces it. The channel tests below are supporting checks. Their historical values must be reconciled with the pinned builds before a new run.

## Safety and evidence rules

- Use a controlled tenant and explicitly authorized controlled recipients for live delivery. Single-person channel checks below do not replace the distinct primary/fallback/enquirer identities required by Sharehouse acceptance.
- Give every live run a unique marker: `HF-ACCEPT-<UTC timestamp>`.
- Require an explicit confirmation of the recipient phone number, email address, and marker immediately before live sends.
- Never record API keys, OAuth tokens, raw email bodies, or full call transcripts in the evidence report.
- Use a stable idempotency key for every billable action.
- Run cross-tenant and ambiguity tests with fixtures unless a second controlled tenant has been deliberately provisioned.
- A provider acceptance or Twilio `completed` status is not delivery/business-success evidence. Verify the canonical terminal event.

## Release gates

| ID | Capability | Method | Pass evidence |
| --- | --- | --- | --- |
| G-01 | HyperFlow regression suite | `npm test` in HyperFlow | All tests pass |
| G-02 | Communications regression suite | `npm test` in Communications | All self-contained tests pass; live-provider tests are reported separately |
| G-03 | Database migrations | Compare migration ledger and schema in development and production | Migrations `000`-`018` match; publish proposes no destructive SQL |
| G-04 | Callback authentication | Run `npm run smoke:callbacks` against the stable production origin | Unsigned `401`, signed `200`, replay `duplicate: true` |
| G-05 | Scheduler | Observe two consecutive five-minute ticks | Two `200` responses, unique occurrence claims, no duplicate action |
| G-06 | Deployed build | Read Communications `/health` and HyperFlow deployment metadata | Expected commit/build identifiers and healthy dependencies |
| G-07 | Complete Sharehouse workflow | Execute [SH-01 through SH-24](SHAREHOUSE_ACCEPTANCE_TEST.md) across the required layers | Every case PASS; morning, inbound, confirmation, recovery and provider evidence complete. Any FAIL, BLOCKED or NOT RUN means not accepted. |

## Automated capability matrix

| ID | Area | Required assertions |
| --- | --- | --- |
| A-01 | Tenant isolation | Reads, writes, identity lookup, thread inference, callbacks, and memory stay tenant scoped |
| A-02 | Authentication | Missing/wrong credentials fail closed; webhook signatures are exact-byte, timestamped, and replay safe |
| A-03 | SMS | Outbound contract, idempotency, provider diagnostics, inbound normalization, and terminal event mapping |
| A-04 | Email | Outbound contract, verified webhook ingestion, safe normalization, draft-only connected mailboxes, reply routing, and automatic/spam exclusion |
| A-05 | Voice | Call lifecycle, meaningful-human classification, failure dispositions, transcript isolation, and durable terminal events |
| A-06 | Hangup | `end_call` is advertised by default, deduplicated when configured explicitly, and removable only by the deployment kill switch |
| A-07 | Cross-channel thread | Exact channel thread wins; one open person thread can span SMS/email/voice; ambiguity and cross-tenant inference fail closed |
| A-08 | Memory | Search explains direct/thread-context matches; person/project/thread views preserve provenance and exclude failed calls and automated mail |
| A-09 | HyperFlow routing | Stable person grants, authorized project selection, clarification, bounded project context, and no cross-project disclosure |
| A-10 | Human Ask | One canonical Ask across channels, conservative interpretation, authenticated approval, and idempotent resolution |
| A-11 | Scheduling/recovery | Lease recovery, replay safety, retry limits, occurrence idempotency, and visible failure state |

## Controlled live run

Run these cases in order with the same marker and controlled person.

| ID | Action | Expected result |
| --- | --- | --- |
| L-01 | Send an SMS Ask containing the marker; reply from the controlled phone | Outbound and inbound Communications share one tenant, person, Ask, and semantic thread; HyperFlow shows the reply |
| L-02 | Send an email in that same Ask/thread; reply from the controlled mailbox | Email remains on the same semantic thread while retaining native email threading; reply is visible to the tenant |
| L-03 | Read the thread through Communications and the HyperFlow tenant UI/API | Chronological SMS and email are present once, with stable canonical IDs and no secret/raw webhook data |
| L-04 | Call the controlled phone and select the authorized coaching project | Voice receives only bounded authorized project context and can accurately mention the marker or prior commitment when present in that context |
| L-05 | Say a clear goodbye and ask the agent to hang up | The model invokes `end_call`; farewell audio drains; Communications closes the call; logs show the tool invocation and terminal outcome |
| L-06 | Read person, project, thread, search, and loose-end memory | Eligible human evidence is retrievable with provenance; failed/audit-only evidence is absent |
| L-07 | Replay one callback and one idempotent send | No duplicate communication, Ask resolution, schedule occurrence, event, or external write is created |
| L-08 | Ask for an unauthorized or ambiguous project | HyperFlow asks for clarification and exposes facts from neither project |

## Email-specific cases

1. Human message: eligible for triage and memory after classification.
2. Reply in an existing provider thread: retains provider and canonical thread links.
3. Automatic/no-reply message: auditable but ineligible for Ask completion and memory.
4. Spam-like message: auditable, excluded from workflow progression and memory.
5. Draft request: creates a provider-native Gmail/Outlook draft and never sends it.
6. Reconciliation replay: produces no duplicate canonical communication or triage item.

## Failure and recovery drills

| ID | Drill | Pass condition |
| --- | --- | --- |
| F-01 | Duplicate provider webhook | Same receipt/canonical communication; duplicate acknowledged |
| F-02 | Delayed HyperFlow callback | Durable retry delivers once without repeating provider action |
| F-03 | Revoked mailbox OAuth | Connection becomes visibly unhealthy; no silent message loss or send fallback |
| F-04 | Provider outage | Retryable job and diagnostic are visible; idempotency prevents duplicate billing |
| F-05 | Voicemail/no answer/wrong number | `call.failed`, correct disposition, no coaching memory or tracker write |
| F-06 | Ambiguous identity/thread | No guessed person, project, thread, or Ask |
| F-07 | Second tenant fixture | Cannot query the first tenant's mailbox, communication, thread, project, or memory |
| F-08 | Stale scheduler lease | Next tick safely reclaims once; no duplicate occurrence |

## Run record

For every run, record:

- run marker and UTC start/end;
- deployed HyperFlow and Communications revisions;
- controlled tenant, person, project, Ask, thread, communication, call, occurrence, and write-receipt IDs;
- expected versus observed result for every executed test ID;
- sanitized log timestamps for provider acceptance, inbound receipt, enrichment, callback delivery, and terminal outcome;
- defects, severity, owner, retest result, and release decision.

A release passes only when all release gates and selected live cases have direct evidence, no uncontrolled message was sent, and no cross-tenant or cross-project disclosure occurred.
