import type { VercelRequest, VercelResponse } from '@vercel/node';
import { parseSignedJsonBody, verifyCommunicationsSignature } from '../lib/communications/webhook.js';
import { receiveExternalEvent } from '../lib/externalEvents.js';
import { serverStoreStatus } from '../lib/serverStore.js';

// Keep the exact bytes Communications signed. Object re-serialization is not a
// valid substitute because insignificant JSON whitespace changes the HMAC.
export const config = { api: { bodyParser: false } };

const readRawBody = async (req: VercelRequest): Promise<Buffer> => {
  const existing = (req as any).rawBody ?? req.body;
  if (Buffer.isBuffer(existing)) return existing;
  if (typeof existing === 'string') return Buffer.from(existing);
  if (existing !== undefined && existing !== null) {
    throw new Error('Raw request body is unavailable; JSON body parsing must be disabled');
  }
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = process.env.COMMUNICATIONS_WEBHOOK_SECRET;
  if (!secret) return res.status(503).json({ error: 'COMMUNICATIONS_WEBHOOK_SECRET is not configured' });

  let rawBody: Buffer;
  try { rawBody = await readRawBody(req); }
  catch (error: any) { return res.status(500).json({ error: error.message }); }

  if (!verifyCommunicationsSignature(rawBody, req.headers['x-communications-signature'], secret)) {
    return res.status(401).json({ error: 'Invalid or missing Communications signature' });
  }

  const storeStatus = serverStoreStatus();
  if (!storeStatus.ok) {
    console.error('External event inbox unavailable:', storeStatus.reason);
    return res.status(503).json({ error: 'Server-side persistence is not configured' });
  }

  try {
    const body = parseSignedJsonBody(rawBody);
    const outcome = await receiveExternalEvent({ ...body, source: body.source || 'communications' });
    return res.status(outcome.retryable ? 409 : 200).json(outcome);
  } catch (error: any) {
    if (/required|JSON object|valid JSON/.test(error?.message || '')) return res.status(400).json({ error: error.message });
    console.error('External event handler failed', error);
    return res.status(500).json({ error: 'Handler failed' });
  }
}
