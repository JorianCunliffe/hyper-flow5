# RFC: Ambient Work Capture and Deferred Clarification in HyperFlow

**Status:** Design RFC; core implementation merged in [PR #56](https://github.com/JorianCunliffe/hyper-flow5/pull/56). See the [implementation guide](AMBIENT_WORK_CAPTURE_IMPLEMENTATION.md) for delivered behavior, MVP boundaries and open validation gates. The design below includes later-phase work.
**Product:** HyperFlow  
**Feature name:** Ambient Work Capture  
**Working UI name:** Side Tasks / Unresolved Items  
**Document type:** RFC / Technical Design Specification  
**Purpose:** Define the smallest HyperFlow primitive that lets useful work emerge naturally during a flow without interrupting or derailing the active flow.

---

## 1. Summary

Human conversations do not remain inside workflow boundaries.

During a Cairns Sharehouse morning run, for example, the user may suddenly say:

- “I have to go to the bank later.”
- “Remind me to check the mail.”
- “I need to meet the Edmonton buyer at 1:00.”
- “That reminds me — I need to call Peter about the drainage design.”

These statements may have nothing to do with the node currently executing. HyperFlow should not force the active flow to stop, classify the statement completely, ask several clarification questions, or switch to another project.

Instead, HyperFlow should:

1. **Capture the item immediately.**
2. **Acknowledge it briefly and continue the current flow.**
3. **Persist it outside the life of the current run.**
4. **Optionally process unresolved items through a Clarify / Review node later in the run.**
5. **If not resolved, carry them forward automatically to a later review opportunity.**
6. **During review, suggest the likely project, work type and missing information.**
7. **Ask only the minimum questions required to convert the captured item into useful structured work.**
8. **Route the resolved item into the appropriate existing HyperFlow primitive or downstream action.**

The design principle is:

> **Capture now. Clarify later. Never lose the thought, and do not punish the human for speaking naturally.**

---

## 2. Why this belongs in HyperFlow

This feature represents **business intent and unfinished work**, not communication transport.

The current HyperFlow architecture separates responsibilities between HyperFlow and the Communications Service. Communications Service owns communication identities, threads, transport and transcripts. HyperFlow owns business intent, flows, schedules, Asks, accepted commitments, artifacts and work execution.

Therefore:

- the **captured work item** should be canonical in HyperFlow;
- the originating call, SMS, email, transcript or communication can be referenced using Communications Service identifiers;
- HyperFlow should not create a second communication-memory system to support this feature.

The capture is not merely “conversation memory.” It is a durable statement that something may require action.

---

## 3. Product principle: conversational tolerance

The purpose of the feature is not primarily task management. It is to make HyperFlow tolerant of the way humans actually communicate.

A conventional workflow says:

> We are currently executing Step 4. Please discuss only Step 4.

A useful AI operating system must instead tolerate:

> “Yes, approve that draft. Oh — I just remembered I have to meet the Edmonton buyer at one. Anyway, what was next?”

HyperFlow should preserve the second statement without allowing it to hijack the first process.

This creates two simultaneous lanes:

### Primary lane
The deterministic flow currently being executed.

### Ambient capture lane
Small pieces of potentially actionable work detected during the primary lane.

The ambient lane must be **non-blocking by default**.

---

## 4. Terminology

### Captured Work Item
The canonical lightweight record created when useful out-of-flow work is detected.

This is deliberately broader than `Task`. A captured statement may eventually become:

- a task;
- a calendar event;
- a reminder;
- an Ask;
- a project action;
- a note;
- a follow-up;
- or something the user dismisses.

### Unresolved Item
A Captured Work Item that has not yet been sufficiently clarified or routed.

### Capture
The act of recording the statement with the context available at the moment it was made.

### Clarification
The later process of filling only the missing information necessary to route the item.

### Resolution
The act of converting or linking the captured item to its final HyperFlow object/action and closing the unresolved item.

### Clarify / Review Node
An optional flow node that retrieves unresolved captures and conducts the lightweight triage conversation.

---

## 5. Core behaviour

### 5.1 During any conversational node

If the user introduces actionable work that is clearly outside the immediate purpose of the current node, the agent may invoke a lightweight capture operation.

Example:

> User: “Yes, send that for review. Oh, I’ve got to meet the Edmonton buyer at 1 today.”

Agent behaviour:

> “Got it — I’ll capture that. Now, back to the Sharehouse items…”

No project-selection dialogue is required at capture time.

### 5.2 Capture should be permissive

The capture operation should store what is known and allow fields to remain unknown.

For the example above, the system might know:

- raw text: `meet the Edmonton buyer at 1 today`
- inferred title: `Meet Edmonton buyer`
- inferred type: `meeting`
- time hint: `today 13:00`
- probable project: `Edmonton ...`
- source run: Cairns Sharehouse morning run
- source communication: current voice conversation
- confidence values

It should **not** need a complete calendar-event schema before the item can be saved.

### 5.3 Continue the current flow

Capturing an item must not:

- move execution to another project;
- spawn a new interactive run immediately;
- block the current node;
- require a project match;
- require a due date;
- require the user to answer follow-up questions.

The default response should be a short acknowledgement followed by continuation of the current flow.

---

## 6. Canonical persistence

The capture must not exist only inside `FlowRun` state.

A FlowRun can record the capture for provenance, but unresolved work must survive the run that created it.

Proposed canonical collection/entity:

`captured_work_items`

Suggested minimum model:

```ts
type CapturedWorkItemStatus =
  | 'captured'
  | 'clarifying'
  | 'resolved'
  | 'dismissed';

type CapturedWorkKind =
  | 'task'
  | 'meeting'
  | 'reminder'
  | 'follow_up'
  | 'note'
  | 'unknown';

interface CapturedWorkItem {
  id: string;
  orgId: string;

  // Human/source content
  rawText: string;
  title?: string;
  kind?: CapturedWorkKind;

  // Ownership/context
  capturedForUserId?: string;
  sourceProjectId?: string;
  sourceRunId?: string;
  sourceNodeId?: string;

  // Communication provenance only; canonical communication remains external
  sourceCommunicationId?: string;
  sourceThreadId?: string;

  // Best-effort extraction, never required for capture
  proposedProjectId?: string;
  proposedProjectName?: string;
  proposedAt?: number;
  proposedDueAt?: number;
  proposedPersonIds?: string[];
  proposedLocation?: string;
  notes?: string;

  // Confidence may guide clarification but must not silently authorize action
  confidence?: {
    kind?: number;
    project?: number;
    time?: number;
  };

  status: CapturedWorkItemStatus;

  // Resolution
  resolvedProjectId?: string;
  resolvedObjectType?: string;
  resolvedObjectId?: string;
  resolutionSummary?: string;

  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
}
```

The exact storage representation should follow the existing tenant-scoped Firebase/service patterns.

---

## 7. Capture primitive

Introduce one narrow platform operation:

```text
captureWorkItem(...)
```

Its responsibility is only:

1. validate tenant/user/run context;
2. persist the item;
3. return the new capture ID;
4. optionally append a capture event/reference into the active FlowRun.

It should **not** perform a full classification workflow.

Suggested input contract:

```json
{
  "raw_text": "I've got to meet the Edmonton buyer at one today",
  "title": "Meet Edmonton buyer",
  "kind": "meeting",
  "proposed_project_id": null,
  "proposed_project_name": "Edmonton",
  "proposed_at": "best effort",
  "source_run_id": "current run",
  "source_node_id": "current node",
  "source_communication_id": "current communication"
}
```

Only `raw_text` plus tenant/context identity should be mandatory.

---

## 8. Agent behaviour at capture time

The conversational agent should receive a simple instruction:

> If the user mentions a potentially actionable item that is materially outside the current flow objective, capture it rather than pursuing it immediately. Acknowledge briefly and continue the current flow. Do not ask clarification questions unless the user explicitly asks to deal with the item now.

This is intentionally a behavioural rule rather than a sophisticated global classifier.

### Do not capture everything

The agent should not create captures for:

- casual observations;
- repeated information already represented in the current flow;
- questions the active node is already handling;
- obviously completed actions;
- conversational filler.

The first implementation can rely on model judgement. Precision can be improved later using examples and telemetry.

---

## 9. Clarify / Review Node

Add a new node type conceptually named:

`CAPTURE_REVIEW`

UI label:

**Review Unresolved Items**

Its responsibility is to retrieve unresolved captured items and resolve them one by one.

### Configuration

Keep configuration deliberately small:

```ts
interface CaptureReviewConfig {
  scope?: 'current_run' | 'current_project' | 'user_unresolved';
  maxItems?: number;
  includeOlderItems?: boolean;
}
```

Recommended default:

- `scope = user_unresolved`
- oldest unresolved items first
- bounded item count

### Node behaviour

For each unresolved item:

1. Load current project list and relevant known context.
2. Propose the most likely interpretation.
3. Identify only the fields required for the proposed destination.
4. Ask the user to confirm or correct.
5. Resolve the item.
6. Move to the next item.

Example:

> “You mentioned meeting the Edmonton buyer at 1:00 today. I think this belongs to the Edmonton project. Is that right?”

After confirmation:

> “Is that in person or online?”

If in person and location is needed:

> “Where are you meeting?”

The node should avoid repeating details the system already knows with adequate confidence.

---

## 10. Resolution schemas

Do **not** build a large universal task ontology in version one.

Use a very small set of resolution shapes.

### Simple task

Required:

- title
- project, if applicable

Optional:

- due time/date
- notes
- responsible person

### Meeting / appointment

Required before calendar execution:

- title
- date/time
- duration or default duration
- attendance mode: in-person / phone / online

Conditionally required:

- location for in-person meeting
- participant/contact if relevant

Optional:

- project
- reminder preference

### Reminder

Required:

- reminder text
- reminder time

### Note / project information

Required:

- content
- destination project or general workspace

The captured record remains the temporary envelope. Resolution-specific schemas are applied only when the item is being converted.

---

## 11. Routing after clarification

The Review node should not contain every action implementation itself.

It should produce a normalized resolved result and hand it to existing HyperFlow primitives wherever possible.

Conceptually:

```text
Captured item
   ↓
Review / Clarify
   ↓
Resolved intent
   ├── task
   ├── Ask
   ├── reminder/schedule
   ├── calendar action (when available)
   └── project note / other downstream primitive
```

This keeps the new feature aligned with HyperFlow's primitive-based architecture.

Where the required destination primitive does not yet exist, the item should remain safely resolved-to-intent or produce a normal task/Ask rather than introducing hidden execution logic.

---

## 12. Optional node, durable backlog

A flow **does not need** a Review Unresolved Items node.

If a Cairns Sharehouse run has no review node:

- captured items are still persisted;
- the active run can complete normally;
- captures remain in the unresolved register.

A later run containing a Review node can retrieve them.

This is important: the capture mechanism is platform-level, while review is flow-configurable.

---

## 13. Default “next conversation” behaviour

The system should support a normal management pattern in which the next suitable daily review or briefing run starts with unresolved items.

Example:

> “Before we start this morning’s briefing, there are three things you mentioned previously that we haven’t allocated yet. I’ve made a best guess for each. Can we run through them?”

This should be implemented through a Review node in the relevant flow/template rather than hard-coded into every conversation.

That preserves the distinction:

- platform primitive = capture and retrieve unresolved work;
- workflow behaviour = when and how the user is asked to resolve it.

---

## 14. Interrupted clarification and channel handoff

If clarification begins but the voice conversation ends, the item must not be lost.

Version one should reuse the existing Human Ask / communications capabilities rather than invent a separate messaging subsystem.

Possible later flow:

```text
Review node starts
→ voice conversation ends
→ item remains unresolved
→ existing Ask/escalation path sends the question by an allowed channel
→ response updates the Ask
→ Review node/run resumes or the item is processed in the next review
```

A future version may generate a compact form link or structured SMS interaction. That is not required for the base capture primitive.

---

## 15. UI changes

### Flow Builder

Add:

**Review Unresolved Items**

to the available node palette.

The node should expose only the small configuration set described above.

### Unresolved Items Register

Add a simple management view, either as its own panel or within the relevant project/work area.

Minimum fields:

- captured text/title;
- captured time;
- proposed project;
- proposed type;
- source run/project;
- status.

Minimum actions:

- resolve/review;
- assign project;
- dismiss.

The register is primarily for visibility and recovery, not for becoming a full task-management UI.

### Run inspection

A FlowRun should show that a capture occurred:

> `Captured side item: "Meet Edmonton buyer at 1"` → capture ID

This provides auditability without making the run the canonical owner of the item.

---

## 16. API surface

Minimum endpoints or equivalent service methods:

```text
POST   /api/captured-work-items
GET    /api/captured-work-items?status=captured
GET    /api/captured-work-items/:id
PATCH  /api/captured-work-items/:id
POST   /api/captured-work-items/:id/resolve
POST   /api/captured-work-items/:id/dismiss
```

Required properties:

- tenant isolation;
- normal authorization;
- stable IDs;
- idempotent capture where a retry could otherwise duplicate an item;
- source references preserved;
- CRUD suitable for both agent execution and UI.

The final routes should conform to HyperFlow's existing API conventions rather than introduce a parallel style.

---

## 17. Idempotency

Conversation/tool retries can create duplicates unless capture is replay-safe.

Each capture should accept or derive an idempotency key such as:

```text
orgId + sourceCommunicationId + sourceTurn/event ID + capture ordinal/hash
```

If the same capture operation is retried, HyperFlow should return the existing item rather than create another.

This matters particularly for voice/callback execution where provider outcomes may be uncertain.

---

## 18. Suggested implementation sequence

### Phase 1 — durable capture

Implement:

- `CapturedWorkItem` type;
- tenant-scoped persistence;
- create/list/get/update/dismiss operations;
- capture event/reference in FlowRun;
- idempotency;
- basic tests.

Acceptance gate:

> An agent can capture an incomplete side item during a run, complete the run, and retrieve that item later.

### Phase 2 — agent/tool integration

Implement:

- `captureWorkItem` tool/action contract;
- prompt guidance for non-blocking capture;
- communication/run provenance;
- test fixtures for voice-like conversational examples.

Acceptance gate:

> The agent captures an unrelated actionable statement, acknowledges it briefly, and continues the current conversation without clarification.

### Phase 3 — Review Unresolved Items node

Implement:

- new node type;
- builder UI;
- unresolved-item query;
- bounded sequential review;
- project suggestion;
- minimum-field clarification;
- resolve/dismiss results.

Acceptance gate:

> A later run can find a capture from an earlier run and resolve it without relying on the original FlowRun still being active.

### Phase 4 — destination routing

Initially route to primitives that already exist and are safe.

Add further adapters, such as calendar-event creation, only through explicit destination/action primitives and authority policies.

Acceptance gate:

> A clarified item results in a durable final work object/action with the captured item linked to that destination and marked resolved.

### Phase 5 — cross-channel continuation

Reuse Human Ask and Communications Service paths for unresolved clarification.

Acceptance gate:

> If a phone clarification is interrupted, the item remains durable and can be continued later or through an allowed existing Ask channel.

---

## 19. Version-one non-goals

Do not make the first implementation responsible for:

- perfect automatic classification;
- automatically reorganizing the active flow;
- automatically starting arbitrary new flows;
- a universal task ontology;
- complex semantic deduplication across every conversation;
- fully autonomous project assignment;
- hidden calendar/email execution;
- a new communication-memory store;
- a new messaging/form framework.

The first version succeeds if it does three things extremely reliably:

> **Capture it. Keep going. Bring it back later.**

---

## 20. Acceptance scenarios

### Scenario A — same-run review

1. Cairns Sharehouse run is active.
2. User says: “I need to meet the Edmonton buyer at one.”
3. Item is captured.
4. Sharehouse conversation continues.
5. End-of-run Review node retrieves the item.
6. System proposes Edmonton project.
7. User confirms project/time and provides meeting mode/location.
8. Item resolves to the configured downstream destination.

**Pass:** Main Sharehouse flow is never derailed.

### Scenario B — no Review node

1. A side item is captured.
2. Current flow has no Review node.
3. Flow completes.
4. Next day's management flow contains Review Unresolved Items.
5. Item appears there.

**Pass:** Item persists independently of the source run.

### Scenario C — interrupted call

1. Two side items are captured.
2. Review starts.
3. User has to end the call after resolving only one.
4. First is resolved.
5. Second remains unresolved.
6. It appears in the next review or approved Ask continuation.

**Pass:** No item disappears because the conversation stopped.

### Scenario D — uncertain project

1. User says: “Remind me to call Peter about the filter.”
2. HyperFlow has multiple plausible projects.
3. Capture succeeds without requiring a project.
4. Review node later presents its best suggestion and asks for confirmation.

**Pass:** Ambiguity delays routing, not capture.

### Scenario E — mistaken capture

1. Agent captures something that is not actually work.
2. Review presents it later.
3. User says “No, ignore that.”
4. Item is marked dismissed.

**Pass:** False positives are cheap and recoverable.

---

## 21. Relationship to existing HyperFlow concepts

The current codebase already contains important foundations that should be reused:

- durable `FlowRun` execution;
- `Decision`, `Loop`, `Wait` and action-node patterns;
- Human Ask / clarification concepts;
- tenant agent clarification policy;
- project and task/work concepts;
- communication provenance and external outcomes;
- bounded sequential execution patterns;
- Firebase-backed persistence/service conventions.

The feature should extend these primitives rather than create a parallel workflow engine.

A dedicated captured-work register is justified because its lifecycle crosses run boundaries and because it is intentionally incomplete at creation time.

---

## 22. Architectural decision

**Decision:** Treat ambient work as a first-class, durable HyperFlow business-intent record with an optional flow node for deferred clarification.

### Why

- It mirrors natural human communication.
- It prevents interruption of deterministic flows.
- It survives interrupted calls and completed runs.
- It avoids forcing early classification.
- It keeps flow authors in control of when clarification occurs.
- It lets future destination types evolve without changing the capture primitive.

### Rejected alternative: immediately spawn another flow

This is too disruptive and requires classification before enough information is available.

### Rejected alternative: store only in FlowRun variables

The item would be coupled to the source run and could be missed after the run completes.

### Rejected alternative: store only as conversational memory

Memory is insufficiently explicit for operational work and crosses the HyperFlow / Communications Service ownership boundary.

---

## 23. Naming recommendation

For the product capability:

**Ambient Work Capture**

For the user-facing queue:

**Unresolved Items** or **Side Tasks**

For the flow node:

**Review Unresolved Items**

For the underlying record:

**CapturedWorkItem**

This naming avoids assuming every interruption is a conventional “task.”

---

## 24. Definition of done

The feature is complete at the MVP level when:

1. actionable out-of-flow statements can be captured without blocking the current flow;
2. captures persist independently of the originating FlowRun;
3. unresolved captures can be queried by tenant/user;
4. a Review node can process them later;
5. project/type/date suggestions are advisory, not mandatory at capture time;
6. users can confirm, correct or dismiss each item;
7. resolved items are linked to their final destination;
8. interrupted review cannot lose remaining items;
9. tenant authorization and idempotency are enforced;
10. tests demonstrate same-run, later-run, interrupted-call and ambiguous-project cases.

---

## 25. Implementation-document lifecycle

This RFC should be treated as the design input, not as a Pull Request.

Recommended engineering lifecycle:

```text
Idea / conversation
        ↓
RFC / Technical Design Specification   ← this document
        ↓
Approval / design decisions
        ↓
Implementation issue(s) / work package(s)
        ↓
Code branch
        ↓
Pull Request(s)
        ↓
Review + tests
        ↓
Merge / deploy
        ↓
Implementation evidence/status record
```

If implementation reveals a lasting architectural decision that should be preserved independently, record that specific decision as an **ADR (Architecture Decision Record)**.

