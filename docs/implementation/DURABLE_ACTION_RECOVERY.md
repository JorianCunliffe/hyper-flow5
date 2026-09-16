# Durable action recovery

Implements the [scheduled coaching reliability goal](https://chatgpt.com/share/6aaa4f06-84a0-83ec-ae08-689b1367f38f).

## Execution invariant

A scheduler occurrence retains its deterministic FlowRun. Each node attempt has
an operation ID derived from that run, the node ID and the persisted attempt
history. Orchestration checkpoints routing/input state before execution. The
server commits an `action_dispatches/{org}/{operation}` claim, then atomically
acquires dispatch ownership, before it invokes the adapter. The operation holds
the frozen input, provider request, response, external ID and terminal events.
Infrastructure errors propagate as recovery errors, never as graph outcomes that
could enter a business retry loop.

Operation states are `claimed`, `dispatching`, `dispatched` and `resolved`.
A `claimed` operation is safe to acquire because dispatch has not been authorized.
A `dispatching` operation may have reached the provider. Only adapters with a
durable idempotency contract may repeat that request after the two-minute lease.
The repeated provider request uses the original body and key, even if background
conversation context has changed. A saved response is replayed without invoking
the adapter again.

Communications provides `reserve_outbound_operation` and records provider IDs and
responses in `outbound_operations`. Its reservation must not be deleted or expired
while HyperFlow may replay the operation. A reservation stuck before its provider
receipt requires Communications-side reconciliation; HyperFlow does not bypass
it or generate a new key. This is an effectively-once boundary, not a distributed
transaction with Twilio or an arbitrary HTTP endpoint.

## Recovery and callbacks

Schedule runs distinguish `running`, `partial`, `waiting`, `recoverable`,
`completed` and `failed`. Waiting occurrences stay eligible for reconciliation;
they are not marked complete because the first scheduler request returned.
Misfire skipping applies only to an occurrence that has never been claimed.

Callbacks resolve the operation by tenant and operation ID, or by a scoped
external-ID lookup, then locate the authoritative FlowRun. The callback may arrive
before the provider response or the action's FlowRun checkpoint. Its terminal
result is committed to the operation first and can reconstruct the action state.
Processed event IDs are retained in both the inbox and the operation. Successfully
processed duplicates return 200. An active inbox lease returns retryable 503 so
a crash cannot cause an unprocessed event to be acknowledged permanently.
Inbox completion is fenced by the processing claim ID.

Verified success takes precedence over failure for the same operation. A later
failure cannot reverse success. If success follows failure, stale decision/retry
routing is invalidated. Completed attempts are not redispatched. Compare-and-swap
conflicts reread and reconcile the latest FlowRun, bounded to five attempts.
Cancelled runs retain callback receipts without advancing the graph.

## Coaching semantics

`conversation_completed: true`, or an explicit successful human interaction,
overrides a normal provider hangup. Hangup alone is not retryable. No-answer,
busy, voicemail/no interaction and provider failures retain the explicit
Decision → Wait → Loop path. `LoopConfig.maxDurationMinutes` bounds retries from
the persisted FlowRun start; the attempt limit and delay remain graph primitives.
Existing generated coaching graphs receive the safe retry conditions when
materialized. New graphs include the window directly.

## External-effect audit

| Boundary | Replay protection / recovery |
| --- | --- |
| FlowRun voice, SMS and email | Durable action claim plus frozen Communications request and provider idempotency key |
| Manual `/api/tasks/execute` (Express and Vercel) | Same durable executor; callers must reuse their run ID for retries |
| Raised Ask deliveries | Stable per-Ask/person/channel identity, delivery token and durable dispatch; open undelivered Asks are reconciled |
| Arbitrary webhook | Durable pre-dispatch claim; an uncertain result blocks automatic redispatch because arbitrary targets cannot promise idempotency |
| Google Sheet append/upsert | Outer action claim plus existing external-action receipts; uncertain writes remain held for reconciliation |
| Calendar writes | Existing calendar ledger/proposal approvals and provider operation identity; not dispatched by the generic action-node task map |
| Visible flows | Existing durable step claim plus the shared server executor for communication actions; existing receipt/review lifecycle remains authoritative |
| Direct notification email endpoint | Existing stable Communications idempotency key; not a scheduled FlowRun dispatch path |
| Email triage | Outer node dispatch claim plus existing triage cursors, draft receipts and provider keys; ambiguous whole-node completion is held rather than blindly repeated |

## Permissions and rollout

Main already includes the restricted runtime grants for FlowRun/hold state and
absent-index cleanup from PRs #44–45. This change adds the same tenant-lifecycle
restricted authority for `action_dispatches`, with query indexes. Browser clients,
tenant members, forged runtime UIDs without the claim, and suspended tenants may
not write these records. No unrestricted Admin bypass is introduced.

1. Apply `database.rules.json` to the database used by the preview before running
   it. Vercel code deployment alone does not deploy Firebase rules.
2. Confirm the deployed Communications version supports durable outbound
   reservations and retains keys/results. Cross-service CI pins its version.
3. New FlowRuns carry `dispatchVersion: 1`. Older occurrences are held before any
   new external write. Review provider records for the incident occurrence before
   cancelling it or explicitly migrating its state. Do not reset it or delete its
   operation/provider reservation to unblock it.
4. Use an explicitly selected test number and preview callback URL. Trigger one
   occurrence, capture its FlowRun/operation/communication IDs, replay the same
   occurrence and terminal webhook, and verify one communication per attempt.
5. Check logs for unexpected permission denials, unreconciled operations, callback
   5xx responses and exhausted CAS retries before promoting the change.

For an uncertain non-idempotent write, inspect the downstream system and record
the verified receipt/terminal result against the original operation. If the
effect cannot be proved absent, retain the hold. A new operation is not a recovery
mechanism. There is no automatic operator reconciliation UI in this change.

## Automated evidence

- `tests/actionDispatch.test.ts`: persistence failure after dispatch, concurrent
  claims, both crash boundaries, frozen provider requests, failure/success ordering,
  event replay, callback reconstruction, distinct attempts, legacy quarantine,
  semantic hangup completion, retry delay, attempt ceiling and retry window.
- `tests/integration/action-recovery.test.ts`: actual restricted-runtime Firebase
  transactions, concurrent schedule invocations, one FlowRun/one HTTP call, stale
  project projection, racing terminal callbacks, duplicate events and occurrence
  replay; runtime/client/suspended-tenant access controls.
- `tests/integration/scheduler-runtime.test.ts`: real scheduler/hold persistence,
  serialization, cold-worker CAS and production-style rules.
- Existing unit, integration and pinned Communications suites remain release gates.

Live rules deployment, real-number preview testing and production-log verification
are separate operational gates; emulator and fake-provider tests do not establish
that those live gates have been completed.

Validation on 16 September 2026: 645 HyperFlow unit tests passed; all 18 integration
tests passed against the database emulator and Communications commit
`660ec39d670d14827ce60283267dcbf3bba8f6ee`; 271 tests from that pinned Communications
checkout passed. The final callback-correlation adjustment also passed its 38-test
focused suite. Type checking and the production build passed. Local Firebase
tests used CLI 14.22.0 with Java 17; CI uses Java 21. No real telephone call was made.
