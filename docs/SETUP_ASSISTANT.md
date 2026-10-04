# AI workflow setup assistant

The setup assistant configures existing HyperFlow primitives through authenticated APIs. It does not edit code, provide shell access, access database tools, or execute model-generated HTTP requests. Manual workflow editors remain available.

## Rollout

An administrator sets backend `SETUP_ASSISTANT_ENABLED=true` and optionally restricts `SETUP_ASSISTANT_ORG_IDS` to a comma-separated organization allowlist. The default is disabled. `SETUP_ASSISTANT_MODEL` defaults to the existing `gemini-3.5-flash` model and uses server-side `GEMINI_API_KEY`. No credentials are delivered to the model or browser. Deploy the updated database rules before enabling the assistant, especially when runtime lifecycle enforcement is enabled.

Start with fixture simulations. Controlled provider acceptance must use Jorian's configured contact, draft-only emails and explicitly approved TEST ONLY bookings. Do not activate production Sharehouse schedules as part of acceptance. A fixture result or successful model response does not constitute full Sharehouse acceptance.

## User flow

Open **Set up with AI** from project creation, **Configure with AI** from the workflow map, or **Configure this element** from node configuration. Start a session or resume one belonging to the current user. The panel asks one question at a time and offers existing-resource pickers when appropriate.

Review the proposed graph, actual prompts/templates, dependencies, output bindings, named resources, schedule timezone and before/after configuration. **Review changes** prepares the current revision/hash; **Apply configuration** saves that exact review. A change elsewhere invalidates the reviewed revision. Element sessions must explicitly expand to workflow scope before changing other elements.

**Run simulation** executes fixtures against the proposed graph without saving it and reports assertions, dispatch inputs, holds and zero provider calls. Ask the assistant for fixtures/assertions if it has not supplied them.

After saving, **Review live test** presents actual test inputs and effects. Approval creates a disabled TEST ONLY schedule and dispatches it through the existing runner. **Inspect test status** reconciles the owning FlowRun. A lost/uncertain dispatch is never automatically replayed. Continue held runs through existing Ask/run controls; do not start another test occurrence to resolve a callback.

**Review activation** separately reviews configured schedules, timezone, effects and configuration prerequisites. Approval enables ordinary schedules; temporary test schedules are excluded. Existing grants, provider authorization, contact windows, budgets and human review rules still govern execution. OAuth and permission changes remain human handoffs in existing integration controls.

Configuration saves disable the reviewed active schedules first and block if an execution is running/waiting. Pausing does not cancel callbacks or running executions. A blocked edit can leave the schedule paused; the panel exposes operation receipts and a separate activation review.

## API

All session endpoints require a current Firebase human session and enabled rollout. Delegated API credentials cannot create sessions or approve actions. Sessions are private to their originating user and tenant. Browser RTDB reads/writes are denied; tenant lifecycle export/deletion includes the session root.

- `GET /api/setup-assistant/sessions?view=availability`: `{enabled}`.
- `POST /api/setup-assistant/sessions` with `{scope:{kind:"new"}}` creates an unsaved workflow session. Existing workflow/element scopes include `projectId` and optionally `nodeId`.
- `GET /api/setup-assistant/sessions`: summaries of the user's sessions; `?id=...` resumes one.
- `POST /api/setup-assistant/sessions` with `{id,operation,requestId,expectedSessionRevision,...}` runs a command and returns `{session}`. Commands: `turn` (`message`), `prepare`, `expand_scope` (`projectId`), `apply` (`reviewHash`), `simulate`, `review_live`, `approve_live` (`reviewHash`), `review_activation`, `approve_activation` (`reviewHash`), and `inspect`.
- `DELETE /api/setup-assistant/sessions` with `{id}` removes a conversation. It does not undo applied configuration, delete execution receipts or cancel a live workflow.

Configuration apply uses the existing stable request ID, exact workspace revision and plan hash. The session review hash additionally covers resources, schedules and pauses. Multi-API saves are not atomic: each operation records started/completed/failed/unknown status, and configuration recovery reads the original receipt after an uncertain response. Do not replace a partially applied proposal; resume the original apply.

`POST /api/test-runs` additionally accepts `changes` and `planHash` to test a reviewed, unapplied proposal at `expectedRevision`. Existing requests without these fields retain their behavior. Proposed configuration is never persisted by simulation.

Sessions are limited to 100 per user, 100 commands each, 750 KB stored state and 500 KB request bodies. Model tool calls are bounded and only allow discovery, selected configuration reads, integration/resource lists, schedules and diagnostics. No model tool can apply, approve, activate or execute. Logs contain command outcome, latency and token counts, not prompts, credentials or provider payloads.

`GET /api/flow/advance?orgId=...&projectId=...&includeActive=true` adds `hasActiveRuns` through a status-indexed lookup, so setup does not miss old waiting executions outside the history page. Normal history reads retain their existing response.

## Verification status

Automated tests cover fixture composition, element scope, tenant/user isolation, stale revisions, lost configuration responses, partial saves, active-run protection, secret redaction, disabled schedules and separate live/activation reviews. Browser fixtures exercise the actual panel with an isolated transport; they are not provider acceptance. Real Gemini/provider acceptance must be verified in an enabled organization before broad rollout.
