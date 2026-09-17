# Commitment Ledger Design

**Status:** Detailed design proposal
**Branch:** `design/commitment-ledger`
**Base:** `main`
**Purpose:** Make promises, obligations, and owed outcomes first-class operational records in HyperFlow rather than inferred side effects of threads, tasks, or Human Asks.

---

## 1. Executive summary

HyperFlow already has the key foundations required for accountable work: canonical business threads, durable FlowRuns, Human Asks, Holds, project data, provider callbacks, named resources, communication continuity, and audit evidence. What is missing is a single first-class operational object that answers:

- What have I promised?
- What has someone else promised me?
- What is due, overdue, disputed, blocked, or awaiting acceptance?
- What source proves the promise was made?
- What changed after the original agreement?
- What evidence proves it was fulfilled?
- Which workflow is currently responsible for getting it completed?

That object is the **Commitment**.

The Commitment Ledger is the persistent operational record of promises across all channels. It is not a task list, not a CRM activity log, not a reminder table, and not a conversational summary. It sits between communication and execution.

A commitment can be created from an email, SMS, phone call, meeting transcript, user entry, imported document, or workflow decision. It remains linked to the originating business thread and the relevant people. It can then create or participate in Asks, workflows, follow-ups, reminders, approvals, and deliverables until the commitment is resolved.

The fundamental product proposition becomes:

> HyperFlow remembers what was promised, by whom, to whom, by when, and what still needs to happen. It keeps those promises attached to the conversation that created them and drives the follow-up until there is evidence they are resolved.

This is especially important for executives. Executive work is often not “perform task X.” It is maintaining a large graph of promises, dependencies, decisions, and incomplete conversations spread across channels and systems. The Commitment Ledger makes that graph explicit and queryable.

---

## 2. Product role

### 2.1 The commitment ledger is the bridge between communication and workflow

Communications Service should continue to own canonical communications, people/channel identities, thread membership, provider evidence, and cross-channel continuity.

HyperFlow should own the accepted operational meaning of work: projects, FlowRuns, Asks, commitments, deliverables, approvals, follow-up policies, and execution state.

The division is therefore:

```text
Communications Service
  -> what was said
  -> who said it
  -> where/when it was said
  -> what thread it belongs to
  -> source evidence and communication identity

HyperFlow Commitment Ledger
  -> what promise or obligation exists
  -> who owes whom
  -> what outcome is expected
  -> when it is due
  -> whether terms are accepted
  -> what workflow is pursuing it
  -> what evidence resolves it
```

This separation matters. A message saying “I will send the report Friday” is evidence. The accepted operational interpretation “Supplier owes revised report by Friday 17:00 AEST” is a commitment record. If later communication changes the date, the source evidence changes the ledger only through an explicit amendment path.

### 2.2 The ledger should be visible from both threads and contacts

Every commitment should be queryable from at least four perspectives:

1. **Thread view** — promises created within this matter.
2. **Contact view** — what this person owes us and what we owe them.
3. **Project view** — all commitments affecting this project.
4. **Executive cockpit** — what needs attention now across all projects and people.

The same record is used in each view. Do not duplicate obligations into separate thread/contact/project tables.

---

## 3. Core concepts

### 3.1 Commitment

A Commitment is an accepted or candidate statement that one party owes an outcome, action, decision, response, or deliverable to another party.

Examples:

- “I’ll send the revised quote by Thursday.”
- “We’ll have the draft contract back to you tomorrow.”
- “Can you send me the fire compliance certificates?”
- “I’ll call you after I speak to the builder.”
- “We will issue the refund within five business days.”
- “Please confirm which documents are still outstanding.”

A commitment may be bilateral or unilateral, explicit or inferred, accepted or still awaiting confirmation.

### 3.2 Obligor

The party who owes the outcome.

This may be:

- the user,
- another internal team member,
- an external person,
- an organisation,
- or, in constrained cases, a workflow/service acting under delegated authority.

### 3.3 Beneficiary

The party to whom the outcome is owed.

This can be the user, another person, a team, or an organisation.

### 3.4 Accountable owner

The internal person responsible for making sure the commitment is resolved in HyperFlow.

The accountable owner is not necessarily the obligor. For example, a supplier may owe a quote, but the user’s project manager is accountable for chasing it.

### 3.5 Deliverable

The concrete outcome that can satisfy the commitment.

