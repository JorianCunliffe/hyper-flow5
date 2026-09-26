# Product API coverage status

Updated 26 September 2026. This is source and local acceptance status; deployment and live-provider acceptance are separate. The consolidated [OpenAPI](../contracts/openapi.json), [generated endpoint index](API_ENDPOINTS.md), [generated TypeScript declarations](../lib/client/schema.d.ts), and [agent guide](AGENT_API.md) replace phase fragments as the API publication entry point.

## Audit remediation

| Priority | Finding | Implemented resolution |
|---|---|---|
| P0 | API clients could approve under their human issuer's identity | Shared human-decision boundary in flow, artifact, calendar, publishing, captured-work, triage and commitment handlers. Machine clients cannot use raw workspace replacement. |
| P1 | Express/Vercel behavior drift | Express mounts the same Vercel handlers using the same rewrite table; duplicate business routes removed. Includes triage policies/resources/proposals/digests, run history and scheduler authentication. |
| P1 | Signed voice callback body consumed before verification | Raw-body routes mounted before JSON parsing. Tests accept correctly signed exact bytes and reject tampering. |
| P1 | Whole-workspace configuration lacked graph validation | Granular schema-checked resources, atomic revision-bound batches, reviewed plan hash, stable replay receipts and graph validation. Human snapshot writes also validate graph configuration. |
| P1 | No safe configuration testing | Read-only plan/validate and separately persisted fixture runs using the existing pure orchestrator; assertions, rendered inputs, results and explicit cleanup. No provider executor. |
| P1 | Alias/method scope inconsistency | Canonical rewrite-aware scopes; dedicated configuration, capability, resource, discovery and test scopes. Memory and planning POSTs use read scopes. |
| P2 | SDK threw on 204 | Empty response handling and status-preserving errors; generated contract declarations and typed call method. |
| P2 | Task editor execution omitted auth | Uses the existing authorized fetch helper. |
| P2 | Discovery/documentation drift | Authenticated schemas, primitive/task catalog and contract discovery; generated endpoint reference and CI drift gate; durable task correlation corrected. |
| P2 | Browser presentation state inaccessible | Saved view resources and authenticated `savedView` URL loading for existing navigation, project, panels, filters and zoom. |

## Product capability mapping

| Product capability | API | Boundary |
|---|---|---|
| Projects and visual graphs | `/api/projects`, `/api/nodes`, `/api/subtasks`, `/api/configuration` | Existing primitives and positions; schema validation; runtime state preserved. No arbitrary new component implementation. |
| Settings and scratch work | `/api/settings`, `/api/scratch-tasks` | Non-authority settings through configuration; integration authority uses its dedicated APIs. |
| Saved presentation | `/api/ui-views` | Existing views/panels/filters/zoom; open `/?savedView=id`. No general widget renderer. |
| Capability discovery | `/api/discovery`, `/api/openapi.json` | Tenant authenticated; reports supported contracts, not guaranteed live provider availability. |
| Fixture testing | `/api/test-runs` | Tenant/client isolated, zero provider calls, bounded synchronous results; held human/external events are explicit. |
| Organizations and invitations | `/api/organizations/create`, `/api/invites/*` | Human identity, administrator and email identity checks. |
| Service project setup | `/api/service-projects/setup-draft`, `/validate`, `/status` | Tenant/user drafts; status does not mutate schedules. Service validation may perform domain-specific checks; generic configuration validation is read-only. |
| Scheduling and classic execution | `/api/schedules`, `/run`, `/tick`, `/api/tasks/execute`, `/api/flow/advance` | Real effects require grants/policy; exact durable identities and domain reconciliation. |
| Reusable flows | `/api/flows` | Compile, version, approve, start, inspect, pause/resume/cancel, review and reconcile. Human approvals are separate. |
| Threads, memory and meetings | `/api/thread-register*`, `/api/communications/memory`, `/api/meetings` | Communications remains canonical owner; source visibility and private evidence rules apply. |
| Obligations and operational review | `/api/commitments` | Obligation actions, promise CRUD and review operations; human acceptance remains distinct from evidence. |
| Ambient capture | `/api/captured-work-items` | Capture/list/detail and human resolution; no implicit execution. |
| Cockpit/coaching | `/api/cockpit`, `/api/coaching/sessions` | Scoped views and routine state; real outcomes need provider acceptance. |
| Diary | `/api/calendar` | Grants, proposal, human approval, execution and reconciliation. |
| Artifacts and templates | `/api/artifacts` | Immutable template versions, preparation, review, generation and grant-bound export. |
| Publishing | `/api/publishing` | Configure targets, create/edit/preview, human approval, publish/reconcile; installed adapter and destination grant required. |
| Mailbox/Google integration | `/api/integrations*`, `/api/workspace/resources`, `/api/capabilities` | Provider consent and appropriate human/admin authority; API scope does not replace grants. |
| Email policy/delivery | `/api/communications/email-policy`, `/status`, `/api/send-email` | Tenant policy and project switch; connected mailboxes remain draft-only. |
| Callbacks/voice context | `/api/events`, `/api/agent/voice-context` | Signed service calls, exact raw bytes and correlation checks. |
| Files/attachments | `/api/files` | Managed upload/chunks/read/delete. Requires activated storage and billing; see [runbook](MANAGED_FILES.md). |
| Tenant operations/lifecycle | `/api/tenant` | Scoped client reads; human credential/lifecycle administration, separate database and managed-file erase receipts. |
| Operational diagnostics | `/api/operations`, `/api/operations/agent-jobs/replay` | Audited administrator diagnostics and existing replay receipts; not an unrestricted support backdoor. |

## Publication and acceptance limits

All inventoried logical method/path pairs are present in the generated contract; this measures route coverage. New configuration and test requests have explicit schemas. Legacy domain payloads and responses remain extensible in places, so generated types preserve that flexibility rather than claiming complete field-level validation. Domain guides remain part of the contract. The drift gate verifies generated artifacts and rewrite coverage; it does not infer every future operation branch automatically. New handlers/operations must update the manifest and schemas.

The unit suite and Firebase emulator acceptance exercise tenant credentials, atomic configuration, optimistic conflicts, replay, graph rejection, machine/human authority, isolated fixture execution and Express/shared-handler parity. The agent integration test is part of CI. No real provider writes are made by these tests.

Before production activation, deploy matching rules and application to both hosts, check UI saved-view rendering against persisted data, run the two-tenant acceptance against each origin and perform one explicitly authorized provider scenario. Deployed credentials, integration provisioning, storage billing, external provider privacy and delivery are not certified by local tests.

Deliberate remaining boundaries: no arbitrary React component creation; no universal live-run resource replacing domain ledgers; no separate service-account identity or per-client project allowlist; no automatic receipt retention or complete portable backup/restore guarantee. These are distinct product/platform work, not hidden configuration operations. Existing domain limits and provider prerequisites continue to apply.
