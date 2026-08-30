import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, bearerToken, hasSharedSecret, requireAppMember } from '../../lib/apiAuth.js';
import { deleteTenantSchedule, listTenantSchedules, readTenantCommunicationsSettings, saveTenantSchedule } from '../../lib/serverStore.js';
import { runTenantSchedule, tickSchedules } from '../../lib/scheduler.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const action = typeof req.query.action === 'string' ? req.query.action : undefined;
  if (action === 'tick') {
    if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
    const configured = Boolean(process.env.SCHEDULER_SECRET || process.env.CRON_SECRET);
    const authorized = hasSharedSecret(req.headers['x-hyperflow-scheduler-secret'], process.env.SCHEDULER_SECRET)
      || hasSharedSecret(bearerToken(req), process.env.CRON_SECRET);
    if (!authorized) return res.status(configured ? 401 : 503).json({ error: configured ? 'Invalid scheduler authentication' : 'Scheduler secret is not configured' });
    try {
      return res.status(200).json({ ok: true, results: await tickSchedules() });
    } catch (error: any) {
      return res.status(500).json({ error: error?.message || String(error) });
    }
  }

  try {
    const member = await requireAppMember(req);
    if (action === 'run') {
      if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
      const id = String(req.body?.id || '');
      const schedule = (await listTenantSchedules(member.orgId)).find(item => item.id === id);
      if (!schedule) return res.status(404).json({ error: 'Schedule not found' });
      return res.status(200).json({ result: await runTenantSchedule(schedule, Date.now()) });
    }
    if (req.method === 'GET') return res.status(200).json({ data: await listTenantSchedules(member.orgId) });
    if (req.method === 'POST' || req.method === 'PATCH') {
      const settings = req.method === 'POST' ? await readTenantCommunicationsSettings(member.orgId) : undefined;
      const activity = req.body?.activity || 'communications_triage';
      const schedule = await saveTenantSchedule(member.orgId, {
        ...(req.body || {}),
        ...(req.method === 'POST' && activity === 'communications_triage' ? {
          policy: req.body?.policy || settings?.sendPolicy || 'draft_only',
          timezone: req.body?.timezone || settings?.timezone || 'Australia/Brisbane',
          connectionId: req.body?.connectionId || settings?.mailboxConnectionId || settings?.connectionId
        } : {})
      });
      return res.status(req.method === 'POST' ? 201 : 200).json({ schedule });
    }
    if (req.method === 'DELETE') {
      const id = String(req.query.id || req.body?.id || '');
      if (!id) return res.status(400).json({ error: 'id is required' });
      await deleteTenantSchedule(member.orgId, id);
      return res.status(204).end();
    }
    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error: any) {
    return res.status(error instanceof ApiAuthError ? error.status : 500).json({ error: error?.message || String(error) });
  }
}