A deliverable can be:

- a document,
- a reply,
- a decision,
- an appointment,
- a callback,
- a payment,
- a completed action,
- structured information,
- or another verifiable state change.

### 3.6 Ask

An Ask is a structured interaction used to obtain information, confirmation, approval, review, or a decision from a person.

An Ask is **not** the commitment itself.

A single commitment may create multiple Asks over its lifecycle:

- confirm the promise,
- clarify the due date,
- request missing information,
- review a submitted deliverable,
- approve revised terms,
- confirm completion.

The Commitment remains stable while Asks are created and resolved around it.

### 3.7 Thread

A thread is the continuing business matter in which a commitment exists. A commitment can be attached to one primary thread and optionally related to additional threads.

Closing the thread does not automatically fulfil the commitment. Fulfilment is separate operational state.

---

## 4. Domain model

### 4.1 Commitment record

Recommended canonical object:

```ts
interface Commitment {
  id: string;
  tenantId: string;

  // Context
  primaryThreadId: string | null;
  relatedThreadIds: string[];
  projectId: string | null;

  // Parties
  obligor: PartyRef;
  beneficiary: PartyRef;
  accountableOwnerId: string | null;
  authorizedAcceptorIds: string[];

  // Meaning
  title: string;
  description: string;
  commitmentType: CommitmentType;
  deliverableType: DeliverableType;
  acceptanceCriteria: AcceptanceCriterion[];

  // Time
  originalDueExpression: string | null;
  dueAt: string | null;
  dueTimezone: string | null;
  dueConfidence: "confirmed" | "interpreted" | "unknown";

  // Lifecycle
  status: CommitmentStatus;
  riskState: CommitmentRiskState;
  priority: "low" | "normal" | "high" | "critical";

  // Operational links
  linkedAskIds: string[];
  linkedFlowRunIds: string[];
  linkedTaskIds: string[];
  linkedDeliverableIds: string[];
  dependencyCommitmentIds: string[];

  // Follow-up
  followUpPolicyId: string | null;
  nextFollowUpAt: string | null;
  escalationRecipientIds: string[];

  // Evidence
  sourceRefs: EvidenceRef[];
  currentTermsEvidenceRef: EvidenceRef | null;
  submissionEvidenceRefs: EvidenceRef[];
  fulfilmentEvidenceRefs: EvidenceRef[];

  // Governance
  authority: CommitmentAuthority;
  visibility: VisibilityPolicy;

  // Audit
  createdAt: string;
  createdBy: ActorRef;
  updatedAt: string;
  revision: number;
}
```

### 4.2 Party reference

A party reference should point to canonical people or organisations without copying channel identities into the commitment record.

```ts
interface PartyRef {
  kind: "person" | "organization" | "team" | "tenant";
  id: string;
  displayNameSnapshot: string;
}
```

`displayNameSnapshot` exists for historical readability. Identity resolution remains canonical elsewhere.

### 4.3 Commitment types

Recommended initial enum:

```text
action
response
decision
deliverable
payment
meeting
callback
information
approval
follow_up
other
```

Do not overfit the type system early. The more important fields are parties, expected outcome, due time, state, evidence, and acceptance criteria.

### 4.4 Status model

Recommended lifecycle:

```text
candidate
awaiting_acceptance
accepted
in_progress
submitted
fulfilled
disputed
renegotiation
cancelled
declined
dismissed
```

Meaning:

- **candidate** — extracted or entered but not yet accepted as an operational obligation.
- **awaiting_acceptance** — proposed terms need confirmation by an authorized party.
- **accepted** — obligation exists and current terms are accepted.
- **in_progress** — work/follow-up is underway.
- **submitted** — obligor claims or provides the expected outcome; acceptance still pending if required.
- **fulfilled** — acceptance criteria have been met.
- **disputed** — parties disagree about existence, terms, responsibility, or completion.
- **renegotiation** — a change to accepted terms is proposed but not yet accepted.
- **cancelled** — an accepted commitment was explicitly cancelled under authority.
- **declined** — proposed commitment was rejected.
- **dismissed** — candidate extraction was determined not to be a real commitment.

### 4.5 Risk state

Risk should be computed from operational facts rather than stored as subjective narrative.

Recommended computed states:

```text
on_track
due_soon
overdue
blocked
awaiting_other_party
awaiting_us
awaiting_acceptance
uncertain
```

