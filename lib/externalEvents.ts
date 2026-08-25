import { resolveCallbackAndAdvance } from './serverFlow.js';
import { respondToAsk } from './asks/respondToAsk.js';
import type { AskChannel } from '../types.js';
import { createCommunicationsClient } from './communications/client.js';
import {
  claimExternalEventProcessing,
  finishExternalEventProcessing,
  persistExternalEvent
} from './serverStore.js';

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

export interface ExternalEventRecord {
  id: string;
  event_id: string;
  source: string;
  type: string;
  occurred_at: string;
  received_at: string;
  payload: ExternalEventEnvelope;
  processing_status: ExternalEventProcessingStatus;
  processed_at?: string;
  processing_error?: string;
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
    correlation: {
      tenant_id: correlation.tenant_id || correlation.org_id || correlation.orgId,
      project_id: correlation.project_id || correlation.projectId,
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

const TERMINAL_EVENTS: Readonly<Record<string, 'success' | 'error'>> = {
  'call.completed': 'success',
  'call.failed': 'error',
  'sms.delivered': 'success',
  'sms.failed': 'error'
};

export const terminalExternalEventStatus = (type: string): 'success' | 'error' | null =>
  TERMINAL_EVENTS[type.toLowerCase()] || null;

/** Persist first, then deterministically apply an explicitly-correlated terminal event. */
export const receiveExternalEvent = async (raw: any): Promise<ExternalEventOutcome> => {
  const event = normalizeExternalEvent(raw);
  const record = createExternalEventRecord(event);
  const inserted = await persistExternalEvent(record);
  const claimed = await claimExternalEventProcessing(event.event_id);
  if (!claimed) {
    if (inserted) return { ok: false, retryable: true, reason: 'event_claim_failed' };
    return { ok: true, duplicate: true };
  }

  try {
    if (event.source !== 'communications') {
      await finishExternalEventProcessing(event.event_id, 'processed');
      return { ok: true, ignored: true, reason: 'unsupported_source' };
    }

    if (event.type === 'ask.response.received') {
      const { tenant_id: tenantId, project_id: projectId, person_id: personId } = event.correlation;
      if (!event.ask_id || !tenantId || !projectId) {
        const reason = 'missing ask_id, tenant_id or project_id correlation';
        await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
        return { ok: false, reason };
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
        response: {
          text: event.response?.text,
          structured: event.response?.structured,
          actor: personId || `communications:${event.channel || 'unknown'}`,
          raw: event
        }
      });

      if (!outcome.ok && outcome.reason !== 'already_answered') {
        const reason = outcome.reason || 'ask_response_not_applied';
        await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
        return { ok: false, reason };
      }

      const canonicalResponseUsesCommunication = Boolean(
        event.communication_id && outcome.response?.communicationId === event.communication_id
      );
      if (outcome.askStatus === 'answered' && canonicalResponseUsesCommunication) {
        try {
          await createCommunicationsClient().resolveAsk(event.ask_id, event.communication_id!);
        } catch (error: any) {
          const reason = `Communications Ask resolution failed: ${error?.message || String(error)}`;
          await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
          return { ok: false, retryable: true, reason };
        }
      }

      await finishExternalEventProcessing(event.event_id, 'processed');
      return {
        ok: true,
        ignored: outcome.reason === 'already_answered' || undefined,
        reason: outcome.reason,
        log: outcome.log,
        pending: outcome.pending
      };
    }

    const status = terminalExternalEventStatus(event.type);
    if (!status) {
      await finishExternalEventProcessing(event.event_id, 'processed');
      return { ok: true, ignored: true, reason: 'non_terminal_event' };
    }

    const { tenant_id: tenantId, project_id: projectId, run_id: runId, task_id: taskId } = event.correlation;
    if (!tenantId || !projectId || !runId || !taskId) {
      const reason = 'missing tenant_id, project_id, run_id or task_id correlation';
      await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
      return { ok: false, reason };
    }

    const outcome = await resolveCallbackAndAdvance(
      tenantId,
      projectId,
      { nodeId: taskId, runId, externalId: event.communication_id },
      {
        status,
        output: { communication_id: event.communication_id, ...event.payload },
        logs: [`External event ${event.event_id} (${event.type}) received from communications`],
        error: status === 'error' ? String(event.payload.error || 'Communication failed') : undefined,
        resolvedBy: `event:${event.source}`
      }
    );

    if (!outcome.ok) {
      const reason = outcome.reason || 'event_not_applied';
      await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
      return { ok: false, retryable: reason === 'no_matching_pending_run', reason };
    }

    await finishExternalEventProcessing(event.event_id, 'processed');
    return { ok: true, log: outcome.log, pending: outcome.pending };
  } catch (error: any) {
    const reason = error?.message || String(error);
    await finishExternalEventProcessing(event.event_id, 'processing_failed', reason);
    throw error;
  }
};
