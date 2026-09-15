# Three capability gaps — implementation brief

Three additions HyperFlow needs before an agent flow can run a timed escalation,
act on an inbound message, or use more than one Sheet tab. Each is generic;
none is specific to the scenario that surfaced them.

Written to be executed without re-deriving the analysis. Every claim below
carries the file and line it came from — check them rather than trusting this
document, because the code moves.

**Estimates assume one developer already familiar with the repo**, and include
tests and review but not deployment or live verification.

| # | Capability | Estimate | Risk |
|---|---|---|---|
| A | Resume a flow at a future time | 2–3 days | Low — copies an existing pattern |
| B | Agent-initiated outbound call on an inbound event | 4–6 days | **High** — new autonomous authority |
| C | More than one Sheet range per project | 3–4 days | Medium — 18 call sites, needs migration |

Do them in this order. A is independently useful and de-risks B.

---

## A. Resume a flow at a future time

### Problem

A scheduler tick does exactly three things (`lib/scheduler.ts:176`):

```ts
const agentJobs = await processAgentInbox(10);
const coachingRetries = await claimDueCoachingRetries(now, 10);
const due = (await listDueSchedules(now)).slice(0, 25);
```

The only mechanism that re-advances a **mid-flight** flow after a delay is
`claimDueCoachingRetries`. It is bound to coaching sessions
(`lib/coachingRetry.ts:29` requires `project_template === 'daily_coaching'`)
and it retries the *same* action. No generic flow can say "try again in ten
minutes", so any escalation — retry, fall back to a second number, give up —
is currently inexpressible.

### Design

Generalise the coaching retry machinery rather than inventing a second one. The
existing shape is proven and should be copied closely:

- **Sparse index** `flow_resume_pending/{orgId}:{projectId}:{resumeId}` carrying
  `{orgId, projectId, resumeId, availableAt, createdAt}`, mirroring
  `coaching_retry_pending` (`lib/serverStore.ts:1731`).
- **Claim by transaction with a lease.** Copy `claimDueCoachingRetries`
  (`lib/serverStore.ts:1758`) exactly: order by `availableAt`, `endAt(now)`,
  transact to `processing` with a two-minute `leaseExpiresAt`, recover stale
  `processing` rows whose lease expired, remove the index entry when the
  transaction does not commit.
- **Release on failure** mirroring `releaseCoachingRetry`
  (`lib/serverStore.ts:1796`).
- **Tick integration**: one more `claim…` call in `tickSchedules` before the due
  schedules, each claim calling `advanceServerFlow`.

A resume is requested by a node, not by configuration. Add to `ActionConfig`:

```ts
resumeAt?: number;        // epoch ms; the flow re-advances at or after this
resumeReason?: string;    // for logs and the operations view
```

When `advanceServerFlow` finishes with a node carrying a future `resumeAt`, it
writes the index row. When the resume fires, the node's `resumeAt` is cleared
before the flow advances, so a node cannot re-arm itself indefinitely.

### Guard rails

These are the ones that matter — the existing retry code has equivalents and
they are what stop a runaway loop:

- **Bound the delay**: 1 minute to 24 hours, clamped like `boundedNumber`
  (`lib/coachingRetry.ts:8`).
- **Bound total resumes per occurrence.** Reuse the occurrence scoping already
  in `coachingRetryState` (`lib/coachingRetry.ts:61-70`) — count resumes against
  `projectData.schedule_occurrence_id` so yesterday's run cannot resurrect today's.
  Cap at 10, configurable per project.
- **A resume must not start a later occurrence.** `coachingRetryMatchesProject`
  (`lib/coachingRetry.ts:39`) is the precedent; a stale resume is dropped, not run.
- **Archived or deleted project** drops the index row silently.

### Files

| File | Change |
|---|---|
| `types.ts` | `resumeAt`, `resumeReason` on `ActionConfig`; `FlowResume` record |
| `lib/flowResume.ts` | **New.** Pure: is a resume due, is it stale, clamp the delay, count against the occurrence cap |
| `lib/serverStore.ts` | `requestFlowResume`, `claimDueFlowResumes`, `releaseFlowResume` — model on lines 1731–1820 |
| `lib/scheduler.ts` | One claim loop in `tickSchedules`, mirroring the coaching block at `:183` |
| `lib/serverFlow.ts` | Write the index row after an advance leaves a `resumeAt`; clear it on resume |
| `database.rules.json` | `flow_resume_pending` — backend-only, `.indexOn: ["availableAt","orgId"]`, copying `:204` |
| `components/modals/NodeConfigModal.tsx` | "Retry after (minutes)" and "Max retries" on action nodes |

### Acceptance