This supports cockpit views without inventing hidden “reliability scores.”

---

## 5. Event history and immutability

The current Commitment row should be a materialized current state, but the system also needs an immutable event history.

Recommended event stream:

```ts
interface CommitmentEvent {
  id: string;
  tenantId: string;
  commitmentId: string;
  sequence: number;
  eventType: CommitmentEventType;
  actor: ActorRef;
  sourceRef: EvidenceRef | null;
  previousRevision: number;
  resultingRevision: number;
  payload: Record<string, unknown>;
  createdAt: string;
}
```

Event examples:

```text
candidate_detected
candidate_created_manual
terms_proposed
terms_accepted
terms_declined
work_started
progress_recorded
submission_recorded
fulfilment_accepted
fulfilment_rejected
change_proposed
change_accepted
change_declined
commitment_cancelled
dispute_opened
dispute_resolved
follow_up_sent
ask_created
ask_answered
workflow_linked
dependency_added
evidence_attached
```

The event stream prevents silent historical rewriting.

If an accepted due date changes from Thursday to Friday, the system should not overwrite Thursday and pretend Friday was always the agreement. It should create a `change_proposed` event followed by `change_accepted` if authorized.

---

## 6. Evidence model

Every operational claim should be traceable back to source evidence.

```ts
interface EvidenceRef {
  sourceSystem: "communications" | "hyperflow" | "calendar" | "drive" | "manual" | "other";
  sourceType: "email" | "sms" | "call" | "meeting_segment" | "document" | "form" | "workflow" | "manual";
  sourceId: string;
  sourceVersion?: string;
  threadId?: string;
  quote?: string;
  observedAt: string;
}
```

Evidence rules:

1. Preserve the exact source identity.
2. Store only a short optional quote/snapshot in HyperFlow; canonical communication content remains owned by Communications Service.
3. A generated summary is not independent evidence of a promise.
4. A message saying “done” is evidence of a claim, not automatically evidence of fulfilment.
5. A draft email is not evidence that a promise to send was fulfilled.
6. A provider acceptance receipt may prove dispatch but not necessarily human acceptance of the deliverable.

---

## 7. Commitment extraction

### 7.1 Extraction should create candidates, not silently create accepted commitments

Incoming communication may contain apparent promises:

> “I’ll get that to you tomorrow.”

The extraction service should propose:

```text
obligor: speaker
beneficiary: counterparty/user
outcome: send requested item
due expression: tomorrow
candidate dueAt: interpreted using communication time and timezone
confidence: high
source: exact communication segment
```

The candidate is then handled according to policy.

### 7.2 Acceptance policy

Not every commitment needs a manual review. Introduce configurable acceptance policies:

```text
manual_review
explicit_language_auto_accept
trusted_internal_auto_accept
workflow_created_auto_accept
external_requires_confirmation
```

For a CEO assistant deployment, a sensible initial rule is:

- user’s own explicit promises: auto-accept with notification;
- trusted staff explicit promises: auto-accept if identity and wording are unambiguous;
- external party promises: auto-accept when explicit and source identity is high-confidence, otherwise candidate/review;
- inferred implications: always candidate;
- contractual/financial/new commercial commitments: require explicit approval.

### 7.3 Duplicate detection

Extraction must reconcile with existing commitments.

Example:

- Email Monday: “I’ll send the report Friday.”
- SMS Wednesday: “Report still on track for Friday.”

The SMS should enrich the existing commitment, not create a new promise.

Matching should use:

- same thread,
- same obligor/beneficiary,
- same expected deliverable,
- temporal overlap,
- semantic similarity,
- explicit references to prior promise,
- current open status.

Ambiguous matches must remain reviewable.

---

## 8. Ask integration

### 8.1 Ask is an interaction primitive; Commitment is operational state

This distinction should be explicit in code and UI.

```text
Commitment
  -> may need Ask to clarify terms
  -> may need Ask to confirm ownership
  -> may need Ask to obtain missing information
  -> may need Ask to accept a submitted deliverable
  -> may need Ask to approve changed terms
```

The Ask resolves a specific question. The Commitment remains the durable ledger record.

### 8.2 Ask examples

**Clarification**

> “You said you would send the pack tomorrow. Should I treat that as due by 5 pm Brisbane time?”

**Acceptance**

> “Paul has sent the revised filter design. Does this satisfy the commitment?”

**Renegotiation**

