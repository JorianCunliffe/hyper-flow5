import type { CommunicationResult, CommunicationsClient } from '../communications/types.js';
import { createCommunicationsClient } from '../communications/client.js';
import {
  listTenantTriageItems,
  readCommunicationCursor,
  readTenantCommunicationsSettings,
  saveTriageDigest,
  upsertTriageItem,
  writeCommunicationCursor
} from '../serverStore.js';
import type { TriageDigest, TriageItem } from '../../types.js';
import { buildTriageDigest, triageItemFromCommunication } from './emailTriage.js';
import { classifyEmailForTriage, emailAddressFromSender } from './classifyEmail.js';

export type EmailTriagePolicy = 'all_inbound' | 'human_only' | 'correlated_only';
export type EmailTriageSendPolicy = 'draft_only' | 'allow_approved_send' | 'automatic';

export interface RunEmailTriageInput {
  orgId: string;
  projectId?: string;
  connectionId: string;
  triagePolicy?: EmailTriagePolicy;
  createDrafts?: boolean;
  sendPolicy?: EmailTriageSendPolicy;
  digestChannel?: 'web' | 'email' | 'sms';
  digestRecipient?: string;
  scheduleId?: string;
  scheduledFor?: number;
  timezone?: string;
  runId: string;
  actor?: string;
  createdAt?: number;
  batchSize?: number;
}

export interface RunEmailTriageResult {
  processedCount: number;
  skippedCount: number;
  cursorBefore?: string;
  cursorAfter?: string;
  hasMore: boolean;
  remainingCount: number;
  digest: TriageDigest;
}

export const occurredMs = (value: string | undefined): number => {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : 0;
};

export const communicationsAfterCursor = <T extends { occurredAt?: string }>(
  communications: T[],
  cursor?: string
): T[] => {
  const cutoff = occurredMs(cursor);
  return communications
    .filter(item => occurredMs(item.occurredAt) > cutoff)
    .sort((a, b) => occurredMs(a.occurredAt) - occurredMs(b.occurredAt));
};

export const cursorAfterCommunications = <T extends { occurredAt?: string }>(
  previous: string | undefined,
  communications: T[]
): string | undefined => communications.reduce<string | undefined>(
  (latest, item) => occurredMs(item.occurredAt) > occurredMs(latest) ? item.occurredAt : latest,
  previous
);

export const boundedCommunicationBatch = <T extends { occurredAt?: string }>(
  communications: T[],
  requestedSize: number
): T[] => {
  const size = Math.min(Math.max(Math.floor(requestedSize) || 1, 1), 25);
  if (communications.length <= size) return communications;
  const boundary = occurredMs(communications[size - 1]?.occurredAt);
  let end = size;
  // The stored timestamp cursor is exclusive. Include every record at the
  // boundary so moving the cursor never drops an equal-timestamp sibling.
  while (end < communications.length && occurredMs(communications[end]?.occurredAt) === boundary) end += 1;
  return communications.slice(0, end);
};

export const reconciliationCursor = (
  committedCursor: string | undefined,
  createdAt: number
): string | undefined => {
  if (committedCursor) return committedCursor;
  return Number.isFinite(createdAt) && createdAt > 0 ? new Date(createdAt).toISOString() : undefined;
};

export const listInboundEmailSince = async (
  client: CommunicationsClient,
  orgId: string,
  committedCursor?: string,
  maxPages = 20,
  connectionId?: string
): Promise<CommunicationResult[]> => {
  const collected: CommunicationResult[] = [];
  let pageCursor: string | undefined;
  const cutoff = occurredMs(committedCursor);
  for (let page = 0; page < maxPages; page++) {
    const listed = await client.listCommunications(orgId, {
      cursor: pageCursor,
      limit: 200,
      channel: 'email',
      direction: 'inbound',
      connectionId
    });
    collected.push(...listed.data.filter(item => occurredMs(item.occurredAt) > cutoff));
    const reachedCommittedHistory = listed.data.some(item => occurredMs(item.occurredAt) <= cutoff);
    if (reachedCommittedHistory || !listed.nextCursor || listed.data.length === 0) {
      return communicationsAfterCursor(collected, committedCursor);
    }
    pageCursor = listed.nextCursor;
  }
  throw new Error(`Inbound email backlog exceeded the ${maxPages * 200}-communication reconciliation limit`);
};

