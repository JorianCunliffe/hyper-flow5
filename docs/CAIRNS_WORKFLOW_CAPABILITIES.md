# Cairns workflow capabilities

This change supplies the application controls and execution primitives needed before configuring the Cairns Sharehouse workflow. It does not activate a schedule or contact anyone.

| Gap | Implementation |
| --- | --- |
| Weekday runs | Daily schedules accept selected local weekdays, calculate the next occurrence in the configured timezone, and can be created paused. Existing schedules without weekdays remain daily. |
| Four named Sheet ranges | Settings exposes the protected project resource catalog with separate read, append and upsert permissions. Connection changes require an administrator and a tenant-owned project. |
| SMS without email permission | Separate SMS automatic action and capability controls for draft, email, SMS, voice and Sheet operations. The project email switch still applies. |
| Typed information between nodes | JSON templates support dot paths and preserve whole arrays/objects. Report nodes optionally validate a structured output schema before completing. Missing inputs stop execution. Source braces are never recursively interpreted. |
| Every enquiry, row and draft | Action nodes can process a bounded array sequentially with a stable unique item key. Inputs are frozen in the FlowRun; each item has its own durable operation. The editable graph stays compact. Failed items block the batch, and long batches queue a durable continuation. |
| Native draft finalisation | Create Mailbox Draft and Update Mailbox Draft nodes use the project's connected Gmail/Outlook mailbox. Updates require the original provider draft ID. Requests are frozen for replay; neither node sends email. |
| Mailbox evidence for planning | Email triage exposes project/mailbox/operation-scoped items with bounded source text. Partial batches checkpoint and resume before planning. Truncation is explicitly recorded. |
| Timed human-call escalation | Human Wait supports primary call, delayed primary retry, fallback call, SMS to both, and subsequent weekday cycles. One Ask retains the field schema and answers. Only verified unsuccessful connections advance the chain; pending or ambiguous outcomes wait. Contact grants, independent capabilities and budgets are checked. |
| Separate run branches | Scheduled/manual runs start from ordinary roots; inbound runs start only from matched Event roots. Both can share a project without triggering each other. |
| Inbound reply target | An SMS node may use `target_source: "event_person"` for the verified sender of its persisted inbound FlowRun. The sender still needs project access. Voice calls require configured targets. Existing Event/Decision/Wait primitives can compose the inbound team-check chain. |
| Editing during callbacks | Independent cloud and local edits are merged by record ID. Competing edits remain local with a visible conflict and a download option rather than being silently replaced. |

## Configuration after release

1. Select the Outlook mailbox and the intended spreadsheet. Set `triage_connection_id` on the project.
2. Grant `tasks`, `enquiries`, `communications` and `inspections` to their exact tab ranges. Configure the correct write permissions and source-message idempotency keys.
3. Configure primary and fallback Communications people, project grants, contact hours and daily/per-contact budgets. Inbound contacts must have project access; arbitrary phone numbers in message text do not grant it.
4. Choose inspection slot length and group capacity. Configure the planning schema, evidence inputs and draft/Sheet/SMS mappings. Human answers must gate finalisation and inspection notifications.
5. Save the weekday schedule at 09:15 Australia/Brisbane, initially paused. Configure the Human Wait's weekday repeat time consistently.
6. Configure a separate inbound Event branch, including an immediate checking reply and a team Ask. Keep inbox text as data and team call targets as configured person IDs.
7. Verify the complete flow against controlled contacts and a test Sheet, then enable it. Live Outlook, model output, provider outcomes, callbacks and scheduler recovery need a controlled acceptance run after deployment.

## Template example

An upstream report can expose `plan_output.structured_output.enquiries`. A draft node's **For each item** source can use that path with key `source_message_id` and this template:

```json
{
  "to": ["{{item.email}}"],
  "subject": "{{item.subject}}",
  "text": "{{item.reply}}",
  "in_reply_to": "{{item.message_id}}"
}
```

If the draft node result variable is `drafted`, its aggregate is `drafted_output.items`, each entry containing `item` and `output`. The latter contains `provider_draft_id` for the update step.

For each supports 1–100 items and may not be nested inside a control-flow Loop. Human review on a batch applies after all items; put a reviewed planning step before effects that need approval. The prompt-to-flow compiler is not expanded by this change: construct these nodes through the node editor.

## Verification

Unit/integration-style tests exercise weekday calculation, typed data, missing-input rejection, batch callbacks and restarts, duplicate keys, selected branches, draft identity, cloud conflicts, provider outcome uncertainty and timed escalation replay. A local browser fixture at `/tests/ui/cairns.html` uses simulated services and exercises configuration without provider effects.

Firebase emulator and live-provider acceptance are separate release checks. A passing local build or test suite does not prove the production scheduler, mailbox connection or phone provider is healthy.