1. An action node with `resumeAt` 10 minutes out is not advanced at minute 5 and is at minute 11.
2. Two concurrent ticks claim the same resume once (lease held).
3. A worker that dies mid-resume releases after the lease expires and the work completes on a later tick.
4. A resume tagged with yesterday's occurrence is dropped, not run.
5. The per-occurrence cap stops an unbounded loop.
6. A resume on an archived project is removed without error.

### Tests

`tests/flowResume.test.ts` for the pure logic; extend the existing scheduler
tests for claim/lease/stale recovery. The coaching retry tests
(`tests/coachingRetry.test.ts`) are the template.

---

## B. Agent-initiated outbound call on an inbound event

### Problem

An inbound message cannot cause an outbound call. The agent router resolves
only to `draft` or `send`:

```ts
// lib/agentRouter.ts:215-217
return profile.automaticActions?.includes('draft') ? 'draft' : 'none';
…
return profile.automaticActions?.includes('send') ? 'send' : 'none';
```

`automaticActions` includes `'call'` in the type (`types.ts:185`) but **nothing
reads it**. The one call-initiation path is the `request_coaching_call`
proposal, and it is coaching-locked at three separate layers:

1. The model may only emit three coaching proposal kinds (`lib/agentRouter.ts:182`).
2. Approval hard-fails on any other project: `project_template !== 'daily_coaching'`
   throws (`api/triage/index.ts:52`).
3. It starts the coaching flow specifically — `flowId: 'coaching'`
   (`api/triage/index.ts:62`).

All three need changing, plus a new autonomous path that bypasses approval.

### Why this is the risky one

Everything else here is plumbing. This grants an AI agent the authority to
**telephone a person without a human releasing it**, triggered by a message
from someone else. Two failure modes to design against explicitly:

- **A loop.** The agent calls the team, the team's missed-call SMS comes back
  inbound, which triggers another call.
- **Being used as a weapon.** Anyone who can text the service number can cause
  a call to a team member. Without a cap, that is a free auto-dialler.

The mitigations below are not optional polish.

### Design

Add a fourth proposal kind, `contact_team`, decoupled from coaching:

- Extend the model enum (`lib/agentRouter.ts:182`) and the parse guard (`:194`).
- Lift the coaching gate at `api/triage/index.ts:52` so a proposal executes
  against any project the person is granted, while keeping the coaching kinds
  coaching-only.
- Execution starts a correlated outbound call to a **granted Communications
  person**, never to a number taken from message content.

Autonomy is then a policy decision, read from `automaticActions`:

- `'call'` present → execute immediately, no approval, subject to every guard below.
- absent → behave exactly as today, holding a proposal for review.

### Guard rails

- **Callees come from the tenant's granted people only.** Resolve through
  `personProjectAccess` (`types.ts:175`). A phone number appearing in an
  inbound message is data, never a destination. This is the single most
  important rule here.
- **`contactWindow` is enforced** (`types.ts:171`): `startHour`, `endHour`,
  `maxPerDay`, `maxPerContact`. Outside the window the proposal is held for
  review rather than dropped.
- **Loop breaker.** An inbound message *from* a person the agent called in the
  last N minutes cannot itself trigger another call. Reuse the existing durable
  per-thread limiter (one per 15s, six per rolling hour) and add a per-person
  outbound-call ceiling.
- **Every autonomous call is logged as an external action receipt**
  (`ExternalActionReceipt`, `types.ts:109`) with the triggering
  `communication_id`, so the chain is auditable after the fact.
- **A kill switch**: removing `'call'` from `automaticActions` stops it
  immediately, with no redeploy.

### Files

| File | Change |
|---|---|
| `lib/agentRouter.ts` | `contact_team` in the enum, parse guard, and the policy branch that reads `'call'` |
| `api/triage/index.ts` | Lift the coaching-only gate; execute `contact_team`; keep coaching kinds coaching-only |
| `lib/agentCall.ts` | **New.** Resolve callee from grants, enforce window and caps, start the call, write the receipt |
| `types.ts` | `contact_team` on `AgentActionProposal.kind` (`:243`) |
| `components/triage/TriageDetailDrawer.tsx` | Render the new kind; show that it executed autonomously |
| `components/CockpitPanel.tsx` | Surface the per-person call ceiling alongside `contactWindow` |

### Acceptance

1. With `'call'` absent from `automaticActions`, behaviour is byte-identical to today.
2. With it present, an inbound "where are you?" produces a call to the granted person with no human action.
3. A phone number written in the inbound message body is never dialled.
4. Outside `contactWindow`, the call is held for review, not silently dropped.
5. `maxPerContact` is enforced across a rolling day.
6. A call triggered by an inbound message cannot trigger a further call to the same person inside the loop-breaker window.
7. Every autonomous call has a receipt naming the triggering communication.

