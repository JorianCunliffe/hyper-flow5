export default function Home() {
  const endpoints = [
    {
      group: 'Twilio Webhooks',
      method: 'POST',
      path: '/api/twilio/voice',
      note: 'Incoming call TwiML — set as Voice webhook in Twilio console',
    },
    {
      group: 'Twilio Webhooks',
      method: 'POST',
      path: '/api/twilio/sms',
      note: 'Incoming SMS webhook — set as SMS webhook in Twilio console',
    },
    {
      group: 'Twilio Webhooks',
      method: 'POST',
      path: '/api/twilio/outbound-twiml',
      note: 'Outbound call TwiML — auto-called by Twilio on answer',
    },
    {
      group: 'Twilio Webhooks',
      method: 'POST',
      path: '/api/twilio/status',
      note: 'Call status callback',
    },
    {
      group: 'Twilio Webhooks',
      method: 'WS',
      path: '/api/twilio/stream',
      note: 'Twilio Media Streams ↔ OpenAI Realtime bridge (WebSocket)',
    },
    {
      group: 'Calls',
      method: 'POST',
      path: '/api/calls/outbound',
      note: 'Initiate outbound call  { to, systemPrompt?, phone_config_id?, metadata? }',
    },
    {
      group: 'Calls',
      method: 'GET',
      path: '/api/calls',
      note: 'List calls  ?page&limit&direction&status&contact_id',
    },
    { group: 'Calls', method: 'GET', path: '/api/calls/:id', note: 'Get call with full transcript' },
    {
      group: 'SMS',
      method: 'POST',
      path: '/api/sms/send',
      note: 'Send outbound SMS  { to, message, from? | phone_config_id? }',
    },
    {
      group: 'SMS',
      method: 'GET',
      path: '/api/sms/threads',
      note: 'List SMS threads  ?page&limit&twilio_number&phone_number',
    },
    {
      group: 'SMS',
      method: 'GET',
      path: '/api/sms/threads/:id',
      note: 'Get thread with messages  ?limit',
    },
    {
      group: 'Phone Configs',
      method: 'GET',
      path: '/api/phone-configs',
      note: 'List all per-number AI configurations',
    },
    {
      group: 'Phone Configs',
      method: 'POST',
      path: '/api/phone-configs',
      note: 'Create config  { twilio_number, name, call_system_prompt?, sms_system_prompt?, enabled_tools?, … }',
    },
    { group: 'Phone Configs', method: 'GET', path: '/api/phone-configs/:id', note: 'Get config' },
    { group: 'Phone Configs', method: 'PUT', path: '/api/phone-configs/:id', note: 'Update config' },
    { group: 'Phone Configs', method: 'DELETE', path: '/api/phone-configs/:id', note: 'Delete config' },
    {
      group: 'Contacts',
      method: 'GET',
      path: '/api/contacts',
      note: 'List contacts  ?page&limit&search',
    },
    {
      group: 'Contacts',
      method: 'POST',
      path: '/api/contacts',
      note: 'Create contact  { phone_number, name, email, company, notes, tags, custom_data }',
    },
    { group: 'Contacts', method: 'GET', path: '/api/contacts/:id', note: 'Get contact + call history' },
    { group: 'Contacts', method: 'PUT', path: '/api/contacts/:id', note: 'Update contact' },
    { group: 'Contacts', method: 'DELETE', path: '/api/contacts/:id', note: 'Delete contact' },
  ];

  const colors: Record<string, string> = {
    GET: '#3b82f6',
    POST: '#22c55e',
    PUT: '#f59e0b',
    DELETE: '#ef4444',
    WS: '#8b5cf6',
  };

  return (
    <main style={{ fontFamily: 'monospace', maxWidth: 760, margin: '48px auto', padding: '0 16px' }}>
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>twilio-openai-realtime</h1>
      <p style={{ color: '#6b7280', marginBottom: 32 }}>
        Twilio + OpenAI Realtime voice API — authenticate with{' '}
        <code style={{ background: '#f3f4f6', padding: '2px 6px', borderRadius: 4 }}>
          x-api-key
        </code>{' '}
        header.
      </p>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e5e7eb' }}>
            <th style={{ textAlign: 'left', padding: '6px 8px', width: 70 }}>Method</th>
            <th style={{ textAlign: 'left', padding: '6px 8px', width: 240 }}>Path</th>
            <th style={{ textAlign: 'left', padding: '6px 8px' }}>Description</th>
          </tr>
        </thead>
        <tbody>
          {endpoints.map((e, i) => {
            const showGroup = i === 0 || endpoints[i - 1].group !== e.group;
            return (
              <>
                {showGroup && (
                  <tr key={`group-${e.group}`}>
                    <td
                      colSpan={3}
                      style={{
                        padding: '14px 8px 4px',
                        fontSize: 11,
                        fontWeight: 700,
                        textTransform: 'uppercase',
                        letterSpacing: '0.08em',
                        color: '#9ca3af',
                        borderTop: i === 0 ? undefined : '1px solid #e5e7eb',
                      }}
                    >
                      {e.group}
                    </td>
                  </tr>
                )}
                <tr key={e.path + e.method} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 8px' }}>
                    <span
                      style={{
                        background: colors[e.method] ?? '#6b7280',
                        color: '#fff',
                        padding: '2px 6px',
                        borderRadius: 4,
                        fontSize: 11,
                        fontWeight: 700,
                      }}
                    >
                      {e.method}
                    </span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    <code>{e.path}</code>
                  </td>
                  <td style={{ padding: '6px 8px', color: '#374151' }}>{e.note}</td>
                </tr>
              </>
            );
          })}
        </tbody>
      </table>
    </main>
  );
}
