# Operational review integration

Companion implementation to Communications Service `docs/OPERATIONAL_REVIEW_COMPLETION_PLAN.md`. The authoritative rollout/limitations document is [Communications delivery notes](https://github.com/JorianCunliffe/communications-service/blob/main/docs/OPERATIONAL_REVIEW_DELIVERY.md).

## Included

- `review.action.requested` routing after signature verification in both Express and Vercel event handlers.
- Validated `review-action.v1` contract with a matching schema and fixture in both repositories.
- Server-owned owner/project bindings, current Firebase membership checks, execution leases, canonical request hashes and serialized request snapshots (so Firebase cannot remove empty contract arrays).
- Result persistence before callback, idempotent callback retries and scheduler recovery. A queued event is never reported as an executed action.
- Existing Communications email idempotency and send policies; existing calendar exact-proposal approval, availability checks and provider reconciliation.
- Durable task and web-reminder records, plus an authenticated web panel using the same Communications briefing, questions, instructions and close-out state as voice.
- Firebase runtime rules and tenant lifecycle coverage for `review_execution`, `review_work` and `review_owner_bindings`.

## Rollout

Keep `REVIEW_ACTION_EXECUTION_ENABLED` unset until owner bindings and the Communications executor capability are configured. Set it to literal `true` for the bounded pilot. Deploy the updated Firebase rules, especially when `FIREBASE_ENFORCE_TENANT_LIFECYCLE=true`.

Use `review_owner_bindings/<encoded tenant>/<encoded person:contactUUID>` containing `enabled`, verified Firebase `uid`, and `project_ids`. Encoding matches `encodeURIComponent(value).replace(/\./g, '%2E')`. Bind the same Firebase UID to the canonical person in Communications Service's trusted API-client owner mapping. The web client never controls its asserted UID or authorized project list.

The existing scheduler tick replays uncertain executions and completion callbacks. Completed effects reuse saved receipts. Email success means the provider accepted the message for sending, not that the recipient received it. Calendar actions require an existing approved calendar proposal; they cannot create an unapproved diary mutation. Reminders are shown in the owner-review panel; they do not imply SMS or push notifications.

## Verification and limitations

`npm test`, `npm run lint` and `npm run build` validate the repository. Executor regressions include duplicate/concurrent delivery, lost callbacks, payload conflicts, revoked owner scope, canonical hashes and the cross-repository fixture.

Production credentials, Firebase rules deployment, real provider operations, authenticated browser/voice acceptance and representative live-model quality are separate open release gates. No messages or calendar changes were sent during this coding task. The Communications delivery notes also describe remaining calendar/hold completeness and upstream attachment-extraction integration.

## Source synchronization follow-up

Starting a web review now refreshes configured project calendars and open human workflow holds through existing provider/storage adapters. It first obtains the canonical owner scope from Communications; user-supplied owner IDs or project lists are not trusted. Communications migration 038 and the trusted client's `review:sources:write` capability are required. No calendar writes occur during synchronization.

Snapshots replace prior results, so completed holds disappear. Failures, missing grants, capped source lists and stale observations are reported rather than interpreted as empty data. Voice reads the same persisted owner/project snapshots; it does not independently refresh providers. Coverage is limited to configured project calendars, a bounded nine-day window, and 2,000 source items per project. Credentials, live source acceptance and production configuration remain rollout requirements.

Follow-up verification: Communications database suite 84 passing; Hyperflow source/executor/lifecycle tests 13 passing; Hyperflow type check and production build passed. These checks use local fixtures, not live provider acceptance.
