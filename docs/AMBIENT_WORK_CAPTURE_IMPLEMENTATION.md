# Ambient Work Capture — implementation and review guide

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

Project-name suggestions supplied during capture are advisory. Review validates project selection against tenant projects; this version does not introduce an additional model classifier. Times must be epoch milliseconds at the API or an explicit timezone-bearing ISO time in review. It does not guess an instant from “one today.” Meeting duration defaults to thirty minutes and is stated in confirmation.

Run provenance is queryable through `GET /api/captured-work-items?sourceRunId=...`, and displayed in the register. Capturing never mutates or races the source FlowRun. There is no new run-inspector panel in this PR.

Storage reads currently scan one user's register before filtering/pagination. Add indexed query/archive support if account volumes require it.

## API

Both Express and Vercel expose `/api/captured-work-items`; Vercel reuses the existing Gemini function to avoid increasing the serverless function count. The same handler enforces identity and validation on both hosts.

Authentication: Firebase ID token or an existing tenant API client bound to the intended user, with `captured-work-items:read` / `captured-work-items:write`. Body-supplied tenant/owner IDs cannot change scope.

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

**External phone providers require configuration.** An outbound prompt cannot add a callable tool to VAPI/Bland/Communications Service by itself. Register `captureWorkItem` in the provider/Communications adapter and map it to authenticated `POST /api/captured-work-items`. Keep the tenant/user credential and run provenance in trusted adapter context, not model-controlled arguments. Use the source turn ID plus item ordinal as the idempotency key. The caller's configured account owns the capture. Do not expose a shared tenant capture credential to public receptionist callers.

This PR changes HyperFlow only. It does not claim to have registered or tested external provider tools. Existing outbound prompts give conditional guidance: only claim capture after an available tool succeeds. The browser Gemini live endpoint requires the Express host; Vercel does not host that WebSocket.

## Setup and rollout

1. Deploy the updated database rules and application. Existing data needs no migration. No new paid service or environment secret is introduced.
2. Configure the tenant primary user, or set a valid organization user ID in the review node. Reviews never infer a Firebase user ID from a Communications person ID.
3. Add **Review Unresolved Items** to the desired morning/management flow. A flow without this node can still capture and finish normally.
4. Register the capture tool with the actual phone agent before enabling in-call capture there. Use a user-bound scoped credential and trusted source context.
5. Run the smoke scenarios below against a test tenant and the actual provider before production rollout.

## Validation

Automated tests cover tenant/user derivation, foreign project/run rejection, scoped API routing, stable replay identity and conflicts, incomplete/ambiguous captures, same/later-run review, interrupted review, defer/dismiss, required resolution fields, stale confirmations, concurrent dismissal, empty queues, downstream output and durable review continuation.

Commands:

```sh
npm run lint
npm test
npm run build
```

Local browser verification was attempted, but the browser daemon failed to start and the fallback Chromium download was unavailable. Visual/authenticated UI verification, Firebase emulator or deployed-rule verification, and real phone-provider execution remain open validation gates. Unit tests use injected storage; they do not substitute for a deployed Firebase transaction test.

Required pre-merge/rollout smoke checks:

- Capture “meet the Edmonton buyer at one” during the Sharehouse call, hear a brief acknowledgement **after a successful tool result**, and verify the main call continues.
- Retry the same tool event concurrently and verify exactly one persisted capture.
- Finish a run without a review node, then find the capture in a subsequent management run.
- Resolve one item, interrupt review, and verify remaining items appear in the next run.
- Answer review Asks in the UI and verify the scheduler advances to the next question without manual project edits.
- Confirm that account A cannot read/write account B's captures, including within the same organization, through the public capture API.
- Verify mobile layout, capture/review/dismiss controls, and Firebase runtime rules on the deployed preview.