> “David has asked to move delivery from Thursday to Monday. Accept the new deadline?”

**Escalation**

> “The quote is now two days overdue. Chase by SMS, call, or leave it for now?”

### 8.3 Ask linkage

Add optional commitment context to Ask records:

```ts
commitmentId?: string;
commitmentPurpose?:
  | "clarify_terms"
  | "accept_terms"
  | "supply_information"
  | "review_submission"
  | "approve_change"
  | "resolve_dispute"
  | "choose_escalation";
```

Ask completion can trigger a Commitment transition, but only through validated domain logic.

---

## 9. Workflow integration

### 9.1 A Commitment should be able to spawn or attach to a FlowRun

Example:

```text
Supplier owes revised quote Thursday
    -> Wait until Thursday morning
    -> Check for delivered artifact
    -> If found, create review Ask
    -> If missing, send approved follow-up SMS
    -> Wait
    -> If still missing, call supplier
    -> Escalate to accountable owner
```

The workflow is the machinery used to resolve the Commitment. It is not the ledger itself.

### 9.2 New workflow primitives

The existing primitives may already be sufficient for many flows, but commitment-aware actions should be added so users do not manipulate raw project data.

Recommended first-class actions:

```text
CREATE_COMMITMENT
UPDATE_COMMITMENT
PROPOSE_COMMITMENT_CHANGE
ACCEPT_COMMITMENT_CHANGE
RECORD_COMMITMENT_PROGRESS
SUBMIT_COMMITMENT_EVIDENCE
ACCEPT_COMMITMENT_FULFILMENT
REJECT_COMMITMENT_FULFILMENT
CANCEL_COMMITMENT
LINK_COMMITMENT
```

These should call the Commitment domain service rather than writing records directly.

### 9.3 Holds and commitments

A workflow Hold may be waiting because of a commitment, but a Hold should not become the commitment itself.

Examples:

- Hold waits for supplier SMS reply.
- Commitment remains “supplier owes revised quote.”
- Hold resolves when any reply arrives.
- Commitment remains open unless the reply actually satisfies or changes the obligation.

This prevents the dangerous shortcut “message received = commitment fulfilled.”

---

## 10. Follow-up engine

A major value of the ledger is that follow-up becomes systematic rather than memory-based.

### 10.1 Follow-up policy

```ts
interface CommitmentFollowUpPolicy {
  id: string;
  tenantId: string;
  name: string;
  triggerOffsets: DurationSpec[];
  permittedChannels: ("sms" | "voice" | "email_draft" | "email_send")[];
  maxAttempts: number;
  escalationAfterAttempts: number | null;
  quietHoursPolicyId: string | null;
  requireApprovalForExternalContact: boolean;
}
```

Example policy:

```text
1 day before due: no external action, include in briefing
at due time: check for evidence
4 hours overdue: draft reminder / send SMS if delegated
1 day overdue: call if permitted
2 days overdue: escalate to accountable owner
```

### 10.2 Follow-up is thread-preserving

All communication should continue the existing business thread where possible. A reminder must not create a new disconnected context.

The communication event should link back to:

- commitment ID,
- FlowRun ID,
- thread ID,
- follow-up attempt number,
- policy decision.

---

## 11. Renegotiation and changed terms

This is critical for executive usefulness.

Example:

Original:

> “I’ll send it Thursday.”

Later:

> “Can I get it to you Monday instead?”

The system should represent:

```text
Current accepted due date: Thursday
Proposed due date: Monday
Status: renegotiation
Original agreement preserved
```

If the user accepts Monday:

```text
Current due date: Monday
Prior term: Thursday
Change accepted by: user
Change evidence: SMS source
Changed at: timestamp
```

If no acceptance occurs, Thursday remains the active due date and the promise can become overdue.

Never allow a model to silently “update” the deadline based on a later communication.

---

## 12. Fulfilment and acceptance criteria

A commitment should be fulfilled only when its acceptance criteria are met.

Examples:

**Send revised quote**

Criteria:

- artifact exists,
- artifact is the revised version,
- correct recipient can access it,
- authorized reviewer accepts it.

**Return phone call**

Criteria:

- outbound call attempt occurs,
- call connects or callback outcome meets policy,
- completion is recorded.

**Provide missing fire documents**

Criteria:

- required document set identified,
- documents supplied,
- recipient confirms no remaining items or configured policy accepts delivery receipt.

