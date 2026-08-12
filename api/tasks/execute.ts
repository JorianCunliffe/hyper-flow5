import type { VercelRequest, VercelResponse } from '@vercel/node';
import { executeTask } from '../../lib/executeTask.js';
import { readTenantCommunicationsSettings } from '../../lib/serverStore.js';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { taskType, templateFile, projectData, correlation, revision } = req.body || {};
    let communicationsFromNumber: string | undefined;
    if (correlation?.orgId) {
      try { communicationsFromNumber = (await readTenantCommunicationsSettings(correlation.orgId)).fromNumber; } catch { /* project/env fallback */ }
    }
    // The callback secret and public base URL stay server-side; callers only
    // supply the correlation ids that identify the run.
    const result = await executeTask(taskType, templateFile, projectData, {
      webhookBaseUrl: process.env.PUBLIC_BASE_URL,
      callbackSecret: process.env.WEBHOOK_SECRET,
      communicationsFromNumber,
      correlation,
      revision
    });
    res.status(result.httpStatus).json(result.body);
  } catch (e) {
    res.status(500).json({ error: String(e) });
  }
}
