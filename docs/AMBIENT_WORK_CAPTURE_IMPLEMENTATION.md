# Ambient Work Capture — implementation and review guide

**Delivery status:** Core feature merged in [PR #56](https://github.com/JorianCunliffe/hyper-flow5/pull/56). The Communications phone adapter is implemented in both repositories; release and live acceptance must be verified separately. Start with the [README walkthrough](../README.md#ambient-work-capture-and-side-tasks), [full API reference](API.md#captured-work-items), and [operations runbook](OMNICHANNEL_OPERATIONS.md#11-ambient-capture-and-deferred-review-rollout).

This implements the core of [the RFC](HYPERFLOW_RFC_AMBIENT_WORK_CAPTURE.md): capture now, keep going, review later. The RFC is preserved as the design input; this document describes the actual implementation and rollout boundaries.

## Implemented

- Canonical Firebase records at `captured_work_items/{org}/{user}/{id}`, separate from FlowRun state. A completed, cancelled or interrupted source run does not delete its captures.
- Authenticated `captureWorkItem` operation, permissive extraction fields, immutable original wording/source references, user-scoped retrieval, version-checked edits, dismissal and confirmed resolution.
- Stable IDs derived from tenant + authenticated user + caller idempotency key. Concurrent retries transact on one record. Reusing a key with different initial content returns 409.
- Work → **Unresolved Items**, also `?view=captures`: manual capture, review, project assignment, save for later, dismissal and inspection of resolved intents. Lists are paginated; unresolved items are queried before limiting.
- **Review Unresolved Items** builder node (`capture_review`). Default: oldest unresolved items for the configured user, maximum five. Scope can be current run, current project, or all the user's unresolved work; maximum twenty.
- One Human Ask at a time, persisted in the normal run. Review asks for missing kind, project, time, meeting mode/location and final confirmation. Users can correct, dismiss or defer. A changed capture version requires fresh confirmation.
- Existing Ask response/continuation infrastructure resumes review, including alongside another waiting branch. Loop/new-occurrence reset clears review state without clearing the canonical backlog.
- Confirmed `WorkIntent` objects are persisted atomically inside their capture with a stable `resolvedObjectId`. Review outputs are available at `projectData.capture_review_results.<nodeId>`. Existing downstream primitives can consume these values explicitly.
- Firebase runtime-only rules and tenant lifecycle export/deletion coverage. Ordinary client SDK writes cannot bypass the service's validation.

## Deliberate MVP boundaries

Resolution means **confirmed intent**, not execution. A meeting intent does not book a calendar event; a reminder intent does not schedule delivery; a task intent is not automatically added to a project subtask list. Each intent has `executionStatus: not_executed`. This follows the RFC's resolved-to-intent fallback and avoids hidden execution. Add explicit downstream nodes when those effects are wanted.

Review uses the existing web Human Ask surface in this PR. Interrupted reviews are durable and can continue via web or a later review run. Automatic SMS/email continuation and voice-driven resolution are not configured by this change; no messages are sent by capture or review.

Project-name suggestions supplied during capture are advisory. Review validates project selection against tenant projects; this version does not introduce an additional model classifier. A saved proposed meeting mode/duration is reused during review. Times must be epoch milliseconds at the API or an explicit timezone-bearing ISO time in review. It does not guess an instant from “one today.” Meeting duration defaults to thirty minutes and is stated in confirmation.

Run provenance is queryable through `GET /api/captured-work-items?sourceRunId=...`, and displayed in the register. Capturing never mutates or races the source FlowRun. There is no new run-inspector panel in this PR.

Storage reads currently scan one user's register before filtering/pagination. Add indexed query/archive support if account volumes require it.

## API

Both Express and Vercel expose `/api/captured-work-items`; Vercel reuses the existing Gemini function to avoid increasing the serverless function count. The same handler enforces identity and validation on both hosts.

Authentication: Firebase ID token or an existing tenant API client bound to the intended user, with `captured-work-items:read` / `captured-work-items:write`. Body-supplied tenant/owner IDs cannot change scope. Review nodes can select another organization member as owner, and their web Asks follow the existing project/Ask access rules; this is distinct from public API queue scoping.

| Method | Input | Result |
| --- | --- | --- |
| POST | `rawText`, `idempotencyKey`, optional suggestions and source refs | Capture and acknowledgement; retry returns existing record |
| GET | `status=unresolved` (or `all`/specific status), optional `sourceRunId`, `limit`, `after` | Oldest-first `items`, `total`, `nextCursor` |
| GET | `id` | User-owned item or 404 |
| PATCH | `id`, `version`, editable suggestions | Version-checked update; status becomes clarifying |
| POST | `operation=dismiss`, `id`, `version` | Dismissal |
| POST | `operation=resolve`, `id`, `version`, `confirmed=true`, `intent` | Atomic intent + resolution link |

Example capture:

```json
{
  "rawText": "I need to meet the Edmonton buyer at one today",
  "idempotencyKey": "communication-123:turn-8:item-0",
  "kind": "meeting",
  "title": "Meet Edmonton buyer",
  "proposedProjectName": "Edmonton",
  "sourceProjectId": "sharehouse",
  "sourceRunId": "fr_current",
  "sourceNodeId": "morning_call",
  "sourceCommunicationId": "communication-123"
}
```

The project must belong to the authenticated tenant. Source run/node references require a valid run in that project. Communication/thread values are references only; communication data stays in Communications Service.

## Conversational integration

`lib/capturedWork/tool.ts` exports the function declaration and non-blocking instructions. The Express `/api/live-voice` Gemini session registers and handles `captureWorkItem`, deriving tenant/user identity from the authenticated WebSocket upgrade. Optional `projectId`, `runId`, `nodeId` query context is validated through the same API handler. A tool failure produces `saved: false`; the agent must not claim it was saved.

**Communications Service phone adapter:** `captureWorkItem` uses `POST /api/agent/capture-work` with timestamped V2 HMAC authentication. It reuses `HYPERFLOW_AGENT_CONTEXT_URL` (or `HYPERFLOW_EVENT_URL`) and `COMMUNICATIONS_WEBHOOK_SECRET`; no new credential or per-contact tool registration is needed. Inbound owner context advertises `captureEnabled`; configured outbound calls carry trusted call/thread identity into tool execution. Other providers need their own adapter.

HyperFlow maps `primaryPersonId` to `primaryUserId`, verifies current organization membership and the configured service line, and retrieves the tenant-scoped communication to verify person/thread/channel. It derives source project and workflow run/node from that record. Model arguments cannot choose a tenant, owner or source. Public receptionist callers cannot write to the owner's queue. Retries are scoped by communication ID plus the stable thought key; success is acknowledged only after persistence succeeds. A timeout means the outcome is uncertain: reuse the same key and payload rather than creating another item.

The browser Gemini live endpoint requires the Express host; Vercel does not host that WebSocket. The phone adapter uses ordinary HTTPS and works with the Vercel deployment.

## Setup and rollout

1. Deploy the updated database rules and application. Existing data needs no migration. No new paid service or environment secret is introduced.
2. Configure the tenant primary user, or set a valid organization user ID in the review node. Reviews never infer a Firebase user ID from a Communications person ID.
3. Add **Review Unresolved Items** to the desired morning/management flow. A flow without this node can still capture and finish normally.
4. Deploy Communications Service with its ambient capture adapter. Confirm the tenant `primaryPersonId`, `primaryUserId`, and phone service identity are configured. Existing signed voice-context/event connection settings are reused.
5. Run the smoke scenarios below against a test tenant and the actual provider before production rollout.

## Validation

Automated tests cover tenant/user derivation, foreign project/run rejection, scoped API routing, stable replay identity and conflicts, incomplete/ambiguous captures, same/later-run review, interrupted review, defer/dismiss, required resolution fields, stale confirmations, concurrent dismissal, empty queues, downstream output and durable review continuation.

Implementation validation on 2026-09-26: type-check and build passed; the full suite passed 746 tests, with focused capture/navigation checks repeated after the final refinements. These are local implementation results, not live acceptance evidence.

Commands:

```sh
npm run lint
npm test
npm run build
```

PR #56 passed CI including Firebase rules isolation and durable transaction checks. The production sign-in page was verified in the browser. The signed phone adapter has targeted tests for trusted ownership/provenance, rejected callers and forged sources, replay-key scoping, V2-only authentication, and truthful failure results. Authenticated queue interaction and real spoken-call acceptance still require a live signed-in session/call; these are not implied by unit-test or deployment success.

Required pre-merge/rollout smoke checks:

- Capture “meet the Edmonton buyer at one” during the Sharehouse call, hear a brief acknowledgement **after a successful tool result**, and verify the main call continues.
- Retry the same tool event concurrently and verify exactly one persisted capture.
- Finish a run without a review node, then find the capture in a subsequent management run.
- Resolve one item, interrupt review, and verify remaining items appear in the next run.
- Answer review Asks in the UI and verify the scheduler advances to the next question without manual project edits.
- Confirm that account A cannot read/write account B's captures, including within the same organization, through the public capture API.
- Verify mobile layout, capture/review/dismiss controls, and Firebase runtime rules on the deployed preview.
