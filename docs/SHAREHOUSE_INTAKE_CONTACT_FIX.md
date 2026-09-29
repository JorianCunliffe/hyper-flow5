# Sharehouse intake and Ask recipient repair

Email Triage accepts `lookback_hours` (greater than 0, at most 168). Set it to `24` to inspect the last day of inbound mail even when a newer cursor was committed by a previous empty run. The window is anchored to the scheduled occurrence or saved FlowRun start, so batch retries use the same lower boundary. Already classified project/mailbox items are included in the occurrence without reclassification or draft creation. The stored incremental cursor never moves backwards. Omitting the option preserves existing incremental behavior.

Ordinary Human Ask delivery and subsequent SMS questions now resolve stable Communications IDs through the same tenant/project-granted resolver used by other autonomous actions. Missing or denied stable contacts fail closed; there is no fallback to a similarly named legacy team member. Existing name-based team-member configurations remain supported.

The Cairns Morning Run v2 definition was set to `lookback_hours: 24`. Its old paused run has frozen empty intake and questions; editing the definition does not repair that run or prove a successful phone call. A fresh controlled occurrence is required for end-to-end verification. Keep Jorian as both test recipients, drafts unsent, and diary writes labelled TEST ONLY.

Validation: 24 focused tests, TypeScript lint, and production build passed. Live provider acceptance is separate.
