import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeDurableTask } from '../../lib/serverExecutor.js';
import { ApiAuthError, requireAppMember, requireProjectInTenant } from '../../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { taskType, templateFile, projectData, correlation, revision } = req.body || {};
    const requestedOrgId = typeof correlation?.orgId === 'string' ? correlation.orgId : undefined;
    const member = await requireAppMember(req, requestedOrgId);
    await requireProjectInTenant(member.orgId, correlation?.projectId);
    const trustedCorrelation = { ...correlation, orgId: member.orgId };
    const result = await executeDurableTask(taskType, templateFile, projectData, {
      orgId: member.orgId, projectId: trustedCorrelation.projectId,
      nodeId: trustedCorrelation.nodeId, runId: trustedCorrelation.runId, revision
    });
    res.status(result.httpStatus).json(result.body);
  } catch (e: any) {
    res.status(e instanceof ApiAuthError ? e.status : e?.recoverable ? 503 : 500).json({ error: e?.message || String(e) });
  }
}
