import type { AskChannel, AskDecision, Attachment, HumanAsk, HumanResponse, Project } from '../../types.js';
import { validateResponse } from '../askResponses.js';
import { getHoldConfig } from '../flowEngine.js';
import { advanceProjectFlow } from '../flowOrchestrator.js';
import { applyAskToProject, findAskById, findAskByToken, recordAskResponse, upsertAsk } from '../humanAsk.js';
import { serverExecutor } from '../serverExecutor.js';
import { findProject, writeProject } from '../serverStore.js';
import { deliverRaisedAsks } from './deliverRaisedAsks.js';
import { interpretAskResponse } from '../triage/responseInterpreter.js';
import { expireAsk } from './expireAsk.js';
import { findFlowRunByAsk, saveFlowRun } from '../flowRunStore.js';
import { materializeFlowRunProject, updateFlowRunFromProject } from '../flowRun.js';
import { syncFlowHoldsFromRun } from '../flowHoldStore.js';
import type { FlowHoldConfig, FlowRun, RuntimeMilestone } from '../flowRuntimeTypes.js';
import { smsStepValues } from './askSteps.js';
import { deliverNextSmsStep } from './deliverNextSmsStep.js';

export interface AskResponsePayload {
  text?: string;
  structured?: Record<string, any>;
  decision?: AskDecision;
  actor?: string;
  attachments?: Attachment[];
  raw?: any;
}

export interface RespondToAskInput {
  orgId: string;
  projectId: string;
  askId?: string;
  askToken?: string;
  response: AskResponsePayload | HumanResponse;
  channel?: AskChannel;
  communicationId?: string;
  transcriptId?: string;
  occurredAt?: number;
  actorVerified?: boolean;
  /** Record a valid interpretation but keep it open for authenticated review. */
  forceReview?: boolean;
}

export interface RespondToAskOutcome {
  ok: boolean;
  reason?: string;
  askStatus?: HumanAsk['status'];
  askKind?: HumanAsk['kind'];
  askFields?: HumanAsk['fields'];
  response?: HumanResponse;
  flowRunId?: string;
  log?: string[];
  pending?: string[];
}

const isHumanResponse = (value: AskResponsePayload | HumanResponse): value is HumanResponse =>
  typeof (value as HumanResponse)?.id === 'string' &&
  typeof (value as HumanResponse)?.at === 'number' &&
  typeof (value as HumanResponse)?.via === 'string';

const structuredDecision = (value: unknown): AskDecision | undefined =>
  value === 'approved' || value === 'rejected' || value === 'revise' ? value : undefined;

export const replaceProvisionalCommunicationResponse = (
  ask: HumanAsk,
  response: HumanResponse,
  communicationId: string | undefined,
  actorVerified: boolean | undefined
): { ask: HumanAsk; response: HumanResponse } => {
  const provisional = actorVerified && communicationId
    ? ask.responses.find(item => item.communicationId === communicationId && item.needsInterpretation)
    : undefined;
  if (!provisional) return { ask, response };
  return {
    ask: { ...ask, responses: ask.responses.filter(item => item.id !== provisional.id) },
    response: { ...response, id: provisional.id }
  };
};

const validVariable = (value: unknown): string | undefined => {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : undefined;
};

const resolveHumanWait = (
  project: Project,
  nodeId: string,
  response: HumanResponse,
  now: number
): Project => {
  const node = project.milestones.find(item => item.id === nodeId);
  const cfg = node ? getHoldConfig(node) : undefined;
  if (!node || cfg?.kind !== 'human' || !cfg.holdId || cfg.resolvedAt) return project;
  const resolved: FlowHoldConfig = {
    ...cfg,
    resolvedAt: now,
    resolution: 'signal',
    resolvedBy: 'human',
    signalId: response.id
  };
  const resultKey = validVariable(cfg.resultVariable);
  const payloadKey = validVariable(cfg.payloadVariable);
  const payload = {
    decision: response.decision,
    text: response.text,
    values: response.values,
    attachments: response.attachments,
    actor: response.actor,
    via: response.via
  };
  const projectData = {
    ...(project.projectData || {}),
    ...(resultKey ? {
      [resultKey]: 'signal',
      [`${resultKey}_resolved`]: true,
      [`${resultKey}_resolution`]: 'signal',
      [`${resultKey}_payload`]: payload
    } : {}),
    ...(payloadKey ? { [payloadKey]: payload } : {})
  };
  return {
    ...project,
    projectData,
    milestones: project.milestones.map(item => item.id === nodeId
      ? ({ ...item, holdConfig: resolved } as RuntimeMilestone)
      : item)
  };
};

/** Commit the human decision before any slow provider work. The existing durable
 * continuation hold resumes ready nodes, so a mailbox batch cannot lose approval. */
export const checkpointReviewedRun = async (
  input: RespondToAskInput,
  located: Awaited<ReturnType<typeof findProject>> & {},
  run: FlowRun,
  project: Project,
  deps = { saveFlowRun, syncFlowHoldsFromRun, writeProject }
): Promise<{ project: Project; run: FlowRun; log: string[]; pending: string[] }> => {
  const savedRun = await deps.saveFlowRun(updateFlowRunFromProject(run, project));
  await deps.syncFlowHoldsFromRun(savedRun, project);
  const log = ['Response saved. Ready downstream work is queued for continuation.'];
  try { await deps.writeProject(input.orgId, located.index, project); }
  catch (error: any) {
    log.push(`Project runtime projection skipped after concurrent update: ${error?.message || String(error)}`);
  }
  return { project, run: savedRun, log, pending: savedRun.status === 'running' ? ['__continue__'] : [] };
};

