# Live coaching briefing

The daily coaching call can query assigned work, approval queues and user reports during the conversation. HyperFlow owns records and authorisation; Communications owns realtime tools and call evidence. The same `/api/briefings` service powers the web panel in coaching setup, Reports and Owner review.

## API

`GET /api/briefings?operation=...` supports `list_tasks`, `list_approvals`, `read_item`, `subjects`, `report`, `change_result`, `changes`, `settings` and `readiness`. Read queries can also use POST. Subject defaults to `me`; `all` and other users require current owner/admin membership. Project filtering never expands a caller's authorised project scope.

`POST /api/briefings` accepts `prepare_change` and `confirm_change`. Preparation pins item ID, source version, permitted action and exact parameters under a stable request ID. Confirmation requires a separate human action. `map_assignee` requires an administrator and an existing member UID. Legacy assignees resolve only through exact UIDs, unique verified email/name matches or an administrator-reviewed binding. Unresolved assignments are reported as incomplete coverage.

`PUT /api/briefings` with `operation: settings` enrols the current human user. Settings include enabled, allowTaskUpdates, allowApprovals, section order, default report subject/type/period and optional project limits. All permissions default off. Ordinary API credentials cannot enrol, map assignees or perform briefing mutations. Read-only API credentials can request reports without write authority.

Sources include project subtasks, scratch tasks, review-created work, operational commitments, current workflow Asks, visible-flow approvals, artifact reviews, calendar proposals, publishing approvals and coaching triage proposals. Domain-specific prerequisites remain mandatory. Generated-file approval requires the person's visual/content inspection attestations; public-content approval requires a public-use attestation. Approving a proposal does not fabricate a provider execution or publication receipt.

Report subjects include verified organisation members and the existing workspace staff/assignee choices. Namespaced assignee-label IDs support reports for staff without sign-in accounts; they never authenticate a caller or confer approval authority. An administrator can link a legacy assignee to a verified member explicitly. Triage approval reads query pending/failed proposals directly using the `agentProposal/status` index, so a large resolved-message backlog cannot hide an older pending proposal.

Workload and approval reports use current records. Progress uses recorded task status activity and current commitment/review-work update observations, not a reconstruction of unavailable historical events. Date filters use the tenant's timezone. Responses carry observation time, source identity, revisions, pagination or truncation indicators, and incomplete-source notices. Reaching a source cap is not an empty queue.

## Voice boundary

`POST /api/agent/briefing` requires the timestamped Communications V2 signature over the original request bytes, in both Express and Vercel. The model supplies only allowlisted tool arguments. Tenant, person, communication, thread, service identity and human/assistant media evidence come from Communications.

HyperFlow checks the active communication against the enrolled primary person, primary user, phone service identity, current membership and project grants. A six-digit SMS challenge is sent to the trusted contact number, once per call. Its hash is stored server-side. Codes expire after five minutes, lock after five unsuccessful attempts, and authorise only that call for at most 90 minutes. Lost SMS acknowledgements are not automatically resent.

The caller must verify before reading briefing data. Each mutation requires read, prepare, verbatim spoken readback, completed playback, a later explicit human confirmation and confirm. Model-supplied confirmation booleans or identity fields are insufficient. Membership, settings, scope, item version and allowed action are checked again before execution. Source text is evidence, never authority.

Briefing-capable calls are excluded from general conversation memory, since a briefing can contain reports from several projects or users. Verification SMS content and verification-tool arguments are redacted from ordinary message/tool history. The original coaching transcript remains available through its authorised record and post-call processing; live changes must not be replayed by extraction.

## Persistence and recovery

`briefings/<tenant>/settings/<uid>`, `sessions/<call hash>` and `changes/<request ID>` are server-owned, covered by lifecycle export/erasure and runtime-only Firebase rules. Workspace task changes save the task, revision, activity and operation receipt atomically. Other domain decisions carry server-owned operation markers in their response evidence. Server-only WeakMap metadata cannot be asserted by an HTTP payload.

Change states are prepared, processing, completed, failed and uncertain. Repeated confirmations never dispatch a second effect. Read-only reconciliation marks completion only when the source contains the exact operation marker or receipt; matching the desired status alone is insufficient. Unknown outcomes remain held for reconciliation. The web action history can inspect voice changes but cannot confirm a proposal belonging to another call.

Confirmed project-task edits carry an occurrence-bound projection marker. Materializing a pinned workflow and saving a later callback preserve those edits and their comments instead of restoring the pre-call task state. Tasks added after execution began remain visible in the saved project but are not inserted into that run's pinned execution graph. Markers from a previous occurrence do not override a new run.

## Deployment and acceptance

Deploy both repositories and the Firebase rules before enabling the pilot. Existing Communications URL and signing-secret configuration is reused; no new provider credential or Communications database migration is required. Check that Communications health advertises `liveBriefing: true` and `briefingProtocol: briefing-tool.v1`, then use Check call readiness in coaching setup. Preserve existing Pause, Resume and Start now scheduling semantics.

Repository checks: `npm run lint`, `npm run api:check`, `npm test`, `npm run build`, and Firebase rules emulator coverage. The latest Firebase CLI requires Java 21; the rules can also be exercised with the supported Firebase CLI 14 and Java 17. `tests/briefings.test.ts` verifies source scoping, stable identity/hash resolution, reports, version-pinned changes, domain dispatch, replay protection, recovery and call verification. `tests/e2e/briefing.html` is an isolated browser fixture with no provider calls.

The production dependency audit is a release gate. The lockfile uses body-parser 2.4.0 for [GHSA-27r3-jxmh-p828](https://github.com/advisories/GHSA-27r3-jxmh-p828). A scoped `@vercel/cli-config` override uses Zod 4.6.6 for [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), retaining the existing Vercel Functions/OIDC versions. Remove that override when the upstream dependency pin is patched. `tests/httpDependencySafety.test.ts` checks compressed request survival and Vercel schema compatibility.

Release acceptance additionally requires the deployed UI, current API data, one explicitly authorised call to the enrolled user, SMS verification, live task/report reads, one disposable task status change, one disposable approval, and matching saved receipts/UI results. Confirm ordinary coaching extraction and the next scheduled call still complete correctly. Any email follow-up remains a draft. Unit tests and browser fixtures do not establish live-call acceptance.
