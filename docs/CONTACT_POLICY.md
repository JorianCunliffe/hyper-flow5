# Contact and business-hours policy

Contact policy v2 separates proactive contact, verified inbound replies and business actions. It uses existing SMS/phone tasks, Condition, Wait and Human Ask; reception is a shared service, not a new primitive.

## Rollout

Set `CONTACT_POLICY_V2_ENABLED=true` only after fixture verification and administrator review. Until then saved v2 policy is inactive. No migration enables reception, grants permissions or replays messages. Without a reviewed policy, legacy contact hours and shared budgets remain in force. The new-configuration recommendation is reply with an after-hours notice, a 24-hour response/expiry window, and separate reactive limits of 200/day and 20/person/day. Existing outbound budgets remain configured in the CEO channel settings.

## Configuration API and UI

Overview → CEO channel access and receptionist settings → Contact and business hours.

- `GET /api/cockpit?operation=contact_policy`: effective saved/migration policy, feature status and new-configuration defaults.
- `POST /api/cockpit` with `operation: contact_policy_preview`, `policy`, `expectedRevision`: validated proposal, planHash and current local-time preview.
- `POST /api/cockpit` with `operation: contact_policy_apply` and the exact reviewed `policy`, `expectedRevision`, `planHash`: administrator human approval. Stable operation identity is derived from actor, base revision and proposal hash; a lost response can be retried exactly. Stale changes require a new preview.

The policy has `revision`, IANA `timezone`, `outbound: {days, start, end, closures}` and `replies: {mode, windowHours, expiryHours, maxPerDay, maxPerContact}`. Weekdays are 0 (Sunday) through 6. Times are HH:mm (end may be 24:00); end before start is overnight. Closures are YYYY-MM-DD local dates, blocking both the date and an overnight opening originating on a closed date. Next openings are calculated using real instants to handle daylight-saving transitions.

Reception line/project settings use the existing `/api/reception` revision/review/apply/activation interface. Lines support `hours` and `afterHoursMode`; projects support additional `hours`, `afterHoursMode` and `afterHoursActions` drawn only from their already-authorized actions. Project hours are interpreted in the receiving line's timezone. Restrictions intersect: queue is stricter than acknowledge, which is stricter than reply. No rule grants an otherwise unauthorized action.

The AI setup helper reads the same contracts. An administrator must explicitly include workspace contact policy before the assistant can propose `extras.contactPolicy`; project reception changes remain restricted to the selected workflow. The proposal is reviewed and applied through the same APIs. Saving policy neither places a call nor activates reception.

## Execution and setup files

Server code fetches the source communication; model-supplied evidence is never trusted. Reply authority requires matching tenant, resolved person, inbound channel, sender, a single receiving identity, and a source within both response and expiry windows. Incoming SMS never authorizes an outbound call. Deferred messages are checked for newer inbound or outbound activity before sending. Existing capabilities, caller history visibility and grants remain mandatory.

An SMS action setup file can use:

```json
{"target_source":"event_person","body":"Your reviewed response","contact_policy":{"onRestriction":"branch"}}
```

The event must be a trusted persisted FlowRun. Restrictions return `provider_called:false` and `contact_policy` containing `status`, `reason`, `revision`, `source`, `localTime`, optional `nextEligibleAt`/`expiresAt`, `reactive`, and `afterHours`. A Condition branches on the status; a Wait uses `nextEligibleAt`; Human Ask handles blocked/review outcomes. After a Wait, reevaluate before dispatch. Never treat a policy-only result as delivery success. The default restriction behavior is an explicit policy hold, not an uncertain provider outcome.

Inbound agent/reception jobs use the existing durable inbox scheduler. Silent queue saves the enquiry and resumes at opening. Acknowledgement mode sends one preliminary receipt, then resumes for the substantive response. Expired or superseded responses need human review. Stable operation reservations and existing provider receipts prevent automatic replay of uncertain effects. An uncertain provider result is distinct from a policy deferral.

Reply mode adds: “It is outside business hours, so some actions will need staff review.” Reception tracks that notice within the conversation period. Restricted bookings remain requests, with no promise to execute automatically at opening. After-hours action permissions and current diary/Ask state are rechecked at the action boundary.

## Verification

Run `npm run lint`, `npm test`, `npm run api:check`, and `npm run build`. `tests/businessHours.test.ts` covers 7 pm Brisbane replies, legacy restrictions, spoofed/expired evidence, overnight windows, closures, DST and action restrictions. `tests/receptionSms.test.ts` covers real receptionist paths with fixture providers, deferral/resumption, acknowledgement, duplicate events and restricted bookings. Browser fixture: `/tests/e2e/contact-policy.html` (no production effects).

Production acceptance remains separate: deploy with the feature off; review policy and scoped readiness; enable for the controlled Jorian test, verify inbound, response, delivery and any deferral receipts. Keep emails draft-only, and public receptionist activation separate. Do not replay the previous failed SMS.

### Temporary outbound exceptions

Administrators can review/apply `outboundExceptions` through the same contact-policy interface. Each entry specifies an exact international-format `target`, `projectId`, `channels` (`sms`/`voice`), epoch-millisecond `startsAt`/`expiresAt`, and a reason. Windows are limited to 24 hours; the manual editor creates two-hour windows. Recipient, project, channel and current time must all match. Exceptions affect proactive contact hours only: they do not grant project access, bypass contact budgets, authorize bookings, or convert invalid inbound evidence into reply authority. Expiry is checked before each dispatch. Existing policies without exceptions retain their behavior.

An exception may also carry `maxPerContact` (integer 1–10), explicitly reviewed for controlled volume testing. It raises only the matching recipient/project/channel daily contact allowance during the exception window. The workspace-wide daily budget, operation deduplication and all action permissions remain enforced. Removing/expiring the exception restores the normal per-recipient limit; past attempts remain counted.
