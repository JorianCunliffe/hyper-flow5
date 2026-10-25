# Coaching review and daily scheduling

An email Ask notification must pass the organization's email authority check before entering durable provider dispatch. A draft-only refusal is recorded as a failed notification. The original Ask remains open in HyperFlow; no email is sent and no accepted delivery receipt is fabricated. Actual uncertain provider effects still require reconciliation.

A daily coaching occurrence may advance its schedule once the verified call and extraction have finished and the only remaining work is the extraction's current web approval and its dependent steps. The occurrence and FlowRun remain waiting, and tracker writes still require the original review. Pending calls, retry timers, failed actions, unrelated open Asks and work outside that review branch keep the original schedule head in place.

The existing misfire policy determines the next occurrence. With `run_once`, recovering an old review moves to the next future scheduled time without replaying missed days. No review is automatically approved or cancelled.

For the 14 October 2026 coaching occurrence, deploy the fix and allow the normal five-minute scheduler to reconcile the existing FlowRun. Verify the active coaching schedule moves to a future 09:00 Australia/Brisbane occurrence, the old review is retained, and scheduler logs stop reporting the draft-only refusal as a failed job. Do not start a fresh manual run merely to clear the old occurrence.

Regression coverage: `tests/coachingSchedule.test.ts`, alongside the email authority, durable dispatch, scheduler and FlowRun suites.

## Restarting through the UI

- **Resume** (or **Enable** in the schedule list) enables the paused timer and recalculates the next future configured local time and day. It skips times that passed while paused, including when the normal misfire policy is catch-up. An unresolved current occurrence stays attached to its original provider identity; use the existing held-run recovery panel when required.
- **Start now** starts or continues one coaching session and enables the daily timer at its next future local occurrence. The result shows the saved next time. A completed session awaiting web review does not disable this control, and its tracker write still waits for that review.
- Concurrent browser starts share one server-owned reservation and occurrence identity. Lost acknowledgements reuse the timestamp saved at the original click. An already active or uncertain session is continued before any new call can be allocated; the automatic timer also waits for an unresolved manual session.
- **Pause** disables future timer starts. It does not claim to cancel an existing phone call or erase its review.

Check both the live session result and the saved next time after restarting. A provider `call.completed` event proves a terminal call event; extraction and tracker persistence must be checked separately. Model credit exhaustion remains a processing failure and must not be described as a completed coaching result.

Restart coverage: `tests/manualScheduleStart.test.ts`, `tests/serviceRunProgress.test.ts`, and the isolated Firebase/provider fixture in `tests/integration/coaching-restart.test.ts`. The fixture makes no live calls.
