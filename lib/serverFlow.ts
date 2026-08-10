import { HumanAsk, HumanResponse } from '../types';
import { executeTask } from './executeTask';
import { ActionExecutor, advanceProjectFlow, resolvePendingRun } from './flowOrchestrator';
import { applyAskToProject, findAskByToken, recordAskResponse, upsertAsk } from './humanAsk';
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
    },
    revision: ctx.revision
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

export interface RespondOutcome extends AdvanceOutcome {
  askStatus?: HumanAsk['status'];
}

/**
 * Records a human's answer, folds it into the project, and advances the flow.
 *
 * This is the single place an answer becomes project state, whichever channel it
 * arrived on — web, email reply, SMS or voice all normalise into a HumanResponse
 * and land here.
 */
export const respondToAsk = async (
  orgId: string,
  projectId: string,
  token: string,
  response: HumanResponse
): Promise<RespondOutcome> => {
  const located = await findProject(orgId, projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const found = findAskByToken(located.project, token);
  if (!found) return { ok: false, reason: 'ask_not_found' };
  if (found.ask.status === 'cancelled') return { ok: false, reason: 'ask_cancelled' };
  if (found.ask.status === 'answered') {
    // Not an error: a reviewer clicking twice, or a provider retrying, should be
    // inert rather than reopening settled work.
    return { ok: false, reason: 'already_answered', askStatus: 'answered' };
  }

  const updatedAsk = recordAskResponse(found.ask, response);
  let project = {
    ...located.project,
    milestones: located.project.milestones.map(m => (m.id === found.ask.nodeId ? upsertAsk(m, updatedAsk) : m))
  };

  if (updatedAsk.status === 'answered') {
    project = applyAskToProject(project, updatedAsk.id);
  }

  const advanced = await advanceProjectFlow(project, serverExecutor, {
    orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });

  await writeProject(orgId, located.index, advanced.project);

  return {
    ok: true,
    askStatus: updatedAsk.status,
    log: advanced.log,
    pending: advanced.pending
  };
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
