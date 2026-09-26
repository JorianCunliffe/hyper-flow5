# Configure and test HyperFlow through REST

An external agent can configure existing projects, graph nodes, dependencies, subtasks, settings, scratch items and saved UI views without editing application source. It can inspect the supported schemas and task templates, review an atomic change plan, apply it at an exact workspace revision, and run assertions against fixture execution. Existing operational APIs manage real flows, schedules, integrations and their receipts.

Start with authenticated `GET /api/discovery`, the consolidated [OpenAPI 3.1 contract](../contracts/openapi.json), and the [generated endpoint index](API_ENDPOINTS.md). The same contract is served at `GET /api/openapi.json`. Historical phase fragments remain for compatibility; the consolidated contract is the publication entry point. Legacy domain envelopes are still extensible: use the linked domain guides for detailed lifecycle requirements. Endpoint coverage does not mean every legacy response is strictly typed.

## Credentials and authority

A human owner/admin creates an expiring client through `/api/tenant`. Pass `Authorization: Bearer hf.<organization>.<client-id>.<secret>` over HTTPS. For the configuration and simulation cycle, grant exactly:

- `discovery:read`
- `configuration:read`, `configuration:write`
- `test-runs:read`, `test-runs:write`

These scopes do not permit live task dispatch. Add domain scopes only for the intended live operations. Credentials are bound to their issuer's current membership and tenant, not a separate service account or per-project allowlist. Revocation and expiry are checked on every request. Write admission records both the represented user and API client in the tenant audit; admission does not mean the command succeeded.

Human review decisions require a Firebase human session even if the client's issuer is the designated reviewer. This covers flow reviews, artifact and publication approvals, calendar approvals, captured-item decisions, triage interpretation/proposal approval, and obligation/operational-review responses. Credential and lifecycle administration remain human-only. OAuth requires human consent. Capability tokens for public Ask forms are a separate authentication boundary; do not pass them to an agent as a substitute for review.

Raw `PUT /api/workspace` is now human-only. Existing machine integrations must migrate to the configuration commands. Alias scope routing is consistent on both hosts: policy uses `capabilities:*`, named resources use `workspace-resources:*`, and memory POST is `communications:read`. Update existing client grants before migration.

## Configuration resources

| Resource | Methods | Selection |
|---|---|---|
| `/api/configuration` | GET, POST | Full configuration or `requestId` receipt; POST `plan`, `validate`, `apply` |
| `/api/projects` | GET, POST, PATCH, DELETE | `id` |
| `/api/nodes` | GET, POST, PATCH, DELETE | `projectId`, optional `id` |
| `/api/subtasks` | GET, POST, PATCH, DELETE | `projectId`, `nodeId`, optional `id` |
| `/api/settings` | GET, PATCH | Editable labels, people/roles, contact details, date format |
| `/api/scratch-tasks` | GET, POST, PATCH, DELETE | `id`, name, optional projectId |
| `/api/ui-views` | GET, POST, PATCH, DELETE | `id`, name, view and presentation settings |

Lists return `{revision,items,next}` with stable ID cursors (`after`, `limit` 1–100, default 50). Detail reads return `{revision,item}`. Settings return `{revision,data}`. Full configuration returns `{revision,projects,settings,uiViews,scratchTasks}`. Runtime records, Ask tokens, credentials and integration authority are excluded from the project configuration projection. Use operational resources for run state and receipts.

Commands use stable IDs and `expectedRevision`. A batch contains 1–100 changes:

```json
{
  "operation": "plan",
  "expectedRevision": 12,
  "changes": [
    {"resource":"node","operation":"update","projectId":"sales","id":"report","value":{"x":240,"y":120}},
    {"resource":"ui_view","operation":"create","value":{"id":"sales_board","name":"Sales board","view":"kanban","projectId":"sales","kanbanGrouping":"member","filters":{"important":true}}}
  ]
}
```

`plan` returns `valid`, `issues`, a change summary `diff`, possible action `effects` (all `willExecute:false`), and `planHash`. The hash covers the exact changes and revision. `validate` performs the same structural checks plus read-only configuration checks for named resources, capability policy, templates and unresolved inputs. Its `preflight.ready` is configuration readiness; `providerAvailability:not_checked` explicitly excludes live provider connectivity. It does not exchange OAuth tokens, send, sync or execute actions.

Apply the exact changes, revision and hash with `operation:apply` and a stable `requestId` of 8–100 letters, digits, underscores or hyphens. The server atomically validates and stores the entire batch, increments the workspace and affected project revisions, and returns `{receipt,revision}`. Repeating the identical request is safe; changed inputs or actors under the same ID return 409. Read `GET /api/configuration?requestId=...` after an uncertain response. A conflicting workspace revision requires a new read and plan. Receipts are visible to the originating client, or its human issuer.

`create`, `update` and `delete` are supported for all collection resources; settings use `update`. Updates merge declared configuration fields and preserve server runtime fields. Edit nodes/subtasks through their commands, rather than replacing a project's/node's entire child collection. On updates, `unset:["actionConfig.template"]` removes optional declared fields; it cannot remove required fields, child collections or runtime containers. Arrays such as `dependsOn` replace their configuration value, so use `[]` to clear dependencies. Authority fields and arbitrary runtime fields are rejected.

