import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { listTenantSchedules } from '../../lib/serverStore.js';
import { runTenantSchedule } from '../../lib/scheduler.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const member = await requireAppMember(req);
    const id = String(req.body?.id || '');
    const schedule = (await listTenantSchedules(member.orgId)).find(item => item.id === id);
    if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
    // Manual runs use their own occurrence key and retain the same lease and
    // cursor guarantees as timer-triggered runs.
    return res.status(200).json({ result: await runTenantSchedule(schedule, Date.now()) });
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
