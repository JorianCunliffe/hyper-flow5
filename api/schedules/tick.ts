import type { VercelRequest, VercelResponse } from '@vercel/node';
import { bearerToken, hasSharedSecret } from '../../lib/apiAuth.js';
import { tickSchedules } from '../../lib/scheduler.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const headerSecret = req.headers['x-hyperflow-scheduler-secret'];
  const configured = Boolean(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET);
  const authorized = hasSharedSecret(headerSecret, process.env.SCHEDULER_SECRET)
    || hasSharedSecret(bearerToken(req), process.env.CRON_SECRET);
  if (!authorized) return res.status(configured ? 401 : 503).json({ error: configured ? 'Invalid scheduler authentication' : 'Scheduler secret is not configured' });
  try {
    const results = await tickSchedules();
    return res.status(200).json({ ok: true, results });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || String(error) });
  }
}
