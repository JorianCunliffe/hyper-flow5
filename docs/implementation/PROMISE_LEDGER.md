# Promise ledger consumer

Implemented 2026-09-18 with Communications migration 028. See the companion [implementation and rollout note](../../../ChatGPT/communications-service/docs/implementation/PROMISE_LEDGER.md).

The Obligations page now includes the Communications-owned promise ledger. “We” is displayed as one joint promise with both participants. Source quotes, speaker attribution, change history, unresolved parties, person/thread filters, owed/owing views and extraction coverage are available. Reviewers can resolve participant identities, confirm deadlines and correct source project/thread associations. These actions require a reason and current revision.

`/api/commitments` routes authenticated `action:promise_ledger` requests through `lib/commitments/promiseLedger.ts`. Browser-supplied tenant, private-evidence grants, allowed project lists and reviewer identities are not trusted. Unassigned evidence is restricted to the server-configured primary person. Source association corrections validate both accessible source and destination project.

Importing a promise creates or refreshes a candidate using a stable Communications ID and ledger revision. The candidate retains joint source-party IDs. Accepted terms and the operational owner/beneficiary continue through the existing explicit review lifecycle. A Communications status does not fulfill an operational obligation.

Signed `promise.changed` events update source-change warnings idempotently by promise revision; out-of-order events cannot roll them back. They do not enter event-triggered flows. Accepted-obligation reads reconcile ledger revisions as recovery for missed events.

The Communications release must precede this consumer. Extraction starts only after enabling a pilot policy; its recommended initial configuration is one project, shadow mode and an explicit canonical local person. Backfill uses bounded batches and suppresses live events. Production deployment and real-data evaluation were not performed in this implementation task.

Verification includes the full HyperFlow suite, TypeScript checking, a production build, Communications unit/database suites and a browser fixture of the actual ledger component. The build retains the existing large-bundle warning. The browser fixture performs no live API/provider/Firebase writes.

Final local results: HyperFlow **675/675** tests; Communications unit **310/310**; Communications database **62/62**. `npm run lint`, `npm run build` and both repository diff whitespace checks passed. The actual ledger component rendered at desktop and 390 px mobile width without horizontal overflow or browser errors. Browser interaction verified joint-party detail, confirmation with a reason, coverage and the business-review callback.
