# Promise CRUD integration

Requires Communications Service migration 029 and its CRUD routes before release of this UI. No Firebase schema/rules change is required.

The Promise Ledger panel supports manual creation, current-term and participant editing, optional relationship ID, due-date clearing, project/thread reassignment, soft delete confirmation, condition editing and evidence attachment. Select a project to create a promise. Each write requires a reason and (except create) the displayed revision. A conflict is surfaced without retrying or discarding the user's form; refresh the promise before resubmitting.

The server derives tenant, accessible projects, privacy scope and initiator from membership. Moving a promise requires both a readable original and an accessible destination. The browser cannot assert another actor or broaden project access. The HTTP client encodes resource IDs and uses POST/PATCH/DELETE as appropriate.

Conditions never create an obligation on another person's behalf. Attaching evidence does not fulfill the promise. Pending conditions disable explicit fulfillment verification, with the same check enforced by Communications in its transaction.

A manual promise has no source communication; existing promise.changed handling uses promise ID/revision and supports this. Importing a promise as a business obligation remains a separate action. Deletion retains source evidence and history in Communications.

Validation: TypeScript (`npm run lint`), production build (`npm run build`), and `node --import tsx --test tests/promiseLedger.test.ts`.
