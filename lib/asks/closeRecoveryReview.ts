import { createHash } from 'node:crypto';
import type { HumanAsk, HumanResponse } from '../../types.js';
import type { FlowRun } from '../flowRuntimeTypes.js';
import { saveFlowRun } from '../flowRunStore.js';
import { finishScheduleRun, listTenantSchedules, readScheduleRun, transactWorkspaceConfiguration } from '../serverStore.js';
import { upsertAsk } from '../humanAsk.js';

export function reviewedRecoveryRun(run: FlowRun, ask: HumanAsk, actor: string, note: string, now: number): FlowRun {
  const hold = run.outboundRecoveryHold;
  if (!hold || hold.askId !== ask.id || hold.operationId !== ask.runId || ask.projectId !== run.projectId) throw new Error('This question is not the recovery review for this run');
  if (!note.trim()) throw new Error('Enter a review note before closing the review');
  if (hold.reviewedAt) return run;
  const response: HumanResponse = {id: `review_${createHash('sha256').update(ask.id).digest('hex').slice(0,32)}`,
    at: now, via: 'web', actor, text: note.trim()};
  const answered: HumanAsk = {...ask, status: 'answered', answeredAt: now, appliedAt: now, responses: [...(ask.responses || []), response]};
  return {...run, status: 'failed', updatedAt: now,
    outboundRecoveryHold: {...hold, reviewedAt: now, reviewedBy: actor, reviewNote: note.trim()},
    state: {...run.state, milestones: run.state.milestones.map(node => node.id === ask.nodeId ? upsertAsk(node, answered) : node)}};
}

const dependencies = {saveFlowRun, listTenantSchedules, readScheduleRun, finishScheduleRun, transactWorkspaceConfiguration};
/** Close the operator review, never the unknown provider receipt. Replays finish partial saves. */
export async function closeRecoveryReview(run: FlowRun, ask: HumanAsk, actor: string, note: string, deps = dependencies) {
  const next = reviewedRecoveryRun(run, ask, actor, note, Date.now());
  const schedule = (await deps.listTenantSchedules(run.orgId)).find(item => item.id === run.triggerId && item.projectId === run.projectId);
  if (!schedule || !run.occurrenceId.startsWith(`${schedule.id}:`)) throw new Error('The owning schedule is unavailable');
  const scheduledFor = Number(run.occurrenceId.slice(schedule.id.length + 1));
  const occurrence = await deps.readScheduleRun(schedule, scheduledFor);
  if (!occurrence || occurrence.recoveryAskId !== ask.id || occurrence.status !== 'failed') throw new Error('The failed occurrence does not match this review');
  const saved = next === run ? run : await deps.saveFlowRun(next);
  const answered = saved.state.milestones.flatMap(node => node.asks || []).find(item => item.id === ask.id)!;
  await deps.finishScheduleRun(occurrence, {status: 'failed', manualReviewRequired: false, recoveryReviewedAt: saved.outboundRecoveryHold!.reviewedAt});
  await deps.transactWorkspaceConfiguration(run.orgId, workspace => ({...workspace,
    dataRevision: Number(workspace.dataRevision || 0) + 1, lastUpdated: Date.now(),
    projects: (workspace.projects || []).map((project: any) => String(project.id) !== String(run.projectId) ? project : {...project,
      revision: Number(project.revision || 0) + 1,
      milestones: (project.milestones || []).map((node: any) => node.id === ask.nodeId ? upsertAsk(node, answered) : node)
    })
  }));
  return {ok: true, askStatus: 'answered' as const, flowRunId: run.id,
    log: ['Recovery review closed. The call remains failed and the occurrence remains held. No call was retried.'], pending: []};
}
