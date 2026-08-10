import type { VercelRequest, VercelResponse } from '@vercel/node';
import { advanceServerFlow } from '../../lib/serverFlow.js';
import { isServerStoreConfigured } from '../../lib/serverStore.js';

/**
 * Advances a project's flow server-side. Useful for a scheduled sweep (retrying
 * failed actions, firing reminders) and for triggering an advance from anywhere
 * that isn't the browser.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.WEBHOOK_SECRET;
  if (!expected) return res.status(503).json({ error: 'WEBHOOK_SECRET is not configured' });
  const provided = req.headers['x-webhook-secret'];
  if (provided !== expected) return res.status(403).json({ error: 'Forbidden' });

  if (!isServerStoreConfigured()) {
    return res.status(503).json({ error: 'Server-side persistence is not configured' });
  }

  const { orgId, projectId } = req.body || {};
  if (!orgId || !projectId) return res.status(400).json({ error: 'orgId and projectId are required' });

  try {
    const outcome = await advanceServerFlow(String(orgId), String(projectId));
    if (!outcome.ok) return res.status(404).json({ error: outcome.reason });
    return res.status(200).json(outcome);
  } catch (e: any) {
    console.error('Server-side advance failed', e);
    return res.status(500).json({ error: e?.message || String(e) });
  }
}