export const matchesProjectTriagePolicy = (
  communication: CommunicationResult,
  item: TriageItem,
  policy: EmailTriagePolicy,
  projectId?: string
): boolean => {
  if (policy === 'human_only') return item.memoryEligible !== false;
  if (policy === 'correlated_only') {
    if (!projectId) return false;
    const correlatedProject = communication.correlation?.external_project_id || communication.correlation?.project_id;
    return correlatedProject === projectId;
  }
  return true;
};

export const projectTriageCursorKey = (projectId: string | undefined, connectionId: string): string =>
  projectId ? `project:${projectId}:mailbox:${connectionId}` : connectionId;

const deliverDigest = async (
  client: CommunicationsClient,
  input: RunEmailTriageInput,
  digest: TriageDigest
): Promise<TriageDigest> => {
  if (digest.deliveryChannel === 'web') return digest;
  const settings = await readTenantCommunicationsSettings(input.orgId);
  const recipient = String(input.digestRecipient || '').trim();
  const allowed = settings.allowedAutomaticActions || [];
  const correlation = {
    tenant_id: input.orgId,
    ...(input.projectId ? { external_project_id: input.projectId } : {}),
    run_id: input.runId,
    task_id: 'triage_digest'
  };
  if (!recipient) return { ...digest, deliveryStatus: 'needs_review', deliveryError: 'Digest recipient is not configured', updatedAt: Date.now() };
  if (digest.deliveryChannel === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return { ...digest, deliveryStatus: 'failed', deliveryError: 'Digest email recipient is invalid', updatedAt: Date.now() };
    if (allowed.includes('create_draft')) {
      const draft = await client.createMailboxDraft(input.orgId, input.connectionId, {
        to: [recipient], subject: 'HyperFlow daily email triage', text: digest.summary,
        initiator_id: input.actor || `project:${input.projectId || 'legacy'}`
      }, `hyperflow:triage-digest:${input.orgId}:${digest.id}:draft:v1`);
      const id = String(draft.id || draft.provider_draft_id || '');
      if (!id) throw new Error('Communications API did not return a digest draft id');
      return { ...digest, deliveryStatus: 'drafted', deliveryId: id, updatedAt: Date.now() };
    }
    if (input.sendPolicy !== 'automatic' || !allowed.includes('send_reply')) return { ...digest, deliveryStatus: 'needs_review', deliveryError: 'Automatic digest email delivery is not approved', updatedAt: Date.now() };
    const identity = settings.defaultEmailIdentity || process.env.COMMUNICATIONS_EMAIL_IDENTITY;
    if (!identity) return { ...digest, deliveryStatus: 'failed', deliveryError: 'Outbound email service identity is not configured', updatedAt: Date.now() };
    const sent = await client.sendEmail({
      to: [recipient],
      ...(identity.includes('@') ? { from: identity } : { service_identity_id: identity }),
      ...(settings.connectionId ? { provider_connection_id: settings.connectionId } : {}),
      subject: 'HyperFlow daily email triage', text: digest.summary,
      correlation, purpose: { type: 'triage' }
    });
    return { ...digest, deliveryStatus: 'sent', deliveryId: sent.id, updatedAt: Date.now() };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) return { ...digest, deliveryStatus: 'failed', deliveryError: 'Digest SMS recipient must use E.164 format', updatedAt: Date.now() };
  if (input.sendPolicy !== 'automatic' || !allowed.includes('send_reply')) return { ...digest, deliveryStatus: 'needs_review', deliveryError: 'Automatic digest SMS delivery is not approved', updatedAt: Date.now() };
  const from = settings.fromNumber || process.env.COMMUNICATIONS_FROM_NUMBER;
  if (!from) return { ...digest, deliveryStatus: 'failed', deliveryError: 'SMS sender is not configured', updatedAt: Date.now() };
  const sent = await client.sendSms({ to: recipient, from, body: digest.summary.slice(0, 1_500), correlation, purpose: { type: 'triage' } });
  return { ...digest, deliveryStatus: 'sent', deliveryId: sent.id, updatedAt: Date.now() };
};

