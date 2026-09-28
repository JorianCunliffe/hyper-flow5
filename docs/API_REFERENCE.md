
### Existing email draft linkage recovery

Authenticated app members can `POST /api/triage?scope=draft` with `{ "id": "<triage item id>" }` to recover missing linkage from that enquiry's saved agent draft receipt. Callers cannot supply a mailbox, receipt or provider draft ID. Recovery verifies the tenant, original communication, receiving connection, successful receipt and live editable draft before atomically saving linkage and an audit entry. Conflicting linkage returns 409. It does not change review disposition, reroute the enquiry, replay the agent, create a draft, alter its body or send email. Repeated recovery preserves the same linkage. `GET /api/triage?scope=draft&id=...` remains a read-only live preview. Deploy the Communications Service receipt-read endpoint before using recovery.

### Communications contacts

`GET /api/communications/contacts` lists contacts in the authenticated organisation. Requires a member session or a HyperFlow API key with `communications:read`.

`POST /api/communications/contacts` accepts `{"name":"Carol","phone_number":"+61414022817"}`. Requires owner/admin membership and, for machine credentials, `communications:write`. The organisation comes from authentication; caller-supplied tenant IDs and extra fields are rejected. Returns `{person:{id,name,phone},created:true}` with HTTP 201, or HTTP 200 and `created:false` for an existing matching name/phone. Conflicting matches return 409. The current upstream list is limited to 200 contacts; duplicate checking is best-effort, not an atomic uniqueness guarantee. Do not automatically retry an ambiguous creation failure: check the directory first.

Contact creation neither grants project access nor sends communications. Settings exposes the same operation under **Add Communications contact**.

For agent API access, issue a scoped, expiring HyperFlow API credential and supply it through a local environment variable or secret store. Use `Authorization: Bearer <HyperFlow key>`. Do not copy a Communications Service legacy key across tenants or commit credentials. HyperFlow keeps its upstream integration key server-side.
