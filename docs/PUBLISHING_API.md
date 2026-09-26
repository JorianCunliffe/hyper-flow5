# Publishing API

Owner: HyperFlow. Communications and its existing memory are unchanged. `/api/publishing` uses Firebase bearer or tenant API-client authentication (`publishing:read` / `publishing:write`), current organization membership and an accessible projectId. Approval/rejection requires a Firebase human session; machine clients cannot impersonate their human issuer. Express and Vercel share the handler. Responses omit Ask tokens; direct browser database access is denied.

| Method / operation | Input and behavior |
|---|---|
| GET | Without projectId: accessible projects. With projectId: summaries, targets, installed adapter IDs and ledger revision. Add id for full content/history. |
| POST create | projectId, stable requestId (8–100 letters/digits/underscore/hyphen), kind social/website, content `{title,text}`, sourceNotes. Identical replay returns the existing record even after editing; conflicting original input returns 409. |
| POST edit | projectId, id, revision, contentHash, content, sourceNotes. Author only. Archives previous content/Ask/target/baseline and invalidates approval. Dispatched/uncertain/verified records require a new draft. |
| POST configure_target | projectId, current ledger revision, allowPublish=true, target `{id,adapter,kind,label,resource}`. Administrator only; adapter validates connected resource. Disable using target `{id}`, enabled=false and ledger revision. |
| POST preview | projectId, id, revision, contentHash, targetId. Reads provider baseline, pins grant and creates a designated administrator Ask. Replacing a preview archives the old Ask. |
| POST approve / reject | projectId, id, revision, contentHash. Approval also requires publicUseChecked=true and designated administrator identity. Does not publish. |
| POST publish | projectId, id, revision, contentHash. Claims once, rechecks membership/grant/provider revision, dispatches and reads back. Verified replay returns the stored receipt. |
| POST reconcile | projectId, id. Fresh provider read for dispatched/uncertain/verified operations; never resends. Authorized members may reconcile past operations after a grant is disabled. |
| POST draft_flow | projectId, id, revision, contentHash. Creates an unapproved visible flow pinned to saved content. Each explicit creation creates a new definition. |

Visible flows expose review_publication with publicationId/contentHash. `/api/flows` reconcile_publication takes flow id, runId and nodeId, performs a fresh provider read and completes only matching content. Cancellation prevents advancement. Historical completion is an observation at the recorded time, not a perpetual guarantee. Approving a flow grants no publication authority.

## Adapter and recovery contract

The production adapter registry is empty pending provider/account/target selection and OAuth/resource permission. No account or grant is inferred. A real adapter must scope credentials and resources to the tenant, enforce provider-side conditional writes, return stable IDs/revisions, and reconcile accepted operations without recreating them. inspect reads current content/revision; publish receives only title/text, operationId and expectedRevision; reconcile reads by operationId and known external ID. Internal source notes are never sent. Read-back must match title/text exactly and return a valid HTTPS URL. Provider normalization requires an explicit reviewed contract before installation.

Private communications and project brand assets are not automatically imported. Public-use approval is a human declaration, not automated rights verification. Previews are literal text, not simulated provider rendering. Limits: title 160 characters, public text 12,000, notes 4,000, 200 drafts per project, 30 archived revisions per draft and 3.8 MB per ledger. Pagination is Phase 11 work.

Errors: 403 authority, 404 missing record, 405 method, 409 stale version/grant/verification, 422 input, 503 missing provider, 502 uncertain provider outcome. Provider errors are redacted. Never reset an uncertain claim to retry a create. Existing provider edits are not overwritten. Automatic rollback is unavailable; a correction requires a new draft, current baseline and new approval. Disabling a grant cannot recall an accepted request. Publication receipts never automatically fulfill operational obligations.
