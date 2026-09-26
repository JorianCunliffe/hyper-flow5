import { type AskField, type HumanAsk, type Milestone, type Project } from '../../types.js';
import { createAsk } from '../asks/createAsk.js';
import { collectValues } from '../humanAsk.js';
import { requireProjectInTenant } from '../apiAuth.js';
import { listTenantProjects, readTenantAgentProfile, requireOrganizationMember } from '../serverStore.js';
import { CaptureError, normalizeIntent, selectReviewItems, unresolved, type CaptureReviewState } from './model.js';
import { listCaptures, readCapture, mutateCapture } from './store.js';
export interface ReviewState extends CaptureReviewState { draft?: Record<string, any>; stage?: string; ownerId?: string; }
export type ReviewResult = { node: Milestone; ask?: HumanAsk; log: string[] };
export const reviewDependencies = { listCaptures, readCapture, mutateCapture, readTenantAgentProfile, listTenantProjects, requireOrganizationMember, requireProjectInTenant };

/** One bounded step. The orchestrator checkpoints the Ask before delivery. */
export async function reviewCapturedWork(project: Project, node: Milestone, orgId: string, deps = reviewDependencies): Promise<ReviewResult> {
  const config = node.captureReviewConfig || {};
  let state: ReviewState = node.captureReviewState ? JSON.parse(JSON.stringify(node.captureReviewState)) : {
    itemIds: [], cursor: 0, completedIds: []
  };
  const ownerId = state.ownerId || config.capturedForUserId || (await deps.readTenantAgentProfile(orgId))?.primaryUserId;
  if (!ownerId) throw new CaptureError(422, 'Review Unresolved Items needs a configured user ID or tenant primary user');
  await deps.requireOrganizationMember(ownerId, orgId);
  state.ownerId = ownerId;
  if (!node.captureReviewState) state.itemIds = selectReviewItems(await deps.listCaptures(orgId, ownerId), config, {
    userId: ownerId, projectId: project.id, runId: project.projectData?.flow_run_id, startedAt: project.projectData?.flow_started_at
  }).map(item => item.id);
  const log: string[] = [];
  const finishItem = () => {
    state = { ...state, cursor: state.cursor + 1, askId: undefined, itemVersion: undefined, draft: undefined, stage: undefined };
  };
  const asks = [...(node.asks || [])];
  // At most maxItems records are visited, including records closed in another review.
  while (state.cursor < state.itemIds.length) {
    const item = await deps.readCapture(orgId, ownerId, state.itemIds[state.cursor]);
    if (!item || !unresolved(item)) {
      const pending = asks.findIndex(ask => ask.id === state.askId && ask.status === 'open');
      if (pending >= 0) asks[pending] = { ...asks[pending], status: 'cancelled' };
      if (item?.intent && !(state.completedIds || []).includes(item.id)) {
        state.completedIds = [...(state.completedIds || []), item.id];
        state.intents = [...(state.intents || []), item.intent];
      }
      finishItem(); continue;
    }
    let prior = asks.find(ask => ask.id === state.askId);
    if (prior?.status === 'open' && item.version === state.itemVersion) return { node: { ...node, captureReviewState: state }, log };
    if (prior?.status === 'open') asks[asks.indexOf(prior)] = { ...prior, status: 'cancelled' };
    if (state.itemVersion !== undefined && state.itemVersion !== item.version) {
      state = { ...state, draft: undefined, stage: undefined, askId: undefined };
      prior = undefined;
      log.push('Captured item changed during review; asking for fresh confirmation.');
    }
    state.itemVersion = item.version;
    if (!state.draft) state.draft = { kind: item.kind === 'unknown' ? undefined : item.kind, title: item.title || item.rawText.slice(0, 500), projectId: item.proposedProjectId, at: item.proposedAt || item.proposedDueAt, location: item.proposedLocation, mode: item.proposedMode, durationMinutes: item.proposedDurationMinutes, notes: item.notes };
    if (prior?.status === 'answered') {
      const values = collectValues(prior);
      const answer = values.capture_answer;
      if (answer === 'dismiss' || answer === 'defer') {
        if (answer === 'dismiss') await deps.mutateCapture(orgId, ownerId, item.id, 'dismiss', { version: item.version });
        log.push(`${item.id}: ${answer === 'dismiss' ? 'dismissed' : 'deferred for a later review'}`);
        finishItem(); continue;
      }
      if (state.stage === 'confirm' && answer === 'confirm') {
        if (state.draft.projectId) await deps.requireProjectInTenant(orgId, state.draft.projectId);
        const resolved = await deps.mutateCapture(orgId, ownerId, item.id, 'resolve', { version: item.version, confirmed: true, intent: state.draft });
        state.intents = [...(state.intents || []), resolved.intent!];
        state.completedIds = [...(state.completedIds || []), item.id];
        log.push(`${item.id}: resolved to ${resolved.resolvedObjectId}; no external action executed`);
        finishItem(); continue;
      }
      if (state.stage === 'confirm' && answer === 'correct') {
        state.draft = {}; state.stage = 'kind';
      } else if (state.stage === 'at') {
        // A timezone is mandatory; never turn "one today" into a guessed instant.
        const supplied = String(answer || '');
        const at = /(?:Z|[+-]\d{2}:\d{2})$/.test(supplied) ? Date.parse(supplied) : NaN;
        if (Number.isFinite(at)) state.draft.at = at;
      } else if (state.stage === 'projectId') {
        const selected = String(answer || '').trim();
        if (selected === 'general') state.draft.projectId = '';
        else {
          const projects = await deps.listTenantProjects(orgId);
          const match = projects.find(p => p.id === selected || p.name.toLowerCase() === selected.toLowerCase());
          if (match) state.draft.projectId = match.id;
        }
      } else if (state.stage && state.stage !== 'confirm') state.draft[state.stage] = answer;
      state.askId = undefined;
    }
    const draft = state.draft;
    let stage: string;
    let question: string;
    let options: string[] | undefined;
    if (!['task', 'meeting', 'reminder', 'follow_up', 'note'].includes(draft.kind)) {
      stage = 'kind'; question = 'What should this become?'; options = ['task', 'meeting', 'reminder', 'follow_up', 'note', 'dismiss', 'defer'];
    } else if (!draft.title) {
      stage = 'title'; question = 'What is the task title or note content?';
    } else if (draft.projectId === undefined) {
      const projects = await deps.listTenantProjects(orgId);
      const names = projects.slice(0, 30).map(p => `${p.name} (${p.id})`).join(', ');
      stage = 'projectId'; question = `Which project, or general workspace?${item.proposedProjectName ? ` Suggested: ${item.proposedProjectName}.` : ''} Available: ${names}. Enter a project ID/name or general.`;
    } else if (['meeting', 'reminder'].includes(draft.kind) && !draft.at) {
      stage = 'at'; question = 'What date and time, including timezone? Use an ISO time such as 2026-09-26T13:00:00+10:00.';
    } else if (draft.kind === 'meeting' && !['in_person', 'phone', 'online'].includes(draft.mode)) {
      stage = 'mode'; question = 'Is this meeting in person, by phone, or online?'; options = ['in_person', 'phone', 'online', 'dismiss', 'defer'];
    } else if (draft.kind === 'meeting' && draft.mode === 'in_person' && !draft.location) {
      stage = 'location'; question = 'Where is the meeting?';
    } else {
      const intent = normalizeIntent(draft, `${item.id}_intent`);
      stage = 'confirm';
      question = `Confirm this work intent: ${intent.title}; ${intent.kind}; project ${intent.projectId || 'general workspace'}${intent.at ? `; ${new Date(intent.at).toISOString()}` : ''}${intent.mode ? `; ${intent.mode}; ${intent.durationMinutes} minutes` : ''}${intent.location ? `; ${intent.location}` : ''}. This records the intent; booking, reminders and messages require an explicit downstream action.`;
      options = ['confirm', 'correct', 'dismiss', 'defer'];
    }
    const field: AskField = { name: 'capture_answer', type: 'string', label: question, required: true, ...(options ? { options } : {}) };
    const ask = createAsk({ taskId: node.id, projectId: project.id, runId: project.projectData?.flow_run_id, question: `You mentioned: “${item.rawText}”\n${question}\nYou can also dismiss or defer this item.`, responseType: 'question', fields: [field], channels: ['web'] });
    state = { ...state, stage, askId: ask.id };
    return { node: { ...node, asks: [...asks, ask], captureReviewState: state }, ask, log };
  }
  return { node: { ...node, asks, captureReviewState: state, completedAt: Date.now() }, log: [...log, 'Unresolved item review completed. Deferred items remain available.'] };
}
