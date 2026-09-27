
### Communications contacts

`GET /api/communications/contacts` lists contacts in the authenticated organisation. Requires a member session or a HyperFlow API key with `communications:read`.

`POST /api/communications/contacts` accepts `{"name":"Carol","phone_number":"+61414022817"}`. Requires owner/admin membership and, for machine credentials, `communications:write`. The organisation comes from authentication; caller-supplied tenant IDs and extra fields are rejected. Returns `{person:{id,name,phone},created:true}` with HTTP 201, or HTTP 200 and `created:false` for an existing matching name/phone. Conflicting matches return 409. The current upstream list is limited to 200 contacts; duplicate checking is best-effort, not an atomic uniqueness guarantee. Do not automatically retry an ambiguous creation failure: check the directory first.

Contact creation neither grants project access nor sends communications. Settings exposes the same operation under **Add Communications contact**.

For agent API access, issue a scoped, expiring HyperFlow API credential and supply it through a local environment variable or secret store. Use `Authorization: Bearer <HyperFlow key>`. Do not copy a Communications Service legacy key across tenants or commit credentials. HyperFlow keeps its upstream integration key server-side.
