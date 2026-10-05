# Cancelling voice questions

An explicit caller request such as “You can cancel all the rest of it” cancels
the current FlowRun occurrence and its open Asks. It does not answer missing
fields, approve work, resolve the human Wait as successful, or advance later
draft, booking or messaging nodes. Earlier responses and delivery receipts remain.

The authenticated Communications event must contain a speaker-labelled caller
turn and match the Ask's delivered communication and person. Assistant speech,
unlabelled transcripts, negations, quotations, being unavailable and requests to
cancel an individual booking do not automatically cancel a workflow. Ambiguous
requests remain available for human review.

Cancellation removes the occurrence's pending holds and escalation state.
Repeated events finish cleanup idempotently. Before advancing a run, HyperFlow
also checks previously recorded, correlated voice evidence, allowing older open
Asks containing explicit cancellation to be reconciled without another call.
The recurring schedule and other occurrences are not changed. An operation
already dispatched to a provider cannot be recalled by cancelling a question.

Regression coverage: `tests/cancelVoiceAsk.test.ts`.
