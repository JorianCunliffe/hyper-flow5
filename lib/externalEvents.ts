import { resolveCallbackAndAdvance } from './serverFlow.js';
import { respondToAsk } from './asks/respondToAsk.js';
import type { AskChannel, CommunicationsSettings } from '../types.js';
import { createCommunicationsClient } from './communications/client.js';
import {
  beginExternalEventProcessing,
  claimAskResolution,
  enqueueAgentInboxJob,
  enqueueAskResolution,
  finishExternalEventProcessing,
  finishAskResolution,
  readTenantCommunicationsSettings,
  setTenantTriageDisposition,
  upsertTriageItem,
  writeCommunicationDeliveryState
} from './serverStore.js';
import { triageItemFromEvent } from './triage/emailTriage.js';

export const isInboundCommunicationEvent = (type: string): boolean =>
  type === 'communication.received' || type === 'sms.received';
import type { CommunicationResult } from './communications/types.js';

export type ExternalEventProcessingStatus = 'received' | 'processing' | 'processed' | 'processing_failed';

export interface ExternalEventCorrelation {
  tenant_id?: string;
  project_id?: string;
  run_id?: string;
  task_id?: string;
  person_id?: string;
}

export interface ExternalEventEnvelope {
  event_id: string;
  source: string;
  type: string;
  occurred_at?: string | number;
  communication_id?: string;
  transcript_id?: string;
  ask_id?: string;
  channel?: AskChannel;
  response?: { text?: string; structured?: Record<string, unknown> };
  purpose?: { type?: string; [key: string]: unknown };
  correlation: ExternalEventCorrelation;
  payload: Record<string, unknown>;
}

const transcriptText = (value: unknown): string | undefined => {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return undefined;
  const object = value as Record<string, unknown>;
  if (typeof object.text === 'string') return object.text;
  if (typeof object.transcript === 'string') return object.transcript;
  // Keep structured evidence human-readable but unclassified. Approval parsing
  // will mark this as needing interpretation instead of silently resolving it.
  try { return JSON.stringify(value); } catch { return undefined; }
};

const payloadTranscriptText = (payload: Record<string, unknown>): string | undefined => {
  for (const value of [payload.transcript_text, payload.call_transcript, payload.transcript]) {
    const text = transcriptText(value)?.trim();
    if (text) return text;
  }
  return undefined;
};

export const hydrateCompletedCallPayload = (
  payload: Record<string, unknown>,
  communication: CommunicationResult
): Record<string, unknown> => {
  if (payloadTranscriptText(payload)) return payload;
  const transcript = communication.content?.trim();
  if (!transcript) throw new Error('Completed call detail did not include a verified transcript');
  return {
    ...payload,
    transcript_text: transcript,
    disposition: payload.disposition || communication.outcome?.disposition,
    memory_eligible: payload.memory_eligible ?? communication.outcome?.memory_eligible
  };
};

export interface ExternalEventRecord {
  id: string;
  event_id: string;
  source: string;
  type: string;
  occurred_at: string;
  received_at: string;
  payload: ExternalEventEnvelope;
  processing_status: ExternalEventProcessingStatus;
  attempt_count?: number;
  claimed_at?: string;
  lease_expires_at?: string;
  processed_at?: string;
  processing_error?: string;
  processing_claim_id?: string;
  processing_started_at?: string;
}

export const normalizeExternalEvent = (raw: any, defaultSource?: 'communications'): ExternalEventEnvelope => {
  if (!raw || typeof raw !== 'object') throw new Error('Event body must be a JSON object');
  const eventId = typeof raw.event_id === 'string' ? raw.event_id.trim() : '';
  const source = typeof raw.source === 'string' ? raw.source.trim() : (defaultSource || '');
  const type = typeof raw.type === 'string' ? raw.type.trim() : '';
  if (!eventId) throw new Error('event_id is required');
  if (!source) throw new Error('source is required');
  if (!type) throw new Error('type is required');

  const correlation = raw.correlation && typeof raw.correlation === 'object' ? raw.correlation : {};
  const payload = raw.payload && typeof raw.payload === 'object' && !Array.isArray(raw.payload) ? raw.payload : {};
  return {
    event_id: eventId,
    source,
    type,
    occurred_at: raw.occurred_at,
    communication_id: typeof raw.communication_id === 'string' ? raw.communication_id : undefined,
    transcript_id: typeof raw.transcript_id === 'string' ? raw.transcript_id : undefined,
    ask_id: typeof (raw.ask_id ?? raw.purpose?.ask_id ?? payload.ask_id) === 'string'
      ? String(raw.ask_id ?? raw.purpose?.ask_id ?? payload.ask_id)
      : undefined,
    channel: ['email', 'sms', 'voice', 'web'].includes(raw.channel ?? payload.channel)
      ? (raw.channel ?? payload.channel) as AskChannel
      : undefined,
    response: raw.response && typeof raw.response === 'object'
      ? raw.response
      : payload.response && typeof payload.response === 'object'
        ? payload.response as ExternalEventEnvelope['response']
        : {
            text: (raw.channel ?? payload.channel) === 'voice'
              ? transcriptText(payload.transcript)
              : typeof payload.content === 'string' ? payload.content : undefined
          },
    purpose: raw.purpose && typeof raw.purpose === 'object' && !Array.isArray(raw.purpose) ? raw.purpose : undefined,
    correlation: {
      tenant_id: correlation.tenant_id || correlation.org_id || correlation.orgId || raw.tenant_id,
      project_id: correlation.external_project_id || correlation.project_id || correlation.projectId,
      run_id: correlation.run_id || correlation.runId,
      task_id: correlation.task_id || correlation.node_id || correlation.nodeId,
      person_id: correlation.person_id || correlation.personId
    },
    payload
  };
};

