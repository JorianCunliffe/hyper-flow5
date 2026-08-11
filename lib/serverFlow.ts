import { HumanAsk } from '../types.js';
import { advanceProjectFlow, resolvePendingRun } from './flowOrchestrator.js';
import { findAskByToken } from './humanAsk.js';
import { serverExecutor } from './serverExecutor.js';
import { findProject, writeProject } from './serverStore.js';
import { deliverRaisedAsks } from './asks/deliverRaisedAsks.js';
export { respondToAsk } from './asks/respondToAsk.js';

/**
 * Server-side flow execution. Actions are executed in-process rather than over
 * HTTP — there is no browser in this path, which is the whole point: a human
 * answering by phone (and, later, email or SMS) moves the flow forward whether
 * or not anyone has the app open.
 */

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

  const { project, log, pending, askedFor } = await advanceProjectFlow(located.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  const delivered = await deliverRaisedAsks(project, orgId, askedFor);
  await writeProject(orgId, located.index, delivered.project);
  return { ok: true, log: [...log, ...delivered.log], pending };
};

export interface AskLookup {
  ask: HumanAsk;
  nodeName: string;
  projectName: string;
}

/**
 * Reads an ask by its token. The token is the capability — it authorises
 * answering this one ask and nothing else, so this deliberately returns only
 * what a reviewer needs to see, never the surrounding project.
 */
export const readAskByToken = async (
  orgId: string,
  projectId: string,
  token: string
): Promise<AskLookup | null> => {
  const located = await findProject(orgId, projectId);
  if (!located) return null;

  const found = findAskByToken(located.project, token);
  if (!found) return null;

  return { ask: found.ask, nodeName: found.node.name, projectName: located.project.name };
};

/**
 * Resolves an action run that was waiting on a provider callback, then advances
 * the flow so downstream nodes react to whatever the human just told us.
 */
export const resolveCallbackAndAdvance = async (
  orgId: string,
  projectId: string,
  match: { nodeId?: string; runId?: string; externalId?: string },
  result: { status: 'success' | 'error'; output?: any; logs?: string[]; error?: string; resolvedBy: string }
): Promise<AdvanceOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const resolved = resolvePendingRun(located.project, match, result);
  if (!resolved) {
    // Legacy workflow definitions can put executable task types on subtasks.
    // They use the same explicit correlation and waiting lifecycle as action
    // nodes, so complete them deterministically instead of leaving an orphaned
    // communication behind.
    let found = false;
    const milestones = located.project.milestones.map(m => ({
      ...m,
      subtasks: m.subtasks.map(task => {
        if (found || !match.nodeId || task.id !== match.nodeId) return task;
        if (match.runId && task.externalRunId !== match.runId) return task;
        if (match.externalId && task.externalExecutionId !== match.externalId) return task;
        if (task.status === 'Completed') return task;
        found = true;
        return {
          ...task,
          status: result.status === 'success' ? 'Completed' : 'Not Complete',
          taskOutput: { ...(task.taskOutput || {}), ...(result.output || {}) },
          evaluationResult: result.status === 'success' ? 'Completed from external event' : (result.error || 'External communication failed')
        };
      })
    }));
    if (!found) return { ok: false, reason: 'no_matching_pending_run' };

    const output = result.status === 'success' && result.output && typeof result.output === 'object'
      ? result.output
      : {};
    const subtaskProject = {
      ...located.project,
      milestones,
      projectData: { ...(located.project.projectData || {}), ...output }
    };
    const advanced = await advanceProjectFlow(subtaskProject, serverExecutor, {
      orgId,
      webhookBaseUrl: process.env.PUBLIC_BASE_URL
    });
    const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
    await writeProject(orgId, located.index, delivered.project);
    return {
      ok: true,
      log: ['Subtask completed from external event', ...advanced.log, ...delivered.log],
      pending: advanced.pending
    };
  }

  const advanced = await advanceProjectFlow(resolved.project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, orgId, advanced.askedFor);
  await writeProject(orgId, located.index, delivered.project);
  return { ok: true, log: [...resolved.log, ...advanced.log, ...delivered.log], pending: advanced.pending };
};