The system should distinguish:

```text
claimed complete
submitted
verified
accepted
fulfilled
```

This avoids collapsing “I sent it” into “the obligation is complete.”

---

## 13. Dependency model

Commitments often depend on other commitments.

Example:

```text
We owe client final contract Friday
  depends on
Lawyer owes revised draft Wednesday
  depends on
Client owes missing company details Tuesday
```

Recommended relationship table:

```ts
interface CommitmentDependency {
  id: string;
  tenantId: string;
  commitmentId: string;
  dependsOnCommitmentId: string;
  dependencyType: "blocks" | "informs" | "approval_required" | "input_required";
  createdAt: string;
}
```

The cockpit can then explain not just that an obligation is late, but **why** it is at risk.

---

## 14. Storage design

HyperFlow currently uses Firebase for substantial workflow state. The commitment ledger is relational by nature and may eventually benefit from PostgreSQL, but the first implementation should align with the current operational store unless there is already an approved canonical database migration direction.

A Firebase-compatible first pass can use:

```text
/commitments/{tenantId}/{commitmentId}
/commitmentEvents/{tenantId}/{commitmentId}/{sequence}
/commitmentIndexes/byOwner/{tenantId}/{ownerId}/{commitmentId}
/commitmentIndexes/byThread/{tenantId}/{threadId}/{commitmentId}
/commitmentIndexes/byPerson/{tenantId}/{personId}/{commitmentId}
/commitmentIndexes/byProject/{tenantId}/{projectId}/{commitmentId}
/commitmentIndexes/byDue/{tenantId}/{bucket}/{commitmentId}
```

Indexes must be projections only. The canonical commitment record and event history remain authoritative.

Longer term, if operational state moves to Postgres, recommended relational tables are:

```text
commitments
commitment_events
commitment_parties
commitment_evidence
commitment_dependencies
commitment_links
commitment_followup_policies
commitment_followup_attempts
```

Do not split the same ledger authority between Firebase and Postgres at the same time without a migration plan.

---

## 15. API design

Recommended API surface:

```text
POST   /api/commitments
GET    /api/commitments
GET    /api/commitments/:id
PATCH  /api/commitments/:id
POST   /api/commitments/:id/accept
POST   /api/commitments/:id/propose-change
POST   /api/commitments/:id/accept-change
POST   /api/commitments/:id/progress
POST   /api/commitments/:id/submit
POST   /api/commitments/:id/fulfil
POST   /api/commitments/:id/reject-submission
POST   /api/commitments/:id/cancel
GET    /api/commitments/:id/events
```

Query filters:

```text
thread_id
person_id
project_id
owner_id
obligor_id
beneficiary_id
status
due_before
due_after
overdue=true
awaiting=me|other_party
```

State-changing endpoints should be idempotent and revision-aware.

Use compare-and-swap or revision preconditions so two callbacks cannot silently overwrite each other.

---

## 16. UI design

### 16.1 Executive cockpit

Primary views:

```text
What I owe
What others owe me
Due today
Overdue
Waiting on me
Waiting on others
Recently fulfilled
Changed terms awaiting approval
Disputed
```

Each row should answer immediately:

```text
Who
What
Due when
Current state
Why it matters
Next action
Source thread
```

### 16.2 Thread view

At the top of each business thread:

```text
Open commitments
  - You owe: Send revised proposal by Friday
  - They owe: Confirm funding source by Wednesday
  - Waiting for approval: New delivery date Monday
```

The user can expand each item to see source evidence, history, Asks, workflows, and evidence.

### 16.3 Contact view

Contact page sections:

```text
They owe us
We owe them
Recently completed
Disputed / renegotiated
```

This makes the communications system feel like a high-performing executive assistant rather than just a transcript archive.

### 16.4 Ask presentation

When an Ask relates to a commitment, show the context explicitly:

```text
Promise: Peter will send revised HoA by Friday
Current due: Friday 5 pm
Source: meeting 14 Sep
Question: Peter has asked to move delivery to Monday. Accept?
```

The user should never have to reconstruct the underlying promise before answering.

---

## 17. Query and assistant experience

The assistant should support natural queries such as:

```text
What do I owe David?
What does David owe me?
What promises are overdue?
What changed this week?
Who am I waiting on?
What commitments are blocking Cairns Sharehouse?
What did I promise in yesterday’s meetings?
What has Ben promised but not delivered?
What do I need to chase today?
Show me everything due before the board meeting.
```