export const createExternalEventRecord = (event: ExternalEventEnvelope, now = new Date()): ExternalEventRecord => {
  const occurred = event.occurred_at ? new Date(event.occurred_at) : now;
  return {
    id: event.event_id,
    event_id: event.event_id,
    source: event.source,
    type: event.type,
    occurred_at: Number.isNaN(occurred.getTime()) ? now.toISOString() : occurred.toISOString(),
    received_at: now.toISOString(),
    payload: event,
    processing_status: 'received'
  };
};

export interface ExternalEventOutcome {
  ok: boolean;
  duplicate?: boolean;
  ignored?: boolean;
  retryable?: boolean;
  reason?: string;
  log?: string[];
  pending?: string[];
}

export const externalEventHttpStatus = (outcome: Pick<ExternalEventOutcome, 'ok' | 'retryable'>): number => {
  if (outcome.ok) return 200;
  return outcome.retryable ? 503 : 422;
};

const TERMINAL_EVENTS: Readonly<Record<string, 'success' | 'error'>> = {
  'call.completed': 'success',
  'call.failed': 'error',
  'sms.delivered': 'success',
  'sms.failed': 'error'
};

export const terminalExternalEventStatus = (
  type: string,
  payload: Record<string, unknown> = {}
): 'success' | 'error' | null => {
  const normalizedType = type.toLowerCase();
  const direct = TERMINAL_EVENTS[normalizedType];
  if (direct) return direct;
  if (normalizedType === 'sms.sent') {
    const status = String(payload.status || '').toLowerCase();
    if (status === 'failed' || status === 'undelivered') return 'error';
    if (status === 'delivered') return 'success';
  }
  return null;
};

export const terminalExternalEventResult = (event: ExternalEventEnvelope): {
  status: 'success' | 'error'; error?: string; log: string;
} | null => {
  let status = terminalExternalEventStatus(event.type, event.payload);
  if (!status) return null;
  const disposition = typeof event.payload.disposition === 'string' ? event.payload.disposition : undefined;
  const successful = typeof event.payload.successful === 'boolean' ? event.payload.successful : undefined;
  const memoryEligible = typeof event.payload.memory_eligible === 'boolean' ? event.payload.memory_eligible : undefined;

  // A contradictory producer payload must fail closed even if its event name
  // says completed. Provider completion is not verified human success.
  if (event.type.toLowerCase() === 'call.completed' && (
    successful === false || memoryEligible === false || (disposition && disposition !== 'human_completed')
  )) status = 'error';

  const failure = String(
    event.payload.failure_reason || event.payload.error ||
    (disposition ? `Call outcome: ${disposition.replace(/_/g, ' ')}` : 'Communication failed')
  );
  return {
    status,
    error: status === 'error' ? failure : undefined,
    log: status === 'error'
      ? `Communication failed${disposition ? ` (${disposition.replace(/_/g, ' ')})` : ''}: ${failure}`
      : 'Communication completed with a verified human response'
  };
};

