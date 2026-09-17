# Outbound call prompts

Set the call purpose and instructions for the actual situation. Running a coaching node manually still makes a coaching call; it is not a test mode.

For an explicitly authorized test, use a separate operation and a test-specific template, for example:

```json
{
  "to": "{{contact_phone}}",
  "purpose_type": "test_call",
  "prompt": "Explain that this is an audio and callback test. Ask whether the recipient can hear you clearly, ask them to say one short test phrase, confirm it back, and end the call."
}
```

Test calls omit historical conversation context. Do not reuse the coaching node's operation identity or treat test answers as coaching results. Check the provider result before retrying an uncertain test dispatch.

Coaching calls use `purpose_type: coaching_session`. Begin with a brief hello, review yesterday's dated commitments (or identify the actual date of the most recent session), collect completion/partial completion/non-completion and blockers for each item, then agree next actions and deadlines and confirm them back. Never invent yesterday's commitments. The generated template includes the source document and dated tracker rows.

Other workflow calls retain their own instructions. An optional `greeting` sets a short spoken opening; the full prompt and historical context belong in the system instructions, not the greeting.
