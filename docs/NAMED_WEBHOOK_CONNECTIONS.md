# Named read-only webhook connections

Webhook nodes can read credential-bearing endpoints without saving the URL in project data, templates, dispatch records or model context. Existing ordinary URL webhooks are unchanged.

Configure two server-only environment variables in Vercel, scoped to Production (and only other environments that genuinely need access):

1. `WEBHOOK_CONNECTIONS_JSON`: a registry of connection names and exact allowed organizations/projects. This contains no credentials.
2. The registry's `urlEnv`, starting with `WEBHOOK_SECRET_`: the full credential-bearing HTTPS URL, entered as a sensitive secret. Never use a `VITE_` prefix.

For Cairns Morning Run v2, the registry is:

```json
{"cairns-room-availability":{"orgId":"org_1786407621909","projectIds":["1790716687348"],"urlEnv":"WEBHOOK_SECRET_CAIRNS_AVAILABILITY","responsePath":["details","userMessage"],"successField":"code","successValue":"success"}}
```

Enter the actual Zoho URL as `WEBHOOK_SECRET_CAIRNS_AVAILABILITY`. Do not paste it into the workflow editor, chat, documentation or a commit. A new deployment is required to pick up changed environment variables.

The node template is:

```json
{"connection_name":"cairns-room-availability","method":"GET"}
```

The action validates trusted execution scope before accessing the secret. No URL/header/payload overrides are allowed. Existing HTTPS/DNS/response-size controls apply; redirects are rejected. Provider error text is not surfaced. Only the configured response subtree is returned, alongside connection name, HTTP status and fetch timestamp. A missing subtree, null response, provider failure, malformed JSON or known credential reflected in the selected response blocks the action. An empty array or empty string is preserved as a successful result, not confused with failure.

The Zoho success discriminator and response path must be confirmed against a fresh response. The historically observed room list is at `details.userMessage`; it describes availability now, not room capacity, future dates or inspection bookings.

To verify: keep the workflow's setup hold active, run only the read-only availability node, inspect returned room evidence and timestamp, and confirm saved output contains no credential. This isolated check does not establish full workflow acceptance. Contact/draft/booking tests remain separate.
