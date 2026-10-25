# Coaching review and daily scheduling

An email Ask notification must pass the organization's email authority check before entering durable provider dispatch. A draft-only refusal is recorded as a failed notification. The original Ask remains open in HyperFlow; no email is sent and no accepted delivery receipt is fabricated. Actual uncertain provider effects still require reconciliation.

A daily coaching occurrence may advance its schedule once the verified call and extraction have finished and the only remaining work is the extraction's current web approval and its dependent steps. The occurrence and FlowRun remain waiting, and tracker writes still require the original review. Pending calls, retry timers, failed actions, unrelated open Asks and work outside that review branch keep the original schedule head in place.

The existing misfire policy determines the next occurrence. With `run_once`, recovering an old review moves to the next future scheduled time without replaying missed days. No review is automatically approved or cancelled.

For the 14 October 2026 coaching occurrence, deploy the fix and allow the normal five-minute scheduler to reconcile the existing FlowRun. Verify the active coaching schedule moves to a future 09:00 Australia/Brisbane occurrence, the old review is retained, and scheduler logs stop reporting the draft-only refusal as a failed job. Do not start a fresh manual run merely to clear the old occurrence.

Regression coverage: `tests/coachingSchedule.test.ts`, alongside the email authority, durable dispatch, scheduler and FlowRun suites.