The granular POST/PATCH/DELETE routes are convenience aliases for a single batch change and require the same revision, request ID and plan hash. Plan their equivalent batch first. Their body contains `id`, `projectId`/`nodeId` as applicable, `value`, optional `unset`, `expectedRevision`, `requestId`, and `planHash`.

Limits: 1 MB configuration request, 3.8 MB workspace, 500 projects, 100 saved views, 1,000 scratch tasks and 1,000 retained configuration receipts. At the receipt cap, writes stop for administrator retention review; no automatic receipt deletion can silently break replay protection. Graph validation rejects invalid types/references, duplicate IDs/results, dependency cycles and reserved runtime data keys. Existing legacy graphs with invalid configurations need correction before editing them through this API.

## Fixture tests

`POST /api/test-runs` snapshots a project at `expectedRevision` and uses the production pure workflow orchestrator with a fixture-only executor. It does not import the provider executor, mutate the live project or create live action receipts.

```json
{
  "requestId":"report_test_001",
  "projectId":"sales",
  "expectedRevision":13,
  "fixtures":{"report":{"status":"success","output":{"report_content":"Fixture report"}}},
  "assertions":[{"path":"data.report_content","operator":"equals","expected":"Fixture report"}],
  "maxRounds":20
}
```

Optional `inputs` provide test-only project data. Fixtures are keyed by node ID and have `success`, `error`, or `pending` status. Missing fixtures fail; they never cause real calls. Templates are rendered using flow data and fixture outputs feed downstream nodes. Structured outputs are validated when an output schema is configured. Assertions support `equals` (with `expected`) and `exists` over `data`, `nodes` and `dispatches`.

The response is `{item}` containing ID, project, snapshot revision, actor/client, timestamp and `result`. Results include `mode:simulation`, `providerCalls:0`, `status:passed|failed|held`, assertions, node states, rendered dispatch inputs, missing fixtures, logs and limitations. Human reviews, external callbacks and waits can leave a run held. Simulation automatically enables configured action nodes for fixture dispatch; it does not prove their live auto-execution setting or provider authorization. A passing test authorizes no real effect.

Read `GET /api/test-runs?id=...`; list with `after`/`limit` (default 25, maximum 100); delete with `DELETE /api/test-runs` and `{id}`. Records are tenant- and client-scoped. The human issuer may inspect them. Browser database access is denied. Stable request replay returns the original result; conflicting input returns 409. Tests are synchronous and bounded to 100 rounds, 100 assertions, 500 KB input and 256 KB result. Keep at most 100 results/3.8 MB per tenant; explicitly delete old tests. Deleting a result also deletes its replay identity.

## Saved UI views

Create a `ui_view` resource, then open `/?savedView=<id>` while authenticated to that organization. The UI loads the saved view, selected project, subtask/minimap/project-panel visibility, Kanban grouping and filters, and zoom. Supported view names and bounds are published in discovery. This configures the existing UI; implementing a new React component or arbitrary widget renderer still requires application development. Saved views do not grant access to their target projects.

## Live execution and inspection

After configuration and simulation, use the existing domain APIs for live work. Their own authorization, reviews, grants, versions and policies still apply:

| Capability | APIs / guide |
|---|---|
| Reusable business flows | `/api/flows`; [main reference](API.md) |
| Classic graph execution/history | `/api/flow/advance` GET/POST; `/api/tasks/execute` POST |
| Timed execution | `/api/schedules`, `/run`; separately authenticated `/tick` |
| Service project prerequisites | `/api/service-projects/setup-draft`, `/validate`, `/status` |
| Named resources and capability policy | `/api/workspace/resources`, `/api/capabilities` |
| Artifacts | [Artifact API](ARTIFACT_API.md) |
| Publication | [Publishing API](PUBLISHING_API.md) |
| Files | [Managed files](MANAGED_FILES.md) |
| Obligations and promise evidence | [Main reference](API.md), [Promise CRUD](PROMISE_CRUD.md) |
| Diagnostics | [Operational diagnostics](OPERATIONAL_DIAGNOSTICS.md) |

`/api/tasks/execute` requires durable `correlation.projectId`, `nodeId` and `runId`. Discovery describes all 13 task template types and their output fields. Pending results are not completion. Poll and reconcile through the owning domain; do not retry uncertain provider writes with new IDs. There is no universal live-run ledger replacing those domain ledgers.

## Executable HTTP-only recipe

[configure-and-test.mjs](../examples/configure-and-test.mjs) creates a fixture project, a saved view and a simulation result using only HTTP. Run with Node 22+, `HYPERFLOW_URL` and `HYPERFLOW_API_TOKEN` in your environment. It prints the project, test and saved-view identifiers, and performs no live dispatch. Each invocation creates new example resources; remove them through the configuration API when finished.

## Verification and release

`npm run api:generate` regenerates the contract, endpoint index and TypeScript declarations; `npm run api:check` rejects drift. Unit coverage tests every public rewrite's presence. HTTP integration tests configure and simulate with two real isolated Firebase emulator tenants, compare the shared Vercel handler, reject unauthorized approvals and browser test-record writes, and check suspended-tenant denial.

Deploy the matching application and database rules together. Production acceptance must check both deployment origins with isolated tenant credentials, saved-view rendering, real provider consent/grants and one explicitly authorized integration run. Emulator fixtures do not certify deployed versions, provider delivery or external tenant isolation. Live provider writes require their concrete tenant, destination and authorization; they are not part of the simulation recipe.
