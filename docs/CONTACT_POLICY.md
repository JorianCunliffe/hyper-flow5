# Contact safeguards

Hours of operation now belong exclusively to `Project.operatingHours` and the explicit **Check project hours** primitive. See [Project hours](PROJECT_HOURS.md) for configuration, branches and migration. Calls, SMS, receptionist actions and schedule creation no longer enforce workspace or receptionist opening windows or generate after-hours notices.

The existing administrator-reviewed `GET /api/cockpit?operation=contact_policy`, `contact_policy_preview` and `contact_policy_apply` interfaces still manage contact safeguards. `expectedRevision` and `planHash` bind the reviewed proposal. `timezone` defines the daily budget boundary. `replies.windowHours`, `expiryHours`, `maxPerDay` and `maxPerContact` control verified reply evidence and separate reply budgets. `CONTACT_POLICY_V2_ENABLED` controls use of saved reply safeguards; it does not enable or disable project hours.

Legacy `outbound`, `outboundExceptions`, `replies.mode`, receptionist `hours`, `afterHoursMode` and `afterHoursActions` remain readable for configuration compatibility but have no runtime hours effect. Temporary hours exceptions no longer increase contact budgets. New configuration must use project hours and visible workflow branches instead.

Server code fetches source communications. A direct reply must match tenant, verified person, inbound channel, sender and receiving identity within its evidence/expiry window. Incoming SMS never grants authority to call. Capabilities, grants, contact budgets, loop protection, newer-message reconciliation and durable operation receipts remain enforced. A previous reservation is not permission to repeat an uncertain effect.

Existing SMS setup may use `{"target_source":"event_person","body":"Your reviewed response","contact_policy":{"onRestriction":"branch"}}` to branch on a contact-safeguard outcome. `provider_called:false` is not a delivery success. Opening-hours branching instead uses `hours_status` / `hours_open` from the separate hours primitive.

Persisted legacy inbox/reception deferrals are sent to human review rather than replayed after the change. Existing workflow holds and uncertain provider outcomes require their normal explicit review/reconciliation. No migration sends messages or activates reception.
