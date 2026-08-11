import type { VercelRequest, VercelResponse } from '@vercel/node';
import { receiveExternalEvent } from '../lib/externalEvents.js';
import { serverStoreStatus } from '../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.COMMUNICATIONS_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'COMMUNICATIONS_API_KEY is not configured' });
  if (req.headers.authorization !== `Bearer ${apiKey}`) return res.status(403).json({ error: 'Forbidden' });

  const storeStatus = serverStoreStatus();
  if (!storeStatus.ok) {
    console.error('External event inbox unavailable:', storeStatus.reason);
    return res.status(503).json({ error: 'Server-side persistence is not configured' });
  }

  try {
    const outcome = await receiveExternalEvent(req.body);
    const status = outcome.retryable ? 409 : 200;
    return res.status(status).json(outcome);
  } catch (error: any) {
    if (/required|JSON object/.test(error?.message || '')) return res.status(400).json({ error: error.message });
    console.error('External event handler failed', error);
    return res.status(500).json({ error: 'Handler failed' });
  }
}