/** Atomically persist/claim, then apply an explicitly-correlated terminal event. */
export const receiveExternalEvent = async (raw: any): Promise<ExternalEventOutcome> => {
  const incomingEvent = normalizeExternalEvent(raw);
  const orgId = incomingEvent.correlation.tenant_id;
  if (!orgId) throw new Error('tenant_id is required');
  const claim = await beginExternalEventProcessing(createExternalEventRecord(incomingEvent));
  if (!claim.claimed) return { ok: true, duplicate: true };
  // A replay with the same event_id must process the originally persisted
  // envelope, never a later body that merely reused its idempotency key.
  const event = claim.record?.payload || incomingEvent;

  try {
    if (event.source !== 'communications') {
      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return { ok: true, ignored: true, reason: 'unsupported_source' };
    }

    let communication: CommunicationResult | undefined;
    const tenantSettings: CommunicationsSettings = await readTenantCommunicationsSettings(orgId).catch(() => ({}));
    if (event.communication_id && (event.channel === 'email' || event.payload.channel === 'email')) {
      communication = await createCommunicationsClient().getCommunication(orgId, event.communication_id);
      if (!event.response?.text && communication.content) {
        event.response = { ...(event.response || {}), text: communication.content };
      }
      event.payload = {
        ...event.payload,
        thread_id: event.payload.thread_id || communication.threadId,
        disposition: event.payload.disposition || communication.outcome?.disposition,
        memory_eligible: event.payload.memory_eligible ?? communication.outcome?.memory_eligible
      };
    }

    if (isInboundCommunicationEvent(event.type)) {
      const item = triageItemFromEvent(event, communication);
      if (tenantSettings.triagePolicy === 'correlated_only' && !item.askId && !item.projectId) {
        await finishExternalEventProcessing(orgId, event.event_id, 'processed');
        return { ok: true, ignored: true, reason: 'tenant_triage_policy' };
      }
      await upsertTriageItem(item);
      if (item.memoryEligible !== false) {
        await enqueueAgentInboxJob({
          id: item.communicationId,
          orgId,
          communicationId: item.communicationId,
          eventId: event.event_id,
          channel: item.channel,
          threadId: item.threadId,
          personId: item.personId,
          trustedProjectId: item.projectId
        });
      }
      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return { ok: true, reason: item.memoryEligible === false ? 'triage_item_recorded' : 'agent_job_queued' };
    }

    if (['call.completed', 'call.failed'].includes(event.type) && event.purpose?.type === 'agent_conversation') {
      if (event.communication_id) {
        communication = await createCommunicationsClient().getCommunication(orgId, event.communication_id);
        if (!event.response?.text && communication.content) event.response = { ...(event.response || {}), text: communication.content };
        event.payload = {
          ...event.payload,
          thread_id: event.payload.thread_id || communication.threadId,
          memory_eligible: event.payload.memory_eligible ?? communication.outcome?.memory_eligible,
          disposition: event.payload.disposition || communication.outcome?.disposition
        };
      }
      const item = triageItemFromEvent(event, communication);
      await upsertTriageItem(item);
      if (event.type === 'call.completed' && item.memoryEligible !== false) {
        await enqueueAgentInboxJob({
          id: item.communicationId,
          orgId,
          communicationId: item.communicationId,
          eventId: event.event_id,
          channel: 'voice',
          threadId: item.threadId,
          personId: item.personId,
          trustedProjectId: item.projectId
        });
      }
      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return {
        ok: true,
        ignored: event.type === 'call.failed' || undefined,
        reason: event.type === 'call.completed' ? 'agent_job_queued' : 'failed_agent_call_recorded'
      };
    }

    if (['email.accepted', 'email.delivered', 'email.failed'].includes(event.type)) {
      await writeCommunicationDeliveryState(orgId, event.communication_id || event.event_id, {
        eventId: event.event_id,
        type: event.type,
        occurredAt: event.occurred_at || Date.now(),
        payload: event.payload
      });
      if (event.type === 'email.failed') await upsertTriageItem(triageItemFromEvent(event, communication));
      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return { ok: true, reason: 'delivery_state_updated' };
    }

    if (event.type === 'ask.response.received') {
      const { tenant_id: tenantId, project_id: projectId, person_id: personId } = event.correlation;
      if (!event.ask_id || !tenantId || !projectId) {
        const reason = 'missing ask_id, tenant_id or project_id correlation';
        await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
        return { ok: false, reason };
      }

      const candidateTriage = triageItemFromEvent(event, communication);
      if (!candidateTriage.memoryEligible) {
        await upsertTriageItem({ ...candidateTriage, disposition: 'spam_automatic' });
        await finishExternalEventProcessing(orgId, event.event_id, 'processed');
        return { ok: true, ignored: true, reason: 'ineligible_email_response' };
      }

      if (event.channel === 'voice' && (
        event.payload.successful === false || event.payload.memory_eligible === false ||
        (typeof event.payload.disposition === 'string' && event.payload.disposition !== 'human_completed')
      )) {
        await finishExternalEventProcessing(orgId, event.event_id, 'processed');
        return { ok: true, ignored: true, reason: 'ineligible_voice_response' };
      }

      const occurredAt = event.occurred_at ? new Date(event.occurred_at).getTime() : undefined;
      const outcome = await respondToAsk({
        orgId: tenantId,
        projectId,
        askId: event.ask_id,
        channel: event.channel || 'web',
        communicationId: event.communication_id,
        transcriptId: event.transcript_id,
        occurredAt: occurredAt !== undefined && !Number.isNaN(occurredAt) ? occurredAt : undefined,
        forceReview: event.channel === 'email'
          && !(tenantSettings.allowedAutomaticActions || []).includes('progress_ask'),
        response: {
          text: event.response?.text,
          structured: event.response?.structured,
          actor: personId || `communications:${event.channel || 'unknown'}`,
          raw: event
        }
      });

      if (!outcome.ok && outcome.reason !== 'already_answered') {
        const reason = outcome.reason || 'ask_response_not_applied';
        await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
        return { ok: false, reason };
      }

      const responseDisposition = outcome.response?.needsInterpretation ? 'needs_review' : 'resolved';
      const storedTriage = await upsertTriageItem({
        ...candidateTriage,
        disposition: responseDisposition,
        askKind: outcome.askKind,
        askFields: outcome.askFields,
        interpretation: {
          intent: outcome.response?.intent,
          decision: outcome.response?.decision,
          values: outcome.response?.values,
          confidence: outcome.response?.confidence,
          evidence: outcome.response?.evidenceExcerpt || outcome.response?.text?.slice(0, 500),
          modelVersion: outcome.response?.modelVersion,
          interpretedAt: outcome.response?.interpretedAt,
          acceptedAt: responseDisposition === 'resolved' ? Date.now() : undefined
        },
        proposedAction: responseDisposition === 'resolved' ? 'Workflow response accepted' : 'Human review required before workflow progression',
        updatedAt: Date.now()
      });
      if (outcome.reason === 'already_answered') {
        await setTenantTriageDisposition(orgId, storedTriage.id, 'resolved', 'respondToAsk', 'Ask was already answered');
      }

      const canonicalResponseUsesCommunication = Boolean(
        event.communication_id && outcome.response?.communicationId === event.communication_id
      );
      if (outcome.askStatus === 'answered' && canonicalResponseUsesCommunication) {
        await enqueueAskResolution(orgId, event.ask_id, event.communication_id!);
        const claimedResolution = await claimAskResolution(orgId, event.ask_id, event.communication_id!);
        if (!claimedResolution) {
          await finishExternalEventProcessing(orgId, event.event_id, 'processed');
          return { ok: true, ignored: true, reason: 'ask_resolution_already_claimed' };
        }
        try {
          await createCommunicationsClient().resolveAsk(orgId, event.ask_id, event.communication_id!);
          await finishAskResolution(orgId, event.ask_id, event.communication_id!, 'resolved');
        } catch (error: any) {
          const reason = `Communications Ask resolution failed: ${error?.message || String(error)}`;
          await finishAskResolution(orgId, event.ask_id, event.communication_id!, 'failed', reason);
          await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
          return { ok: false, retryable: true, reason };
        }
      }

      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return {
        ok: true,
        ignored: outcome.reason === 'already_answered' || undefined,
        reason: outcome.reason,
        log: outcome.log,
        pending: outcome.pending
      };
    }

    if (event.type === 'call.completed' && event.communication_id && !payloadTranscriptText(event.payload)) {
      communication = communication || await createCommunicationsClient().getCommunication(orgId, event.communication_id);
      event.payload = hydrateCompletedCallPayload(event.payload, communication);
    }

    const terminal = terminalExternalEventResult(event);
    if (!terminal) {
      await finishExternalEventProcessing(orgId, event.event_id, 'processed');
      return { ok: true, ignored: true, reason: 'non_terminal_event' };
    }

    const { tenant_id: tenantId, project_id: projectId, run_id: runId, task_id: taskId } = event.correlation;
    if (!tenantId || !projectId || !runId || !taskId) {
      const reason = 'missing tenant_id, project_id, run_id or task_id correlation';
      await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
      return { ok: false, reason };
    }

    const outcome = await resolveCallbackAndAdvance(
      tenantId,
      projectId,
      { nodeId: taskId, runId, externalId: event.communication_id },
      {
        status: terminal.status,
        output: { communication_id: event.communication_id, ...event.payload },
        logs: [
          `External event ${event.event_id} (${event.type}) received from communications`,
          terminal.log
        ],
        error: terminal.error,
        resolvedBy: `event:${event.source}`
      }
    );

    if (!outcome.ok) {
      const reason = outcome.reason || 'event_not_applied';
      await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
      return { ok: false, retryable: reason === 'no_matching_pending_run', reason };
    }

    await finishExternalEventProcessing(orgId, event.event_id, 'processed');
    return { ok: true, log: outcome.log, pending: outcome.pending };
  } catch (error: any) {
    const reason = error?.message || String(error);
    await finishExternalEventProcessing(orgId, event.event_id, 'processing_failed', reason);
    throw error;
  }
};