/** The one canonical entry point for a human response, regardless of channel. */
export const respondToAsk = async (input: RespondToAskInput): Promise<RespondToAskOutcome> => {
  if (!input.askId && !input.askToken) return { ok: false, reason: 'ask_identity_required' };
  const suppliedDecision = input.response.decision ??
    (isHumanResponse(input.response) ? undefined : input.response.structured?.decision);
  if (suppliedDecision !== undefined && !structuredDecision(suppliedDecision)) {
    return { ok: false, reason: 'invalid_decision' };
  }
  const located = await findProject(input.orgId, input.projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const runFound = await findFlowRunByAsk(input.orgId, input.projectId, input.askId, input.askToken);
  const flowRun = runFound?.run;
  const sourceProject = flowRun ? materializeFlowRunProject(located.project, flowRun) : located.project;
  const found = input.askId ? findAskById(sourceProject, input.askId) : findAskByToken(sourceProject, input.askToken!);
  if (!found) return { ok: false, reason: 'ask_not_found' };
  if (expireAsk(found.ask, input.occurredAt ?? Date.now()).status === 'expired') {
    return { ok: false, reason: 'ask_expired', askStatus: 'expired', askKind: found.ask.kind, askFields: found.ask.fields };
  }
  if (found.ask.status === 'cancelled') return { ok: false, reason: 'ask_cancelled' };
  if (found.ask.status === 'expired') return { ok: false, reason: 'ask_expired' };
  if (found.ask.status === 'answered') {
    const sameResponse = input.communicationId
      ? found.ask.responses.find(response => response.communicationId === input.communicationId)
      : undefined;
    return {
      ok: false,
      reason: 'already_answered',
      askStatus: 'answered',
      askKind: found.ask.kind,
      askFields: found.ask.fields,
      response: sameResponse,
      flowRunId: flowRun?.id
    };
  }

  const matchedDelivery = (found.ask.deliveries || []).find(delivery =>
    delivery.deliveryAskId === input.askId || delivery.deliveryToken === input.askToken
  );
  if ((found.ask.responsePolicy === 'all' || found.ask.responsePolicy === 'quorum') &&
      !matchedDelivery && !input.actorVerified) {
    return { ok: false, reason: 'verified_reviewer_identity_required' };
  }
  const stepValues = !isHumanResponse(input.response) && input.channel === 'sms' &&
      !input.response.structured && !input.response.decision
    ? smsStepValues(found.ask, input.response.text)
    : undefined;
  const response: HumanResponse = isHumanResponse(input.response)
    ? { ...input.response }
    : await interpretAskResponse(found.ask, {
        via: input.channel || 'web',
        actor: matchedDelivery?.personId || input.response.actor || `via ${input.channel || 'web'}`,
        decision: structuredDecision(input.response.decision) || structuredDecision(input.response.structured?.decision),
        text: input.response.text,
        values: input.response.structured
          ? Object.fromEntries(Object.entries(input.response.structured).filter(([key]) => key !== 'decision'))
          : stepValues,
        attachments: input.response.attachments,
        raw: input.response.raw,
        at: input.occurredAt
      });
  response.communicationId = input.communicationId || response.communicationId;
  response.transcriptId = input.transcriptId || response.transcriptId;
  if (input.forceReview) response.needsInterpretation = true;

  const invalid = validateResponse(found.ask, response);
  if (invalid) return { ok: false, reason: invalid };

  const reviewed = replaceProvisionalCommunicationResponse(
    found.ask, response, input.communicationId, input.actorVerified
  );
  let updatedAsk = recordAskResponse(reviewed.ask, reviewed.response);
  if (updatedAsk.status === 'open' && input.channel === 'sms' && !reviewed.response.needsInterpretation) {
    updatedAsk = await deliverNextSmsStep({
      ask: updatedAsk,
      project: sourceProject,
      orgId: input.orgId,
      projectId: input.projectId,
      personId: matchedDelivery?.personId
    });
  }
  let project = {
    ...sourceProject,
    milestones: sourceProject.milestones.map(m => m.id === found.ask.nodeId ? upsertAsk(m, updatedAsk) : m)
  };
  if (updatedAsk.status === 'answered') {
    project = applyAskToProject(project, updatedAsk.id);
    project = resolveHumanWait(project, found.ask.nodeId, reviewed.response, input.occurredAt ?? Date.now());
  }

  if (flowRun) {
    const persisted = await checkpointReviewedRun(input, located, flowRun, project);
    return {
      ok: true,
      askStatus: updatedAsk.status,
      askKind: found.ask.kind,
      askFields: found.ask.fields,
      response: reviewed.response,
      flowRunId: persisted.run.id,
      log: persisted.log,
      pending: persisted.pending
    };
  }

  // Backwards-compatible path for an Ask created before FlowRun migration.
  const advanced = await advanceProjectFlow(project, serverExecutor, {
    orgId: input.orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, input.orgId, advanced.askedFor);
  await writeProject(input.orgId, located.index, delivered.project);
  return {
    ok: true,
    askStatus: updatedAsk.status,
    askKind: found.ask.kind,
    askFields: found.ask.fields,
    response: reviewed.response,
    log: [...advanced.log, ...delivered.log],
    pending: advanced.pending
  };
};
