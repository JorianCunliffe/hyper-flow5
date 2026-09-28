# Autonomous acceptance and regression work — 28 September 2026

## Scope and live evidence

User authorized autonomous testing and repair while unavailable. Existing live authority remains limited to the specified team identities; emails remain draft-only. The Morning Run schedule remains paused. Complete SH-01–SH-24 acceptance is still **NOT ACCEPTED**.

The deployed **Recover existing draft** action successfully linked the existing accommodation enquiry to its Outlook draft. The native preview loaded the current provider body and continued to load after a full browser reload. The draft is the existing project-clarification reply, not a completed accommodation answer. No agent replay, replacement draft, email send, call, SMS or Sheet write was triggered by this recovery. The routing/configuration blockers remain separate.

## Repairs

- CI's cross-service jobs were pinned to obsolete Communications revisions and referenced removed `mailboxDraftUpdate.js` / `mailboxDraftUpdate.test.js` files. Pin both jobs to deployed Communications revision `1a456f7b9b47e4c357dc7279303bf63c19a80ce6`, run the current mailbox service/creation tests, and check the current shared provider-identity validation.
- Human Wait finalisation previously copied only the last response's values into its payload. It now carries the combined accepted values and attachments, preserving earlier voice/SMS answers across continuation.
- Provisional responses awaiting interpretation previously contributed values to `collectValues`, allowing an unreviewed field to count toward completion or overwrite an accepted field. Shared collection now excludes provisional values and attachments.
- Live browser testing found that the Responses selector included excluded messages, failed attempts and review-only emails despite counting only prepared drafts and linked responses. Its filter now uses the same two categories as its count. Lint and production build passed after this UI correction.

## Added coverage

- Real Firebase emulator: cold-cache triage updates, four concurrent draft recovery attempts, exactly one recovery audit record, conflicting linkage rejection, missing-record preservation and denied direct browser writes.
- Human answers: provisional fields cannot complete the Ask, accepted values survive later unreviewed suggestions, combined voice/SMS responses reach the hold payload, unrelated/open Asks cannot release the hold, and provisional attachments remain excluded.
- Connected Sharehouse morning graph: five task operations, four distinct drafts, partial-answer hold, durable serializer round-trip, same-draft updates, four enquiry allocations, one shared inspection slot, two eligible SMS effects after business writes, and no repeated effects on replay. Planning and provider outcomes are synthetic; this does not prove real classification, provider delivery, calls, scheduling or the other recovery cases.

## Verification

Initial baseline: 806 HyperFlow tests and 409 Communications tests passed. Final post-repair verification: **810 HyperFlow tests, 20 cross-service/Firebase integration tests, 409 Communications tests, and 30 database-rule checks passed**, with zero skips in the test suites. Lint, API reference validation and production build passed. Both production dependency audits reported zero vulnerabilities. The expanded integration run initially found the stale mailbox contract; it passes after updating the deployed-revision pin and current contract assertions.

Java 21 was installed in a local test-runtime directory from the official Adoptium distribution, with archive checksum verification, to run the Firebase emulator. Production database configuration was not changed.

## Remaining acceptance work

The live enquiry is not yet routed into Morning Run. Its existing clarification draft must be preserved when progressing. The live graph still needs complete finalisation bindings, draft-update wiring and appropriate provider/contact checks. Real Gmail recovery, full team-answer/callback paths, provider failures and SH-01–SH-24 require further evidence. No synthetic fixture result or green deployment changes the overall acceptance result.