### Tests

The adversarial ones are the point: a number in the message body, an
out-of-window trigger, a cap breach, and a two-message loop attempt. Each must
assert that **no call was started**.

---

## C. More than one Sheet range per project

### Problem

`WorkspaceResourceGrant` (`types.ts:66`) holds one `spreadsheetId` and one
`sheetRange`. The wizard offers a single "Allowed Sheet range" field
(`components/ServiceProjectWizard.tsx:190`). A project therefore reaches exactly
one tab.

Any flow needing several datasets — tasks, enquiries, a communications log —
cannot be one project. Note this is *within* a project: several projects
already share one spreadsheet with a tab each, because `saveWorkspaceResourceGrant`
(`lib/serverStore.ts:1648`) has no uniqueness constraint on `spreadsheetId`.

### Design

Add a named-range list, keeping the existing field as the default:

```ts
export interface WorkspaceResourceGrant {
  projectId: string;
  connectionId: string;
  documentId?: string;
  spreadsheetId?: string;
  sheetRange?: string;                                    // unchanged: the default
  sheetRanges?: Array<{ name: string; range: string }>;   // new, max 10
  updatedAt: number;
}
```

Action templates then select one by name:

```json
{ "range_name": "tasks", "idempotency_key": "…", "values": [["…"]] }
```

Resolution order: `range_name` when given → the matching entry; otherwise
`sheetRange`. An unknown `range_name` is an **error**, never a silent fall back
to the default — writing to the wrong tab is worse than failing.

Back-compatibility is free: every existing grant has no `sheetRanges`, so the
default path is unchanged and no migration is required.

### Files

| File | Change |
|---|---|
| `types.ts` | `sheetRanges` on `WorkspaceResourceGrant` |
| `lib/serverStore.ts` | `normalizeWorkspaceResourceGrant` (`:1621`) validates each entry with the same length and control-character checks as `sheetRange` (`:1632`); cap at 10; unique names |
| `lib/integrations/googleWorkspace.ts` | One `resolveRange(grant, name)` helper; use it at the read, append and upsert sites (`:175`, `:203`, `:260`) |
| `lib/executeTask.ts` | Pass `range_name` through for the three sheet task types |
| `components/ServiceProjectWizard.tsx` | Repeatable name+range rows |
| `components/modals/NodeConfigModal.tsx` | `range_name` in the sheet template placeholders (`:17`) |

There are **18 references** to `grant.sheetRange` / `grant.spreadsheetId` /
`grant.documentId` across `lib/`. Route them all through the one helper rather
than patching each.

### A security note worth stating

The grant is the boundary that stops one activity writing over another's tab.
Widening it to a list widens that boundary. Two rules hold the line:

- A range not in the grant is never written, regardless of what the action
  template or the model asks for.
- `parseWritableRange` (`lib/integrations/googleWorkspace.ts:236`) must run on
  every entry, so each still resolves to an explicit tab and column span.

The idempotency receipt hash (`:204`, `:262`) currently includes
`range: grant.sheetRange`. **It must include the resolved range**, or the same
`idempotency_key` against two different tabs would collide and the second write
would be silently skipped as a duplicate. This is the subtlest bug available in
this change; write the test first.

### Acceptance

1. A grant with no `sheetRanges` behaves exactly as today.
2. A node with `range_name: "tasks"` writes to the tab named `tasks`.
3. An unknown `range_name` fails the action with a clear error and writes nothing.
4. A range absent from the grant is refused even if the template names it directly.
5. The same `idempotency_key` against two different named ranges produces two writes, not one.
6. More than 10 ranges, duplicate names, or a range failing `parseWritableRange` are rejected at save.

---

## Sequencing

**A → C → B.** A is self-contained and proves the resume pattern. C is
mechanical once the receipt-hash trap is understood. B should go last: it is the
only one that grants new authority, and it benefits from A being in place.

A and C together unblock a timed escalation over several tabs with human
approval on the inbound chain — which is a working system. B upgrades that
chain to autonomous.

## Out of scope

Tracked, deliberately not included:

- Outlook junk tagging — the Communications Service has no label or move
  operation; only list, sync and create-draft exist.
- Tenant-configurable rules for what counts as non-essential mail —
  classification arrives from Communications in the event payload
  (`lib/triage/emailTriage.ts:36`).
- `upsert_google_sheet` has no `NodeType`, so no flow can contain an upsert node
  (`lib/taskTypes.ts:3` versus `types.ts:450`). Three lines, unrelated to these
  three items.
- A form for `projectData` in place of the raw JSON textarea
  (`components/modals/EditProjectModal.tsx:173`).
