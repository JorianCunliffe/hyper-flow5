import type { AskChannel, AskDecision, Attachment, HumanAsk, HumanResponse } from '../../types.js';
import { buildResponse, validateResponse } from '../askResponses.js';
import { advanceProjectFlow } from '../flowOrchestrator.js';
import { applyAskToProject, findAskById, findAskByToken, recordAskResponse, upsertAsk } from '../humanAsk.js';
import { serverExecutor } from '../serverExecutor.js';
import { findProject, writeProject } from '../serverStore.js';
import { deliverRaisedAsks } from './deliverRaisedAsks.js';

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
}

export interface RespondToAskOutcome {
  ok: boolean;
  reason?: string;
  askStatus?: HumanAsk['status'];
  response?: HumanResponse;
  log?: string[];
  pending?: string[];
}

const isHumanResponse = (value: AskResponsePayload | HumanResponse): value is HumanResponse =>
  typeof (value as HumanResponse)?.id === 'string' &&
  typeof (value as HumanResponse)?.at === 'number' &&
  typeof (value as HumanResponse)?.via === 'string';

const structuredDecision = (value: unknown): AskDecision | undefined =>
  value === 'approved' || value === 'rejected' || value === 'revise' ? value : undefined;

/** The one canonical entry point for a human response, regardless of channel. */
export const respondToAsk = async (input: RespondToAskInput): Promise<RespondToAskOutcome> => {
  if (!input.askId && !input.askToken) return { ok: false, reason: 'ask_identity_required' };
  const located = await findProject(input.orgId, input.projectId);
  if (!located) return { ok: false, reason: 'project_not_found' };

  const found = input.askId ? findAskById(located.project, input.askId) : findAskByToken(located.project, input.askToken!);
  if (!found) return { ok: false, reason: 'ask_not_found' };
  if (found.ask.status === 'cancelled') return { ok: false, reason: 'ask_cancelled' };
  if (found.ask.status === 'expired') return { ok: false, reason: 'ask_expired' };
  if (found.ask.status === 'answered') {
    const sameResponse = input.communicationId
      ? found.ask.responses.find(response => response.communicationId === input.communicationId)
      : undefined;
    return { ok: false, reason: 'already_answered', askStatus: 'answered', response: sameResponse };
  }

  const matchedDelivery = (found.ask.deliveries || []).find(delivery =>
    delivery.deliveryAskId === input.askId || delivery.deliveryToken === input.askToken
  );
  if ((found.ask.responsePolicy === 'all' || found.ask.responsePolicy === 'quorum') &&
      !matchedDelivery && !input.actorVerified) {
    return { ok: false, reason: 'verified_reviewer_identity_required' };
  }
  const response: HumanResponse = isHumanResponse(input.response)
    ? { ...input.response }
    : buildResponse(found.ask, {
        via: input.channel || 'web',
        actor: matchedDelivery?.personId || input.response.actor || `via ${input.channel || 'web'}`,
        decision: input.response.decision || structuredDecision(input.response.structured?.decision),
        text: input.response.text,
        values: input.response.structured
          ? Object.fromEntries(Object.entries(input.response.structured).filter(([key]) => key !== 'decision'))
          : undefined,
        attachments: input.response.attachments,
        raw: input.response.raw,
        at: input.occurredAt
      });
  response.communicationId = input.communicationId || response.communicationId;
  response.transcriptId = input.transcriptId || response.transcriptId;

  const invalid = validateResponse(found.ask, response);
  if (invalid) return { ok: false, reason: invalid };

  const updatedAsk = recordAskResponse(found.ask, response);
  let project = {
    ...located.project,
    milestones: located.project.milestones.map(m => m.id === found.ask.nodeId ? upsertAsk(m, updatedAsk) : m)
  };
  if (updatedAsk.status === 'answered') project = applyAskToProject(project, updatedAsk.id);

  const advanced = await advanceProjectFlow(project, serverExecutor, {
    orgId: input.orgId,
    webhookBaseUrl: process.env.PUBLIC_BASE_URL
  });
  const delivered = await deliverRaisedAsks(advanced.project, input.orgId, advanced.askedFor);
  await writeProject(input.orgId, located.index, delivered.project);
  return {
    ok: true,
    askStatus: updatedAsk.status,
    response,
    log: [...advanced.log, ...delivered.log],
    pending: advanced.pending
  };
};
