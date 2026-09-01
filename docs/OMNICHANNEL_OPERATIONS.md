# Omnichannel Agent Operations and Tenant Onboarding

This runbook turns the source implementation in `OMNICHANNEL_AGENT_SPEC.md` into a controlled production rollout. Do not treat a successful build or mock provider ID as delivery evidence.

## 1. Release order

1. Back up the Communications database and record the currently deployed revisions.
2. Deploy Communications Service and run its normal production start command, which applies migrations before starting the API.
3. Confirm migration `016_connected_mailboxes.sql` is present in migration history and the five mailbox tables are accessible to the backend service role only.
4. Deploy HyperFlow.
5. Configure the callback protection path and run the callback smoke test below.
6. Configure a timer that invokes `/api/schedules/tick` at least every five minutes.
7. Onboard one controlled tenant and complete Gmail, coaching, omnichannel, and failure acceptance in that order.

Do not enable broad automatic sends or use uncontrolled recipients during acceptance.

## 2. Backend configuration

Use the complete environment tables in the two repository READMEs. The critical cross-service pairs are:

| HyperFlow | Communications Service | Requirement |
| --- | --- | --- |
| `COMMUNICATIONS_API_KEY` | `API_KEY` | Identical value. |
| `COMMUNICATIONS_WEBHOOK_SECRET` | `COMMUNICATIONS_WEBHOOK_SECRET` | Identical HMAC secret. |
| `PUBLIC_BASE_URL=https://<hyperflow-origin>` | `HYPERFLOW_EVENT_URL=https://<hyperflow-origin>/api/events` | Exact public event route. |
| same HyperFlow origin | `HYPERFLOW_AGENT_CONTEXT_URL=https://<hyperflow-origin>/api/agent/voice-context` | Live inbound voice route. |
| generated Vercel bypass | `HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET` | Only when an anonymous probe of the selected production origin is intercepted by Deployment Protection. |

Set HyperFlow `COMMUNICATIONS_REQUIRE_SIGNATURE_V2=true` explicitly. Communications emits V2 signatures and production HyperFlow rejects legacy-only delivery by default.

Keep OAuth encryption keys, OAuth client secrets, service-account material, API keys, webhook secrets, scheduler secrets, and protection-bypass secrets in backend environment storage. Never paste them into HyperFlow project data or browser settings.

## 3. Callback and Deployment Protection smoke test

Use the stable HyperFlow production domain, not a generated deployment or preview URL. Probe the callback route anonymously before configuring a bypass: an application JSON `401` is good evidence that the route reached HyperFlow; a login redirect or Vercel protection page is blocked. Generated deployment and preview URLs may remain protected even when the production domain is public.

Only when the selected production origin is blocked, generate a Vercel Protection Bypass for Automation secret and configure it in Communications as `HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET`.

The Communications implementation adds the bypass header only when the destination origin exactly matches the configured HTTPS HyperFlow origin.

After both deployments are ready, run from the HyperFlow repository in a temporary PowerShell session:

```powershell
$env:HYPERFLOW_SMOKE_URL = 'https://<hyperflow-origin>'
$env:HYPERFLOW_SMOKE_TENANT_ID = '<controlled-tenant-id>'
$env:COMMUNICATIONS_WEBHOOK_SECRET = '<shared-webhook-secret>'
# Set only when the anonymous probe is intercepted by Deployment Protection:
$env:HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET = '<automation-bypass-secret>'
npm.cmd run smoke:callbacks
```

Pass evidence is one JSON result showing:

- unsigned request status `401`, proving the request reached HyperFlow rather than an SSO redirect;
- signed request status `200`; and
- `duplicate: true` for the replayed fixture.

The fixture is a non-terminal `communication.created` event. It writes one idempotency record for the controlled tenant but sends no email, SMS, or call.

## 4. Scheduler

The checked-in Vercel Hobby cron is a daily fallback only. Production omnichannel operation needs a trusted invocation at least every five minutes.

The production repository includes `.github/workflows/scheduler.yml` as a fallback. GitHub scheduled workflows may be delayed. The preferred Hobby-compatible five-minute timer is the always-on Communications VM: when `HYPERFLOW_EVENT_URL` and `COMMUNICATIONS_WEBHOOK_SECRET` are configured, it derives `/api/schedules?action=tick`, preserves any scoped Vercel bypass query parameter, and sends a replay-safe timestamped HMAC `POST` every five minutes.

Alternative options are:

- upgrade the HyperFlow Vercel project and change the cron to `*/5 * * * *`; or
- configure another external scheduler to `POST https://<hyperflow-origin>/api/schedules/tick` with `x-hyperflow-scheduler-secret: <SCHEDULER_SECRET>`.
- retain the GitHub workflow and daily Vercel cron as lower-frequency fallbacks; schedule leases and occurrence IDs prevent duplicate work.

