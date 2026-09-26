# HyperFlow artifact API

Owner: HyperFlow. Base resource: `/api/artifacts`. Requests require a Firebase bearer token or tenant API client with `artifacts:read` / `artifacts:write`, plus current organization membership. Human review decisions (`approve`, `reject`, `review`, `approve_sheet`) require a Firebase human session. Tenant identity comes from authentication, not a request field. Project identities must belong to that organization. Administrator operations require owner/admin role. Designated artifact Asks accept only the job creator's authenticated response. Capability tokens and embedded image bytes are omitted from public job/template projections.

GET with no project returns permitted project choices. All remaining operations require `projectId` in the query or body.

| Method | Operation | Required fields and result |
|---|---|---|
| GET | List | `projectId`; returns job summaries, templates, registry revision, connected account references and optional report spreadsheet target. Limit 100 jobs. |
| GET | Inspect | `projectId`, `id`; returns the frozen job and section preview. |
| GET | `download` | `projectId`, `id`, `operation=download`; verifies stored bytes against the receipt, then returns `download` containing base64, MIME, filename, bytes and SHA-256. No public file URL or delivery claim. |
| GET | `sheet_resources` | `projectId`, `connectionId`; lists up to 100 connected Google spreadsheets and edit capability. |
| POST | `save_template` | `projectId`, current registry `revision`, `template` containing `id`, `name`, `format` (docx/pptx/xlsx), `brand` (`name`, six-digit `accent`, `font`, optional PNG `logo.base64`). Saves a new immutable version. Fixed required sections and project-only audience. |
| POST | `configure_sheet` | Registry `revision`, `connectionId`, `spreadsheetId`, `enabled=true`, `allowNewTabs=true`; verifies edit capability and grants creation of new report tabs. `enabled=false` disables the current grant. Administrator only. |
| POST | `prepare` | `requestId` (8–100 letters/digits/underscore/hyphen), `templateId`, `templateVersion`, ISO `periodStart`, `cutoff`. Freezes live source inputs and returns an open input Ask. Same key/different request returns 409. |
| POST | `approve`, `reject` | `id`, exact job `revision`, `inputHash`; designated input Ask response. |
| POST | `generate` | `id`, `revision`, `inputHash`; requires approved inputs, claims generation once. Generated/reviewed jobs return their existing receipt. |
| POST | `reconcile` | `id`, `revision`, `inputHash`; recovers an intact already saved file after interrupted generation/receipt storage. It does not generate or deliver another file. |
| POST | `review` | `id`, `revision`, `inputHash`, exact `fileHash`, `visualChecked=true`, `contentChecked=true`; designated output Ask response after inspecting the actual downloaded file. |
| POST | `propose_sheet` | `id`, `revision`, `inputHash`; requires reviewed file/current enabled target. Creates a separate export Ask naming its audience/target. |
| POST | `approve_sheet` | Same version fields; designated reviewer approves the pinned target. |
| POST | `export_sheet` | Same version fields; requires approved export/current grant. Creates one new tab and verifies the values. Unknown outcome stays uncertain. |
| POST | `reconcile_sheet` | `id`; current granted project/target required. Reads the existing tab, never repeats the provider write. Manual differences are conflicts. |
| POST | `create_flow` | `templateId`, `templateVersion`; creates an unapproved visible weekly report flow, with seven-day window ending at each run's creation. |
| POST | `draft_flow` | Reviewed artifact `id`, one explicit email `to`; creates an unapproved visible handoff flow using the configured mailbox. Draft has no attachment and is never sent. Missing mailbox remains a flow clarification. |

All POST bodies also contain `operation` and `projectId`. Errors use `{error}` with 401 for missing authentication, 403 for authority, 404 for unavailable scoped records, 409 for stale/conflicting state, 422 for invalid inputs, and 5xx for storage/provider failures. Generate/export state remains queryable after response loss. A receipt is an observation with its own scope, not a promise fulfillment.

`/api/flows` gains `prepare_office_report` (templateId, templateVersion, windowDays) and `check_artifact` (artifactId, fileHash). The preparation step waits for Office output review. POST `operation=reconcile_artifact`, `id` (flow), `runId`, `nodeId` checks the exact reviewed job/file before settling the step. The existing flow approval, run identity, cancellation and resource checks remain in force.

Production routing reuses the existing authenticated Gemini function through a rewrite, preserving the twelve-function deployment limit. Communications APIs gain no artifact, template or spreadsheet ownership.

Report preparation requires Communications 2.6.1 kind=evidence support. It reads current permitted project source messages, without derived summaries/facts, and discloses a 100-record scan and 30-result cap. Older providers fail closed.
