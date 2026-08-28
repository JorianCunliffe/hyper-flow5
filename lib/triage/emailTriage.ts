import type { CommunicationResult } from '../communications/types.js';
import type { ExternalEventEnvelope } from '../externalEvents.js';
import type { TriageDisposition, TriageItem } from '../../types.js';

const stringValue = (...values: unknown[]): string | undefined => {
  const value = values.find(item => typeof item === 'string' && item.trim());
  return typeof value === 'string' ? value.trim() : undefined;
};

const flags = (classification: string | undefined, payload: Record<string, unknown>) => {
  const normalized = String(classification || '').toLowerCase();
  const automated = payload.automated === true || ['automatic_reply', 'auto_reply', 'system'].includes(normalized);
  const bounce = payload.bounce === true || normalized === 'bounce';
  const spam = payload.spam === true || normalized === 'spam';
  const memoryEligible = payload.memory_eligible !== false && !automated && !bounce && !spam;
  return { automated, bounce, spam, memoryEligible };
};

const initialDisposition = (
  event: ExternalEventEnvelope,
  classification: string | undefined,
  ineligible: boolean
): TriageDisposition => {
  if (event.type === 'email.failed') return 'delivery_failure';
  if (ineligible) return 'spam_automatic';
  if (event.ask_id) return 'awaiting_interpretation';
  if (event.correlation.project_id) return 'linked_workflow';
  return 'new';
};

export const triageItemFromEvent = (
  event: ExternalEventEnvelope,
  communication?: CommunicationResult
): TriageItem => {
  const now = Date.now();
  const classification = stringValue(event.payload.triage, event.payload.triage_class, communication?.outcome?.disposition);
  const eligibility = flags(classification, event.payload);
  const content = stringValue(event.response?.text, communication?.content, event.payload.content);
  const communicationId = event.communication_id || communication?.id || event.event_id;
  return {
    id: communicationId,
    orgId: event.correlation.tenant_id!,
    communicationId,
    threadId: stringValue(event.payload.thread_id, communication?.threadId),
    channel: event.channel || communication?.channel || String(event.payload.channel || 'email'),
    direction: communication?.direction || (event.type.startsWith('email.') && event.type !== 'email.received' ? 'outbound' : 'inbound'),
    occurredAt: communication?.occurredAt || String(event.occurred_at || new Date(now).toISOString()),
    sender: stringValue(event.payload.from, event.payload.sender, communication?.sender),
    recipients: Array.isArray(event.payload.to) ? event.payload.to.map(String) : communication?.recipients,
    subject: stringValue(event.payload.subject, communication?.subject),
    preview: content?.replace(/\s+/g, ' ').slice(0, 500),
    personId: event.correlation.person_id || communication?.personId,
    projectId: event.correlation.project_id,
    askId: event.ask_id,
    runId: event.correlation.run_id,
    taskId: event.correlation.task_id,
    classification,
    ...eligibility,
    disposition: initialDisposition(event, classification, !eligibility.memoryEligible),
    proposedAction: event.ask_id ? 'Interpret and validate this response through respondToAsk' : 'Review and assign the inbound communication',
    audit: [{ at: now, action: `event:${event.type}`, actor: 'communications-service' }],
    createdAt: now,
    updatedAt: now
  };
};

export const triageItemFromCommunication = (orgId: string, communication: CommunicationResult): TriageItem => {
  const event: ExternalEventEnvelope = {
    event_id: `reconcile:${communication.id}`,
    source: 'communications',
    type: 'communication.received',
    communication_id: communication.id,
    ask_id: communication.purpose?.ask_id,
    channel: communication.channel === 'email' ? 'email' : undefined,
    occurred_at: communication.occurredAt,
    response: { text: communication.content },
    correlation: {
      tenant_id: orgId,
      project_id: communication.correlation?.external_project_id || communication.correlation?.project_id,
      run_id: communication.correlation?.run_id,
      task_id: communication.correlation?.task_id,
      person_id: communication.correlation?.person_id
    },
    payload: { channel: communication.channel, thread_id: communication.threadId }
  };
  return triageItemFromEvent(event, communication);
};
