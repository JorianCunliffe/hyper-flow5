import type { VercelRequest, VercelResponse } from '@vercel/node';
import { advanceServerFlow } from '../../lib/serverFlow.js';
import { findProject, isServerStoreConfigured, listTenantSchedules } from '../../lib/serverStore.js';
import { runTenantSchedule } from '../../lib/scheduler.js';
import { ApiAuthError, hasSharedSecret, requireAppMember } from '../../lib/apiAuth.js';
import { listFlowRuns } from '../../lib/flowRunStore.js';
import { presentFlowRuns } from '../../lib/flowRunPresentation.js';

const queryValue = (value: string | string[] | undefined) => Array.isArray(value) ? value[0] : value;

/**
 * Advances a project's flow server-side. GET returns a bounded, sanitized run
 * history for operational debugging without exposing mutable run state.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!['GET', 'POST'].includes(req.method || '')) return res.status(405).json({ error: 'Method not allowed' });

  if (!isServerStoreConfigured()) {
    return res.status(503).json({ error: 'Server-side persistence is not configured' });
  }

  const source = req.method === 'GET' ? req.query : (req.body || {});
  const orgId = queryValue(source.orgId as string | string[] | undefined);
  const projectId = queryValue(source.projectId as string | string[] | undefined);
  if (!orgId || !projectId) return res.status(400).json({ error: 'orgId and projectId are required' });

  try {
    if (!hasSharedSecret(req.headers['x-webhook-secret'], process.env.WEBHOOK_SECRET)) {
      await requireAppMember(req, String(orgId));
    }
    const normalizedOrgId = String(orgId);
    const normalizedProjectId = String(projectId);
    const located = await findProject(normalizedOrgId, normalizedProjectId);
    if (!located) return res.status(404).json({ error: 'project_not_found' });

    if (req.method === 'GET') {
      const rawLimit = Number(queryValue(req.query.limit));
      const limit = Number.isFinite(rawLimit) ? Math.min(100, Math.max(1, Math.trunc(rawLimit))) : 25;
      const runs = await listFlowRuns(normalizedOrgId, normalizedProjectId, limit);
      return res.status(200).json({
        ok: true,
        projectId: normalizedProjectId,
        runs: presentFlowRuns(runs)
      });
    }

    const template = String(located.project.projectData?.project_template || '');
    if (['email_triage', 'daily_email_triage'].includes(template)) {
      const schedule = (await listTenantSchedules(normalizedOrgId)).find(item =>
        item.activity === 'communications_triage' && item.projectId === normalizedProjectId
      );
      if (!schedule) return res.status(409).json({ error: 'Email Triage project has no bound schedule' });
      const result = await runTenantSchedule(schedule, Date.now(), { advanceSchedule: false });
      const log = result.status === 'deferred'
        ? [`Email triage processed ${result.processedCount || 0} message(s); more backlog is safely queued.`]
        : result.status === 'completed'
          ? [`Email triage completed: ${result.processedCount || 0} message(s) processed.`]
          : [`Email triage ${result.status}: ${result.error || 'no work was completed'}`];
      if (result.status === 'failed') {
        return res.status(500).json({ error: result.error || 'Email triage failed', log, result });
      }
      return res.status(200).json({
        ok: true,
        projectId: normalizedProjectId,
        service: 'email_triage',
        result,
        log
      });
    }
    const outcome = await advanceServerFlow(normalizedOrgId, normalizedProjectId);
    if (!outcome.ok) return res.status(404).json({ error: outcome.reason });
    return res.status(200).json(outcome);
  } catch (e: any) {
    console.error('Server-side flow request failed', e);
    return res.status(e instanceof ApiAuthError ? e.status : 500).json({ error: e?.message || String(e) });
  }
}
