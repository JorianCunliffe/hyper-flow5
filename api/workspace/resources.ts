import type { VercelRequest, VercelResponse } from '@vercel/node';
import { ApiAuthError, requireAppMember, requireProjectInTenant } from '../../lib/apiAuth.js';
import { readProjectWorkspaceResources, saveProjectWorkspaceResources } from '../../lib/workspaceResourceCatalog.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const member = await requireAppMember(req);
    const projectId = String(req.method === 'GET' ? req.query.projectId || '' : req.body?.projectId || '').trim();
    await requireProjectInTenant(member.orgId, projectId);

    if (req.method === 'GET') {
      return res.status(200).json({ resources: await readProjectWorkspaceResources(member.orgId, projectId) });
    }
    if (req.method !== 'PATCH') return res.status(405).json({ error: 'Method not allowed' });
    if (!['owner', 'admin'].includes(member.role)) return res.status(403).json({ error: 'Administrator membership required' });
    const resources = await saveProjectWorkspaceResources(member.orgId, projectId, req.body?.resources || []);
    return res.status(200).json({ resources });
  } catch (error: any) {
    if (error instanceof ApiAuthError) return res.status(error.status).json({ error: error.message });
    const message = String(error?.message || error);
    if (/workspace resource|google sheet range/i.test(message)) return res.status(400).json({ error: message });
    console.error('Workspace resource API failed', error);
    return res.status(500).json({ error: 'Workspace resource request failed' });
  }
}