The answer path should query the canonical ledger first, then enrich with thread context and source evidence.

Do not answer current obligation state from semantic memory alone.

---

## 18. Notifications and briefings

The ledger should feed daily and event-driven briefings.

Example morning briefing:

```text
You owe 4 things today.
3 people owe you items due today.
2 commitments are overdue.
1 deadline change needs your approval.

Highest priority:
- Fire audit: you owe QFES two missing certificates by 3 pm.
- Cairns Sharehouse: landlord reply draft is ready; one Ask remains unanswered.
- Edge: revised HoA was due yesterday; no delivery detected.
```

Notifications should be generated from ledger state changes, not from arbitrary message keywords.

---

## 19. Permission and safety model

Commitments may contain sensitive operational context. Apply tenant and project boundaries at query time and when generating derived summaries.

Important rules:

1. A user may see a commitment only if authorized for the relevant project/thread/context.
2. A source message cannot grant authority to send, approve, spend, or bind the tenant.
3. Creating a commitment does not itself grant execution authority.
4. An external person cannot change accepted terms simply by sending a message.
5. Financial, legal, contractual, public, or new-commercial commitments can require explicit approval policy.
6. Contact channel permissions remain governed by Communications/HyperFlow capability policy.
7. Follow-up automation must obey quiet hours, recipient grants, rate limits, and project-level channel switches.

---

## 20. Relationship to knowledge and memory

The ledger is not memory in the conversational sense. It is operational truth.

Use memory/knowledge to answer:

```text
What is the background with this supplier?
What happened in the last three meetings?
Why did we choose this design?
```

Use the Commitment Ledger to answer:

```text
What do they owe us now?
What is overdue?
What have I agreed to deliver?
What deadline is currently accepted?
```

Knowledge can summarize commitments, but it must link back to the canonical record. If the commitment changes, stale summaries must not override it.

---

## 21. Cairns Sharehouse example

The Cairns Sharehouse workflow is a good integrated acceptance case.

Example sequence:

1. An enquiry arrives by email.
2. Communications assigns it to the correct business thread/contact.
3. HyperFlow triages the enquiry and drafts an Outlook response.
4. The workflow identifies missing facts needed before the draft can be finalized.
5. An Ask is created for the user.
6. The user answers by phone.
7. The same provider draft is updated in place.
8. During the call, the user says: “I’ll confirm the inspection time this afternoon.”
9. Commitment extraction creates candidate:
   - obligor: user,
   - beneficiary: prospective tenant,
   - outcome: confirm inspection time,
   - due: this afternoon,
   - source: voice call segment,
   - thread: enquiry thread.
10. Policy accepts it because it is an explicit user promise.
11. HyperFlow creates/links the appropriate follow-up FlowRun.
12. If the inspection time becomes known, the workflow updates the commitment and prepares the reply.
13. Once the reply is actually sent or the tenant is contacted through a permitted channel, completion evidence is attached.
14. The commitment is fulfilled only when its defined acceptance condition is met.

Now imagine the tenant says:

> “I’ll send my ID tonight.”

That becomes a separate commitment in the opposite direction. The thread now visibly contains both sides of the relationship:

```text
We owe tenant: inspection confirmation this afternoon
Tenant owes us: ID tonight
```

This is the core executive-assistant behavior the ledger enables.

---

## 22. Migration from current capabilities

The product model already describes commitment-ledger concepts, but they should be implemented as explicit domain objects rather than continuing to infer them from project data, Asks, tasks, or thread summaries.

Migration approach:

### Phase 1 — Domain and manual ledger

- add Commitment types and validation;
- canonical store and event history;
- create/read/update APIs;
- thread/contact/project indexes;
- manual commitment creation;
- cockpit views for “I owe” and “owed to me”;
- link Asks to commitments.

### Phase 2 — Extraction and reconciliation

- extract candidates from email/SMS/call/meeting evidence;
- duplicate/revision matching;
- review queue;
- acceptance policies;
- source-linked candidate creation.

### Phase 3 — Workflow orchestration

- commitment-aware workflow actions;
- due-date scheduler hooks;
- follow-up policies;
- escalation;
- evidence submission and acceptance.

### Phase 4 — Renegotiation and dependencies

