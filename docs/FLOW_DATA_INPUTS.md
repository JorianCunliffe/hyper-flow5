# Project and run data

Project Settings → Project Data stores persistent facts/configuration. A FlowRun
copies that data into isolated working state. Action templates resolve against
that state, not a global workspace store. Whole JSON placeholders preserve types:

```json
{
  "reference_context": {
    "business_information": "{{property_information}}",
    "available_rooms": "{{room_availability_output.webhook_response.details.userMessage}}"
  }
}
```

This is an Email Triage template fragment; retain its mailbox/policy settings.
Only explicitly selected reference_context is sent to the classifier. It is
bounded to 40,000 serialized characters (oversize fails, never silently truncates).
The classified email stores the resolved context and run ID; its detail drawer
shows a credential-redacted preview. Correspondence and reference facts cannot
override system policy or authorize sending. Existing tenant/provider controls
are unchanged.

## Output contract and freshness

A result variable `availability` creates `availability` (status),
`availability_success`, `availability_output`, and applicable error/outcome keys.
Use `{{availability_output.webhook_response}}`, not `{{availability}}`, for data.
Named results are cleared on a new occurrence and on rerun before replacement.
Node run history retains the old results. Legacy unprefixed output keys remain
for compatibility and must not be used as proof of freshness.

For live facts, connect the producer before the consumer and select its named
result under **Require fresh results**. All actions enforce this before dispatch,
including manual execution: one unambiguous producer must have succeeded in the
same occurrence. Missing/failed/old results block, regardless of old project values.
Start the flow to run dependencies; directly running a consumer cannot substitute
for them. New empty runs do not mean static project facts are erased.

Node configuration offers **Available data and input preview**. It lists existing
paths and named outputs and previews template resolution against saved project
data; this is explicitly not proof of the next run's freshness. Missing references
are shown. Arrays use numeric dot paths (`items.0.name`), not bracket syntax.

## Cross-node audit

| Primitive | Data input support / main outputs | Remaining limitation |
| --- | --- | --- |
| Webhook | Templated URL/method/headers/payload; webhook_response, webhook_status | Secret-reference editor is still absent; do not embed credentials in AI context |
| Email Triage | Templated settings plus reference_context; triage_items/counts/digest | Does not automatically use every project fact; context must be selected |
| Report | Templated prompt/SOP/template; structured mode source_data and output_schema; report_content/structured_output | Reference context for plain-text reports belongs in their prompt/template |
| Create/Update Mailbox Draft | Templated mailbox/message IDs, recipients and content | Existing provider and tenant permissions still apply |
| Email/SMS/Call | Templated destinations/content/call guidance | Autonomous identity targeting and sending stay policy-controlled |
| Read Doc/Sheet | Granted resource selection, document text / sheet values | Resource selection is permission-scoped, not arbitrary URLs; dynamic grant names need separate validation before support is advertised |
| Append/Upsert Sheet | Templated rows/keys/idempotency | Must stay within granted ranges |
| Coach Result | Verified transcript and project document/sheet context | Specialized extraction fields, not arbitrary context injection |
| Decision/Loop | Nested scalar conditions now use the shared dot-path reader | Equality/existence/one-of only; no expression language or arithmetic |
| For each | Array source plus item/item_key/item_index | Frozen bounded batch with stable item keys; no nested control-loop collections |
| Human Wait/Review | Human question and sourced fields read project data | Not every timer/matcher/reviewer field is template-enabled |
| Event/End/Milestone | Event produces trigger data; End/Milestone control graph | These do not need arbitrary action templates |

No provider access, grants, send gates, or schedule activation is implied by data
references. Weekday scheduling checkboxes remain a separate future UI task.
