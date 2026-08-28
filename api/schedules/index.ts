import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';
import { deleteTenantSchedule, listTenantSchedules, readTenantCommunicationsSettings, saveTenantSchedule } from '../../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    if (req.method === 'GET') return res.status(200).json({ data: await listTenantSchedules(member.orgId) });
    if (req.method === 'POST' || req.method === 'PATCH') {
      const settings = req.method === 'POST' ? await readTenantCommunicationsSettings(member.orgId) : undefined;
      const schedule = await saveTenantSchedule(member.orgId, {
        ...(req.body || {}),
        ...(req.method === 'POST' ? {
          policy: req.body?.policy || settings?.sendPolicy || 'draft_only',
          timezone: req.body?.timezone || settings?.timezone || 'Australia/Brisbane',
          connectionId: req.body?.connectionId || settings?.connectionId
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
