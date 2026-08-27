import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeTask } from '../../lib/executeTask.js';
import { readTenantCommunicationsSettings } from '../../lib/serverStore.js';
import { ApiAuthError, requireAppMember } from '../../lib/apiAuth.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { taskType, templateFile, projectData, correlation, revision } = req.body || {};
    const requestedOrgId = typeof correlation?.orgId === 'string' ? correlation.orgId : undefined;
    const member = await requireAppMember(req, requestedOrgId);
    const trustedCorrelation = { ...correlation, orgId: member.orgId };
    let communicationsFromNumber: string | undefined;
    if (trustedCorrelation.orgId) {
      try { communicationsFromNumber = (await readTenantCommunicationsSettings(trustedCorrelation.orgId)).fromNumber; } catch { /* project/env fallback */ }
    }
    // The callback secret and public base URL stay server-side; callers only
    // supply the correlation ids that identify the run.
    const result = await executeTask(taskType, templateFile, projectData, {
      webhookBaseUrl: process.env.PUBLIC_BASE_URL,
      communicationsFromNumber,
      correlation: trustedCorrelation,
      revision
    });
    res.status(result.httpStatus).json(result.body);
  } catch (e: any) {
    res.status(e instanceof ApiAuthError ? e.status : 500).json({ error: e?.message || String(e) });
  }
}