- changed-term proposals;
- explicit acceptance/rejection;
- dependency graph;
- blocked/at-risk calculations;
- timeline/history UI.

### Phase 5 — Executive assistant layer

- daily commitment briefing;
- natural-language commitment queries;
- meeting preparation: what we owe them / what they owe us;
- proactive detection of newly overdue or contradictory obligations;
- portfolio/project reporting.

---

## 23. Testing strategy

### Unit tests

Cover:

- lifecycle transition validation;
- due-date interpretation boundaries;
- change proposal/acceptance;
- duplicate extraction reconciliation;
- authorization;
- computed risk state;
- evidence attachment;
- Ask transition handlers;
- idempotent API operations.

### Integration tests

Use Firebase emulator/current canonical store to verify:

- tenant isolation;
- revision conflicts;
- event history consistency;
- indexes cannot diverge silently from canonical record;
- Ask completion updates only the intended commitment;
- workflow callbacks cannot fulfil unrelated commitments;
- suspended tenants cannot mutate records.

### Cross-service acceptance

Pin Communications Service and test:

- incoming SMS commitment extraction;
- voice promise extraction;
- thread linkage;
- person identity linkage;
- provider evidence remains immutable;
- changed terms create amendment rather than overwrite;
- communication deletion/access revocation removes future use of evidence according to policy without silently rewriting historical operational audit.

### Real-world acceptance

Cairns Sharehouse scenario should include:

- one promise made by the user;
- one promise made by an external party;
- one changed due date;
- one Ask;
- one follow-up escalation;
- one submission requiring review;
- one fulfilled commitment;
- one overdue commitment;
- all of the above visible from thread, contact, project, and cockpit views.

---

## 24. Non-goals for first implementation

Do not initially build:

- opaque reliability scores for people;
- legal-contract interpretation engine;
- automatic contractual acceptance;
- fully autonomous financial commitments;
- universal semantic knowledge graph replacing operational records;
- nested commitments with arbitrary recursive schemas;
- a second communication store in HyperFlow;
- free-form model writes directly into commitment state.

The first version should be boringly reliable: clear parties, clear outcome, clear due time, clear state, clear source, clear history.

---

## 25. Architectural invariants

1. **A Commitment is not an Ask.** Asks are interactions that may advance commitments.
2. **A Commitment is not a task.** Tasks are execution units; commitments are obligations between parties.
3. **A Commitment is not a thread.** Threads contain context; commitments contain accountable obligations.
4. **A Commitment is not a memory summary.** Current obligation state comes from the ledger.
5. **Original accepted terms are never silently overwritten.** Changes are explicit events.
6. **Source evidence is preserved and linked.** Operational interpretation remains distinguishable from what was actually said.
7. **Receiving a reply does not imply fulfilment.** Acceptance criteria decide fulfilment.
8. **Drafting is not sending.** A draft cannot satisfy a promise to communicate unless the commitment explicitly concerns draft preparation.
9. **Provider uncertainty does not create duplicate actions.** Follow-up execution uses existing durable idempotency/reconciliation mechanisms.
10. **Automation cannot expand authority.** Commitment records drive work only within configured permissions.

---

## 26. Recommended implementation decision

Treat the Commitment Ledger as a first-class HyperFlow domain immediately, with Communications Service remaining authoritative for communication evidence and canonical thread/person identity.

Do not bury commitments inside Project Data or make them a special Ask subtype. Doing so would make them hard to query across projects, contacts, threads, and time, and would weaken the executive-assistant value proposition.

The object should be globally queryable within a tenant, permission-aware, source-linked, event-sourced for history, and directly usable by workflows.

The central relationship should be:

```text
Communication evidence
        ↓
Business Thread
        ↓
Commitment Ledger
        ↕
Human Asks
        ↕
HyperFlow execution
        ↓
Completion evidence
```

This creates the missing operational memory layer: not just remembering conversations, but remembering what those conversations require people to do next.

---

## 27. Product outcome

With this architecture, HyperFlow can act like an unusually capable executive assistant.

It does not merely summarize communications. It continuously maintains a model of accountability:

- who owes what,
- to whom,
- by when,
- under which current terms,
- in which business context,
- what has changed,
- what is blocking progress,
- what needs the executive’s decision,
- and what evidence proves the matter is actually resolved.

That is the difference between communication memory and operational memory.

And that distinction is likely one of HyperFlow’s strongest product advantages.
