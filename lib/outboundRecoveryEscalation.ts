import { createHash } from 'node:crypto';
import type { HumanAsk, ScheduleRun, TenantSchedule } from '../types.js';
import { createAsk } from './asks/createAsk.js';
import { dispatchStore, listRunDispatches, readActionDispatch } from './actionDispatch.js';
import { flowRunIdForOccurrence, materializeFlowRunProject, updateFlowRunFromProject } from './flowRun.js';
import { readFlowRun, saveFlowRun } from './flowRunStore.js';
import { findProject, transactWorkspaceConfiguration } from './serverStore.js';
import { upsertAsk } from './humanAsk.js';

export function recoveryAsk(input: { operationId: string; nodeId: string; projectId: string; providerOutcome: string; now: number; assignees?: string[] }): HumanAsk {
  return createAsk({ taskId: input.nodeId, projectId: input.projectId, runId: input.operationId,
    askId: `recovery_${createHash('sha256').update(input.operationId).digest('hex').slice(0, 32)}`,
    responseType: 'question', channels: ['web'], assignees: input.assignees, now: input.now,
    question: `Outbound action failed — manual review required. Provider outcome: ${input.providerOutcome}. Review the original operation ${input.operationId} and record the evidence here. Acknowledging this Ask does not retry the call or clear its receipt.`,
    responseContract: { automaticProgress: 'never', reviewRequired: true, allowedDecisions: [] }
  });
}

/** Persist the Ask before the terminal schedule state. Every retry uses the same Ask identity. */
const recoveryDependencies = { listRunDispatches, readActionDispatch, findProject, readFlowRun, saveFlowRun,
  transact: dispatchStore.transact, transactWorkspaceConfiguration };
export async function escalateOutboundRecovery(schedule: TenantSchedule, occurrence: ScheduleRun, now = Date.now(), dependencies = recoveryDependencies): Promise<string | null> {
  if (!schedule.projectId) throw new Error('Outbound recovery requires its owning project');
  const flowId = occurrence.flowRunId || flowRunIdForOccurrence(schedule.orgId, schedule.projectId, occurrence.id);
  const operations = await dependencies.listRunDispatches(schedule.orgId, flowId);
  const operation = occurrence.recoveryOperationId
    ? await dependencies.readActionDispatch(schedule.orgId, occurrence.recoveryOperationId)
    : operations.filter(row => !row.terminal && !row.outcome && row.request.taskType === 'outgoing_call').sort((a,b) => b.updatedAt - a.updatedAt)[0];
  if (!operation || operation.orgId !== schedule.orgId || operation.projectId !== schedule.projectId
      || (operation.occurrenceId && operation.occurrenceId !== occurrence.id)) throw new Error('Original outbound operation could not be identified for review');
  const located = await dependencies.findProject(schedule.orgId, schedule.projectId);
  let run = await dependencies.readFlowRun(schedule.orgId, schedule.projectId, flowId);
  if (!located || !run) throw new Error('Original workflow is unavailable for recovery escalation');
  const node = run.state.milestones.find(node => node.id === operation.nodeId);
  if (!node) throw new Error('Original action is unavailable for recovery escalation');
  const proposed = recoveryAsk({operationId: operation.id, nodeId: node.id, projectId: schedule.projectId,
    providerOutcome: occurrence.providerOutcome || 'unknown', now,
    assignees: node.reviewPolicy?.reviewers || (node.subtasks || []).map(task => task.accountable).filter(Boolean) as string[] });
  const ask = (node.asks || []).find(ask => ask.id === proposed.id) || proposed;
  // Keep the provider receipt unresolved. Only the workflow action is terminally failed.
  const held = await dependencies.transact(schedule.orgId, operation.id, current => {
    if (!current) throw new Error('Original dispatch disappeared');
    if (current.terminal || current.outcome) return current;
    return { ...current, manualReviewRequired: true, providerCode: occurrence.providerCode };
  });
  if ((held.terminal || held.outcome) && !held.manualReviewRequired) return null;
  if (!run.outboundRecoveryHold) {
    const project = materializeFlowRunProject(located.project, run);
    project.milestones = project.milestones.map(item => item.id !== node.id ? item : {
      ...upsertAsk(item, ask), actionConfig: { ...item.actionConfig, template: item.actionConfig?.template || '', lastRun: {
        ...item.actionConfig?.lastRun, id: operation.id, at: now, status: 'error', executionState: 'failed',
        error: 'Outbound action failed — manual review required', scheduleOccurrenceId: occurrence.id,
        output: { provider_outcome: occurrence.providerOutcome || 'unknown', manual_review_required: true }
      } }
    });
    run = await dependencies.saveFlowRun({ ...updateFlowRunFromProject(run, project, now), status: 'failed', completedAt: now,
      outboundRecoveryHold: { operationId: operation.id, askId: ask.id, at: now } });
  }
  // Add to the existing in-app Ask inbox, without overwriting a newer occurrence's state.
  const storedAsk = run.state.milestones.flatMap(node => node.asks || []).find(item => item.id === ask.id) || ask;
  await dependencies.transactWorkspaceConfiguration(schedule.orgId, workspace => ({ ...workspace,
    dataRevision: Number(workspace.dataRevision || 0) + 1, lastUpdated: now,
    projects: (workspace.projects || []).map((project: any) => String(project.id) !== String(schedule.projectId) ? project : {
      ...project, revision: Number(project.revision || 0) + 1,
      milestones: (project.milestones || []).map((item: any) => item.id !== operation.nodeId ? item
        : upsertAsk(item, (item.asks || []).find((a: HumanAsk) => a.id === storedAsk.id) || storedAsk))
    })
  }));
  return storedAsk.id;
}