export const runEmailTriage = async (
  input: RunEmailTriageInput,
  client: CommunicationsClient = createCommunicationsClient()
): Promise<RunEmailTriageResult> => {
  if (!input.orgId || !input.connectionId || !input.runId) throw new Error('Email triage requires orgId, connectionId and runId');
  const scheduledFor = input.scheduledFor || Date.now();
  const scheduleId = input.scheduleId || `project:${input.projectId || 'legacy'}`;
  const cursorKey = projectTriageCursorKey(input.projectId, input.connectionId);
  const cursorBefore = reconciliationCursor(await readCommunicationCursor(input.orgId, cursorKey), input.createdAt || scheduledFor);
  const sync = await client.syncMailbox(input.orgId, input.connectionId, input.actor || `run:${input.runId}`);
  if (sync.in_progress === true) throw new Error('Mailbox reconciliation is already running; retry this occurrence later');
  const candidates = await listInboundEmailSince(client, input.orgId, cursorBefore, 20, input.connectionId);
  const settings = await readTenantCommunicationsSettings(input.orgId);
  const allowed = settings.allowedAutomaticActions || [];
  const policy = input.triagePolicy || 'human_only';
  const loadedThreads = new Map<string, CommunicationResult[]>();
  const processedItems: TriageItem[] = [];
  let skippedCount = 0;

  // A serverless timeout can occur after individual triage items are safely
  // committed but before the cursor is moved. Reuse those project-scoped audit
  // records as checkpoints instead of classifying and drafting them again.
  const recentItems = await listTenantTriageItems(input.orgId, 500);
  const completedIds = new Set(recentItems
    .filter(item => item.projectId === input.projectId
      && item.connectionId === input.connectionId
      && item.audit?.some(entry => entry.action === 'project_reconciliation'))
    .map(item => item.communicationId));
  const pending = candidates.filter(item => !completedIds.has(item.id));
  const configuredBatchSize = Number(input.batchSize ?? process.env.EMAIL_TRIAGE_BATCH_SIZE ?? 5);
  const batch = boundedCommunicationBatch(pending, configuredBatchSize);

  for (const communication of batch) {
    const detailed = await client.getCommunication(input.orgId, communication.id);
    let item = { ...triageItemFromCommunication(input.orgId, detailed), projectId: input.projectId, connectionId: input.connectionId };
    if (!matchesProjectTriagePolicy(detailed, item, policy, input.projectId)) {
      skippedCount += 1;
      completedIds.add(communication.id);
      continue;
    }
    if (item.memoryEligible !== false && allowed.includes('classify')) {
      if (detailed.threadId && !loadedThreads.has(detailed.threadId)) {
        const thread = await client.getThread(input.orgId, detailed.threadId);
        loadedThreads.set(detailed.threadId, thread.communications);
      }
      try {
        const analysis = await classifyEmailForTriage(detailed, detailed.threadId ? loadedThreads.get(detailed.threadId) : []);
        item = {
          ...item,
          priority: analysis.priority, intent: analysis.intent, requestedAction: analysis.requestedAction,
          deadline: analysis.deadline, risk: analysis.risk, summary: analysis.summary,
          evidence: analysis.evidence, recommendation: analysis.recommendation,
          interpretation: { intent: analysis.intent, confidence: analysis.confidence, evidence: analysis.evidence.join(' | '), modelVersion: analysis.modelVersion, interpretedAt: Date.now() },
          disposition: analysis.risk === 'high' || analysis.confidence < 0.7 ? 'needs_review' : item.disposition,
          proposedAction: analysis.recommendation,
          audit: [...item.audit, { at: Date.now(), action: 'triage.classified', actor: analysis.modelVersion }]
        };
        const recipient = emailAddressFromSender(detailed.sender);
        if (input.createDrafts !== false && allowed.includes('create_draft') && analysis.shouldDraft && recipient && analysis.draftBody) {
          try {
            const draft = await client.createMailboxDraft(input.orgId, input.connectionId, {
              to: [recipient],
              subject: analysis.draftSubject || (/^re:/i.test(detailed.subject || '') ? detailed.subject! : `Re: ${detailed.subject || 'Your email'}`),
              text: analysis.draftBody, communication_id: detailed.id, provider_thread_id: detailed.providerThreadId,
              in_reply_to: detailed.messageId, references: detailed.messageId,
              initiator_id: input.actor || `project:${input.projectId || 'legacy'}`
            }, `hyperflow:triage:${input.orgId}:${input.projectId || 'legacy'}:${detailed.id}:draft:v1`);
            item = {
              ...item,
              providerDraftId: typeof draft.provider_draft_id === 'string' ? draft.provider_draft_id : undefined,
              disposition: 'draft_prepared',
              proposedAction: 'Review the provider-native mailbox draft; it has not been sent',
              audit: [...item.audit, { at: Date.now(), action: 'mailbox.draft.created', actor: input.actor || input.runId }]
            };
          } catch (error: any) {
            item = { ...item, disposition: 'needs_review', proposedAction: 'Draft creation failed; review the email and retry explicitly', audit: [...item.audit, { at: Date.now(), action: 'mailbox.draft.failed', actor: input.actor || input.runId, detail: String(error?.message || error).slice(0, 300) }] };
          }
        }
      } catch (error: any) {
        item = { ...item, disposition: 'needs_review', proposedAction: 'Automated classification failed; review this message manually', audit: [...item.audit, { at: Date.now(), action: 'triage.classification_failed', actor: input.actor || input.runId, detail: String(error?.message || error).slice(0, 300) }] };
      }
    } else if (item.memoryEligible !== false) {
      item = { ...item, disposition: 'needs_review', proposedAction: 'Classification is disabled by the tenant automatic-action policy' };
    }
    const stored = await upsertTriageItem({
      ...item,
      proposedAction: input.sendPolicy === 'draft_only' && item.disposition !== 'draft_prepared' ? `${item.proposedAction || 'Review this message'}; automatic sending is disabled` : item.proposedAction,
      audit: [...item.audit, { at: Date.now(), action: 'project_reconciliation', actor: input.actor || input.runId }]
    });
    processedItems.push(stored);
    completedIds.add(communication.id);
  }

  const current = await listTenantTriageItems(input.orgId, 500);
  let digest = buildTriageDigest({
    orgId: input.orgId, projectId: input.projectId, scheduleId, scheduledFor,
    timezone: input.timezone || 'Australia/Brisbane',
    items: current.filter(item => item.channel === 'email' && item.connectionId === input.connectionId && (!input.projectId || item.projectId === input.projectId)),
    newItemIds: processedItems.map(item => item.id), deliveryChannel: input.digestChannel || 'web'
  });
  await saveTriageDigest(digest);
  try { digest = await deliverDigest(client, input, digest); }
  catch (error: any) { digest = { ...digest, deliveryStatus: 'failed', deliveryError: String(error?.message || error).slice(0, 1_000), updatedAt: Date.now() }; }
  await saveTriageDigest(digest);
  let contiguousCount = 0;
  while (contiguousCount < candidates.length && completedIds.has(candidates[contiguousCount].id)) {
    contiguousCount += 1;
  }
  const cursorAfter = cursorAfterCommunications(cursorBefore, candidates.slice(0, contiguousCount));
  if (cursorAfter) await writeCommunicationCursor(input.orgId, cursorKey, cursorAfter);
  return {
    processedCount: processedItems.length,
    skippedCount,
    cursorBefore,
    cursorAfter,
    hasMore: contiguousCount < candidates.length,
    remainingCount: Math.max(0, candidates.length - contiguousCount),
    digest
  };
};