Do not put `SCHEDULER_SECRET` in the URL. Verify two consecutive invocations and confirm the operations panel shows successful schedule claims without duplicate occurrences.

## 5. Controlled tenant onboarding

1. In Communications, create or verify exactly one tenant and exactly one enabled receiving phone configuration for each dialled service number.
2. Verify the controlled user exists as a stable Communications person/contact in that tenant.
3. In HyperFlow **Settings > Agent & Connections**, select that stable person as primary and grant only the intended test projects. Inbound people fail closed until this is configured.
4. Set the tenant phone/SMS/email service identities and allowed automatic actions. Keep connected mailbox behavior draft-only.
5. Connect Gmail through HyperFlow Settings. Confirm the connection reports healthy and HyperFlow stores only the opaque connection reference.
6. Connect Google Workspace separately. Grant only the controlled coaching Doc, Sheet, and A1 range.
7. Create one **Daily Email Triage** project and one **Daily Coaching** project.
8. Configure Brisbane timezone, controlled digest/call times, controlled phone recipient, call retry window, Doc, Sheet range, and coaching reviewer.

Outlook must remain visibly unavailable until its adapter passes the same acceptance suite.

## 6. Gmail acceptance

Use a controlled mailbox and messages containing no sensitive production data.

1. Send one human message, one automated/no-reply message, one spam-like message, and one reply in an existing thread.
2. Run mailbox reconciliation twice.
3. Confirm exactly one canonical communication and one triage item per provider message, with no duplicates on the second run.
4. Confirm automatic/spam mail is ineligible for memory and agent response.
5. Confirm priority, intent, evidence, deadline, project, and canonical thread reference on the human message.
6. Request a reply draft. Confirm it exists as a Gmail draft and is not sent.
7. Request the triage summary over controlled SMS and email and confirm both use the same project state.
8. Confirm a second tenant cannot list, query, sync, or draft against the mailbox connection.

## 7. Coaching acceptance

1. Put known source facts in the controlled Google Doc and a known starting row in the allowlisted Sheet range.
2. Trigger one scheduled coaching occurrence.
3. Confirm one run/occurrence is claimed and the expected Doc and Sheet revisions are recorded.
4. Answer the controlled call and state one known progress item, blocker, commitment, and next action.
5. Confirm the terminal event is a meaningful `human_completed` call, not provider completion alone.
6. Confirm the typed coaching result matches only what the human said and exactly one Sheet row is written.
7. Confirm Sheet input uses `RAW`, so text beginning with `=` remains data rather than a formula.
8. Replay the terminal callback and scheduler occurrence. Confirm there is still exactly one write receipt/row.
9. Repeat with voicemail, no-answer, and a controlled wrong-number outcome. Confirm failed flags are visible and no coaching memory or Sheet write occurs.
10. Use an ambiguous answer. Confirm Human Ask review is required before a Sheet write.

## 8. Omnichannel continuity and authorization

1. Ask for the latest coaching commitment by SMS.
2. Reply by email and explicitly reference the coaching project.
3. Call the agent, select the coaching project, and ask a read-only question.
4. Switch to Email Triage and request urgent items.
5. Mention two permitted projects without selecting one. Confirm the agent asks for clarification and exposes facts from neither project.
6. Attempt the same interactions as an ungranted person and as a second tenant. Confirm fail-closed behavior and no cross-project or cross-tenant context.
7. Request a coaching tracker mutation. Confirm it appears as a proposal and changes the Sheet only after an authenticated approval.

## 9. Operations and recovery

Use HyperFlow's **Operations & Recovery** panel to inspect:

- mailbox connection and last-sync state;
- due schedules and recent occurrences;
- agent inbox jobs and failure reason;
- coaching call outcomes;
- Google external-action receipts; and
- failed/review-held jobs eligible for replay.

Run controlled drills for provider outage, revoked OAuth, delayed callback, duplicate event, stale scheduler lease, ambiguous routing, failed external write, and Vercel protection failure. Replay only after confirming whether the provider action already occurred; idempotency is the recovery boundary, not a reason to retry blindly.

## 10. Release evidence

Record, without secrets or raw message/transcript bodies:

- deployed commit identifiers for both repositories;
- migration `016` result;
- callback smoke JSON;
- scheduler invocation timestamps;
- controlled tenant/project/person IDs;
- canonical communication, run, occurrence, call, and write receipt IDs;
- expected versus observed Gmail and Sheet results; and
- failure-drill outcomes.

Production acceptance is complete only when every Definition of Done item in `OMNICHANNEL_AGENT_SPEC.md` has direct evidence and no uncontrolled send or cross-tenant access occurred.
