import { createHmac, randomUUID } from 'node:crypto';

const required = (name) => {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const baseUrl = required('HYPERFLOW_SMOKE_URL').replace(/\/$/, '');
const secret = required('COMMUNICATIONS_WEBHOOK_SECRET');
const tenantId = required('HYPERFLOW_SMOKE_TENANT_ID');
const endpoint = new URL('/api/events', baseUrl);
if (endpoint.protocol !== 'https:') throw new Error('HYPERFLOW_SMOKE_URL must use HTTPS');

const bypass = String(process.env.HYPERFLOW_VERCEL_AUTOMATION_BYPASS_SECRET || '').trim();
const protectionHeaders = bypass ? { 'x-vercel-protection-bypass': bypass } : {};
const eventId = String(process.env.HYPERFLOW_SMOKE_EVENT_ID || `evt_smoke_${randomUUID().replaceAll('-', '')}`).trim();
const body = JSON.stringify({
  contract_version: '2.0',
  tenant_id: tenantId,
  event_id: eventId,
  type: 'communication.created',
  source: 'communications',
  occurred_at: new Date().toISOString(),
  correlation: { tenant_id: tenantId },
  payload: { smoke_test: true }
});

const post = async (headers, requestBody = body) => {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...protectionHeaders, ...headers },
    body: requestBody,
    redirect: 'manual',
    signal: AbortSignal.timeout(15_000)
  });
  const text = (await response.text()).slice(0, 64 * 1024);
  let parsed;
  try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }
  return { response, parsed, text };
};

const signedHeaders = () => {
  const timestamp = String(Math.floor(Date.now() / 1000));
  return {
    'x-communications-timestamp': timestamp,
    'x-communications-signature-v2': `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`
  };
};

const unsigned = await post({}, '{}');
if (unsigned.response.status !== 401) {
  throw new Error(`Unsigned probe expected HyperFlow 401, received ${unsigned.response.status}${unsigned.response.status >= 300 && unsigned.response.status < 400 ? ' redirect' : ''}`);
}

const first = await post(signedHeaders());
if (first.response.status !== 200 || first.parsed?.ok !== true || first.parsed?.duplicate === true) {
  throw new Error(`Signed fixture was not accepted: HTTP ${first.response.status} ${first.text}`);
}

const duplicate = await post(signedHeaders());
if (duplicate.response.status !== 200 || duplicate.parsed?.duplicate !== true) {
  throw new Error(`Duplicate fixture was not idempotent: HTTP ${duplicate.response.status} ${duplicate.text}`);
}

console.log(JSON.stringify({
  ok: true,
  endpoint: endpoint.toString(),
  event_id: eventId,
  unsigned_status: unsigned.response.status,
  signed_status: first.response.status,
  duplicate: true,
  vercel_bypass_used: Boolean(bypass)
}, null, 2));
