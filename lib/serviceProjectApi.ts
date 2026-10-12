import {
  listTenantProjects, listTenantSchedules, listWorkspaceConnectionRefs,
  readSchedulerHealth, listScheduleRuns, listTenantTriageDigests,
  readServiceSetupDraft, saveServiceSetupDraft, type AuthenticatedMember,
} from './serverStore.js';
import { createCommunicationsClient } from './communications/client.js';
import { validateServiceSetup, type ServiceSetupInput } from './serviceSetup.js';

export const serviceProjectDependencies = {
  listTenantProjects, listTenantSchedules, listWorkspaceConnectionRefs,
  readSchedulerHealth, listScheduleRuns, listTenantTriageDigests,
  readServiceSetupDraft, saveServiceSetupDraft, validateServiceSetup,
  listMailboxes: (org: string) => createCommunicationsClient().listMailboxes(org),
};
export const SERVICE_PROJECT_ROUTES = {
  '/api/service-projects/setup-draft': 'service_setup_draft',
  '/api/service-projects/validate': 'service_setup_validate',
  '/api/service-projects/status': 'service_setup_status',
} as const;

/** Shared by Express and Vercel, after identical tenant/scoped authentication. */
export async function serviceProjectRequest(
  action: string,
  req: { method?: string; query?: any; body?: any },
  member: AuthenticatedMember,
  deps = serviceProjectDependencies,
) {
  const result = (status: number, body: any) => ({ status, body });
  const q = req.query || {}, b = req.body || {};
  if (action === 'service_setup_draft') {
    const id = String(q.id || b.id || '').trim();
    if (req.method === 'GET') {
      if (!id) return result(400, { error: 'id is required' });
      const draft = await deps.readServiceSetupDraft(member.orgId, member.uid, id);
      return draft ? result(200, { draft }) : result(404, { error: 'Setup draft was not found or has expired' });
    }
    if (req.method === 'POST' || req.method === 'PUT') {
      const template = b.template === 'daily_coaching' ? 'daily_coaching' : b.template === 'email_triage' ? 'email_triage' : null;
      if (!template) return result(400, { error: 'template must be email_triage or daily_coaching' });
      const draft = await deps.saveServiceSetupDraft(member.orgId, member.uid, { id: id || undefined, template, data: b.data || {} });
      return result(req.method === 'POST' ? 201 : 200, { draft });
    }
    return result(405, { error: 'Method not allowed' });
  }
  if (action === 'service_setup_validate') {
    if (req.method !== 'POST') return result(405, { error: 'Method not allowed' });
    const input = b.setup as ServiceSetupInput;
    if (!input || !['email_triage', 'daily_coaching'].includes(input.template)) return result(400, { error: 'A valid service setup is required' });
    const validation = await deps.validateServiceSetup(member.orgId, input);
    return result(validation.ready ? 200 : 422, { validation });
  }
  if (action !== 'service_setup_status') return result(404, { error: 'Unknown service-project operation' });
  if (req.method !== 'GET') return result(405, { error: 'Method not allowed' });
  const projectId = String(q.projectId || '').trim();
  let mailboxStatus: 'available' | 'unavailable' = 'available';
  const [projects, schedules, mailboxes, workspaces, scheduler] = await Promise.all([
    deps.listTenantProjects(member.orgId), deps.listTenantSchedules(member.orgId),
    deps.listMailboxes(member.orgId).catch(() => { mailboxStatus = 'unavailable'; return []; }),
    deps.listWorkspaceConnectionRefs(member.orgId), deps.readSchedulerHealth(),
  ]);
  const project = projects.find(item => String(item.id) === projectId);
  if (projectId && !project) return result(404, { error: 'Project not found' });
  // GET must never attach or disable schedules, including for read-scoped clients.
  const unbound = schedules.filter(item => item.activity === 'communications_triage' && !item.projectId);
  const projectSchedules = projectId ? schedules.filter(item => item.projectId === projectId) : schedules;
  const runs = projectSchedules.length ? await deps.listScheduleRuns(member.orgId, projectSchedules[0].id, 20) : [];
  const digests = projectId ? (await deps.listTenantTriageDigests(member.orgId, 30)).filter(item => item.projectId === projectId) : [];
  const overdue = projectSchedules.some(item => item.enabled && item.nextRunAt < Date.now() - 10 * 60_000);
  const catchingUp = overdue && ['running', 'partial'].includes(String(runs[0]?.status || ''));
  const recoveryHeld = projectSchedules.some(item=>item.recoveryPendingId) || (!runs[0]?.recoveryResolution && !!(runs[0]?.recoveryReviewedAt || runs[0]?.manualReviewRequired || runs[0]?.status==='blocked'));
  return result(200, {
    project: project || null, schedules: projectSchedules, mailboxes, mailboxStatus, workspaces,
    lastRun: runs[0] || null, lastDigest: digests[0] || null,
    scheduler: {
      ...scheduler, overdue, catchingUp,
      warning: overdue ? recoveryHeld ? 'This occurrence is held for recovery. Use Resolve held run to review it; scheduler ticks do not release it.' : catchingUp
        ? 'Mailbox backlog catch-up is in progress. Queued batches will continue on scheduler ticks.'
        : 'A project schedule is overdue. Check the five-minute scheduler helper.' : null,
    },
    upgradeRequired: unbound.length > 0,
    unboundScheduleIds: unbound.map(item => item.id),
    validationFailures: project?.projectData?.service_validation_failures || [],
  });
}
