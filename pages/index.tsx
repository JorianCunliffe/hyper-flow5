export default function Home() {
  const endpoints = [
    {
      method: 'POST',
      path: '/api/twilio/voice',
      note: 'Twilio webhook — incoming call TwiML (set as Voice webhook in Twilio console)',
    },
    {
      method: 'POST',
      path: '/api/twilio/outbound-twiml',
      note: 'Twilio webhook — outbound call TwiML (auto-called by Twilio on answer)',
    },
    {
      method: 'POST',
      path: '/api/twilio/status',
      note: 'Twilio status callback',
    },
    {
      method: 'WS',
      path: '/api/twilio/stream',
      note: 'Twilio Media Streams ↔ OpenAI Realtime bridge (WebSocket)',
    },
    {
      method: 'POST',
      path: '/api/calls/outbound',
      note: 'Initiate an outbound call  { to, systemPrompt?, metadata? }',
    },
    {
      method: 'GET',
      path: '/api/calls',
      note: 'List calls  ?page&limit&direction&status&contact_id',
    },
    { method: 'GET', path: '/api/calls/:id', note: 'Get single call with full transcript' },
    {
      method: 'GET',
      path: '/api/contacts',
      note: 'List contacts  ?page&limit&search',
    },
    {
      method: 'POST',
      path: '/api/contacts',
      note: 'Create contact  { phone_number, name, email, company, notes, tags, custom_data }',
    },
    { method: 'GET', path: '/api/contacts/:id', note: 'Get contact + call history' },
    { method: 'PUT', path: '/api/contacts/:id', note: 'Update contact' },
    { method: 'DELETE', path: '/api/contacts/:id', note: 'Delete contact' },
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
      <h1 style={{ fontSize: 24, marginBottom: 4 }}>hyper-flow</h1>
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
          {endpoints.map((e) => (
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
          ))}
        </tbody>
      </table>
    </main>
  );
}
