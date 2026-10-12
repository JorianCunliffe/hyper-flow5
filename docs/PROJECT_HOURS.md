# Project hours and explicit workflow checks

Hours belong to the project. **Check project hours** is a provider-free action node visible in the normal workflow editor. It reports a fact; it does not skip, defer, send, book or stop anything. A closed result is successful execution, not an error. There is no default closed branch.

## Configure

Edit project → Project hours of operation. Set an IANA timezone, weekly windows and optional closed dates. The same field is available to the setup assistant and existing revision-checked configuration plan/validate/apply API:

```json
{
  "operatingHours": {
    "timezone": "Australia/Brisbane",
    "windows": [{"days": [1,2,3,4,5], "start": "09:00", "end": "17:00"}],
    "closures": ["2026-12-25"]
  }
}
```

Sunday is 0. Opening is inclusive and closing exclusive. Multiple windows allow lunch breaks. An end earlier than the start crosses midnight. `00:00`–`24:00` is all day. A closure cancels that local date and the overnight spill from a closed start date. An empty window list is explicitly closed; absent configuration defaults to `open` (`hours_open: true`) with no hours restriction.

## Compose

Add node type `check_hours`, task `check_project_hours`, template `{}`. Enable automatic execution if it should run as the flow reaches it. The server reads the authenticated tenant/project record and current server clock; template content cannot choose another project or a false time. No webhook, credential or provider connection is required.

Outputs: `hours_status`, `hours_open`, `hours_checked_at` (UTC ISO), `hours_timezone`, `hours_local_time`, `hours_next_open_at` (UTC ISO or null), `hours_project_revision`. Timezone/local time are absent when not configured. Next opening is null when currently open, permanently closed, or no opening exists within eight days. Never interpret null as an indefinite wait.

Connect a Decision after the check. Branch on `hours_status` or `hours_open`. Choose the actual behavior for that workflow: continue, End, Human Ask, or Wait. For an explicit wait, set `resumeAtPath` to `hours_next_open_at` (or its configured result-variable path). Missing settings take the open branch. Route closed results with a null next opening to a separate branch. Wait persists its deadline across restarts. Run another check after waiting, because project hours may have changed. An hours result is a point-in-time observation, not permission or a permanent guarantee; place a fresh check near effects where needed.

Schedules still define when a workflow starts. Project hours do not rewrite schedules. Resource/staff availability, diary conflicts, grants, budgets, verified reply evidence and provider health remain separate checks. Calls, SMS, reception and escalation dispatch do not silently apply workspace/line opening windows or add after-hours wording. Configure any notice or review branch visibly in the workflow.

## Migration and release

This is a behavior change, not an additional policy layer. Before deployment, inventory scheduled workflows and inbound action paths that relied on legacy hours. Review the intended hours for each project, save them through normal configuration, and add the required check and explicit branches. Do not automatically infer a closed branch, publish reception or enable schedules. A workflow with no check has no opening-hours restriction.

Legacy workspace/reception fields remain readable for compatibility and audit, but are no longer consulted for opening hours. Review direct reception actions as well: only workflow entry points containing a check impose hours. Existing staff availability and booking conflict validation still apply. Frozen active runs do not acquire newly added nodes; finish or explicitly cancel/restart them during rollout. Hours checks themselves always read the current project settings and record their revision.

Old inbox/reception hours deferrals require human review rather than automatic replay. Existing workflow holds and uncertain provider operations remain owned by their original receipts; never recreate effects with a new identifier to bypass them.

## Verification

`tests/projectHours.test.ts` covers timezone boundaries, overnight windows, closures, DST, missing settings, trusted reads, configuration roundtrip, explicit branching and durable Wait deadlines. Reception SMS fixtures cover ordinary 7 pm replies without hidden notices/queues and duplicate protection. Browser fixture: `/tests/e2e/project-hours.html`, with no production writes or provider calls.

Run `npm run lint`, `npm test`, `npm run api:check` and `npm run build`. Local fixtures do not establish production migration or provider acceptance. Controlled live testing remains Jorian-only, email draft-only, with specifically approved test bookings.
