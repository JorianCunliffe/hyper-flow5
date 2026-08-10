import { executeTask } from './executeTask';
import { ActionExecutor, advanceProjectFlow, resolvePendingRun } from './flowOrchestrator';
import { findProject, writeProject } from './serverStore';

/**
 * Server-side flow execution. Actions are executed in-process rather than over
 * HTTP — there is no browser in this path, which is the whole point: a human
 * answering by phone (and, later, email or SMS) moves the flow forward whether
 * or not anyone has the app open.
 */

export const serverExecutor: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
  const result = await executeTask(taskType, templateFile, projectData, {
    webhookBaseUrl: process.env.PUBLIC_BASE_URL,
    callbackSecret: process.env.WEBHOOK_SECRET,
    correlation: {
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      nodeId: ctx.nodeId,
      runId: ctx.runId
    }
  });

  const body = result.body || {};
  if (result.httpStatus >= 400 || (body.status && body.status !== 'success')) {
    return { status: 'error', error: body.error || `Action failed (HTTP ${result.httpStatus})`, logs: body.logs };
  }

  return {
    status: body.pending ? 'pending' : 'success',
    output: body.output,
    logs: body.logs,
    externalId: body.externalId
  };
};

export interface AdvanceOutcome {
  ok: boolean;
  reason?: string;
  log?: string[];
  pending?: string[];
}

/** Loads a project, advances it as far as it will go, and persists the result. */
export const advanceServerFlow = async (orgId: string, projectId: string): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const { project, log, pending } = await advanceProjectFlow(located.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  await writeProject(orgId, located.index, project);
  return { ok: true, log, pending };
};

/**
 * Resolves an action run that was waiting on a provider callback, then advances
 * the flow so downstream nodes react to whatever the human just told us.
 */
export const resolveCallbackAndAdvance = async (
  orgId: string,
  projectId: string,
  match: { runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const resolved = resolvePendingRun(located.project, match, result);
  if (!resolved) return { ok: false, reason: 'no_matching_pending_run' };

  const advanced = await advanceProjectFlow(resolved.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  await writeProject(orgId, located.index, advanced.project);
  return { ok: true, log: [...resolved.log, ...advanced.log], pending: advanced.pending };
};
