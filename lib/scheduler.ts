import { randomUUID } from 'node:crypto';
import type { CommunicationsTriageSchedule, ScheduleRun, TenantSchedule, TriageDigest, TriageItem } from '../types.js';
import type { CommunicationResult, CommunicationsClient } from './communications/types.js';
import { createCommunicationsClient } from './communications/client.js';
import { advanceScheduledServerFlow, advanceServerFlow } from './serverFlow.js';
import { buildTriageDigest, triageItemFromCommunication } from './triage/emailTriage.js';
import { classifyEmailForTriage, emailAddressFromSender } from './triage/classifyEmail.js';
import { processAgentInbox } from './agentRouter.js';
import {
  advanceTenantSchedule,
  claimDueCoachingRetries,
  claimScheduleRun,
  finishScheduleRun,
  listDueSchedules,
  readCommunicationCursor,
  listTenantTriageItems,
  readTenantCommunicationsSettings,
  releaseCoachingRetry,
  saveTriageDigest,
  upsertTriageItem,
  writeCommunicationCursor
} from './serverStore.js';

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

export const reconciliationCursor = (
  committedCursor: string | undefined,
  scheduleCreatedAt: number
): string | undefined => {
  if (committedCursor) return committedCursor;
  return Number.isFinite(scheduleCreatedAt) && scheduleCreatedAt > 0
    ? new Date(scheduleCreatedAt).toISOString()
    : undefined;
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
  // Never advance over unseen mail. A later run can retry after the page limit
  // is increased or the backlog is reduced.
  throw new Error(`Inbound email backlog exceeded the ${maxPages * 200}-communication reconciliation limit`);
};

export interface ScheduleExecutionResult {
  scheduleId: string;
  status: 'completed' | 'failed' | 'duplicate' | 'skipped';
  processedCount?: number;
  projectId?: string;
  runId?: string;
  error?: string;
}

const deliverTriageDigest = async (
  client: CommunicationsClient,
  schedule: CommunicationsTriageSchedule,
  digest: TriageDigest,
  runId: string
): Promise<TriageDigest> => {
  if (digest.deliveryChannel === 'web') return digest;
  const settings = await readTenantCommunicationsSettings(schedule.orgId);
  const recipient = String(schedule.digestRecipient || '').trim();
  const allowed = settings.allowedAutomaticActions || [];
  const correlation = {
    tenant_id: schedule.orgId,
    run_id: runId,
    task_id: 'triage_digest'
  };
  if (!recipient) return {
    ...digest, deliveryStatus: 'needs_review', deliveryError: 'Digest recipient is not configured', updatedAt: Date.now()
  };
  if (digest.deliveryChannel === 'email') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) return {
      ...digest, deliveryStatus: 'failed', deliveryError: 'Digest email recipient is invalid', updatedAt: Date.now()
    };
    if (settings.mailboxConnectionId && schedule.connectionId === settings.mailboxConnectionId) {
      if (!allowed.includes('create_draft')) return {
        ...digest, deliveryStatus: 'needs_review', deliveryError: 'Mailbox draft permission is disabled', updatedAt: Date.now()
      };
      const draft = await client.createMailboxDraft(schedule.orgId, settings.mailboxConnectionId, {
        to: [recipient], subject: 'HyperFlow daily email triage', text: digest.summary,
        initiator_id: `schedule:${schedule.id}`
      }, `hyperflow:triage-digest:${schedule.orgId}:${digest.id}:draft:v1`);
      const id = String(draft.id || draft.provider_draft_id || '');
      if (!id) throw new Error('Communications API did not return a digest draft id');
      return { ...digest, deliveryStatus: 'drafted', deliveryId: id, updatedAt: Date.now() };
    }
    if (schedule.policy !== 'automatic' || !allowed.includes('send_reply')) return {
      ...digest, deliveryStatus: 'needs_review', deliveryError: 'Automatic digest email delivery is not approved', updatedAt: Date.now()
    };
    const identity = settings.defaultEmailIdentity || process.env.COMMUNICATIONS_EMAIL_IDENTITY;
    if (!identity) return {
      ...digest, deliveryStatus: 'failed', deliveryError: 'Outbound email service identity is not configured', updatedAt: Date.now()
    };
    const sent = await client.sendEmail({
      to: [recipient],
      ...(identity.includes('@') ? { from: identity } : { service_identity_id: identity }),
      ...(settings.connectionId ? { provider_connection_id: settings.connectionId } : {}),
      subject: 'HyperFlow daily email triage', text: digest.summary,
      correlation, purpose: { type: 'triage' }
    });
    return { ...digest, deliveryStatus: 'sent', deliveryId: sent.id, updatedAt: Date.now() };
  }
  if (!/^\+[1-9]\d{7,14}$/.test(recipient)) return {
    ...digest, deliveryStatus: 'failed', deliveryError: 'Digest SMS recipient must use E.164 format', updatedAt: Date.now()
  };
  if (schedule.policy !== 'automatic' || !allowed.includes('send_reply')) return {
    ...digest, deliveryStatus: 'needs_review', deliveryError: 'Automatic digest SMS delivery is not approved', updatedAt: Date.now()
  };
  const from = settings.fromNumber || process.env.COMMUNICATIONS_FROM_NUMBER;
  if (!from) return { ...digest, deliveryStatus: 'failed', deliveryError: 'SMS sender is not configured', updatedAt: Date.now() };
  const sent = await client.sendSms({
    to: recipient, from, body: digest.summary.slice(0, 1_500), correlation, purpose: { type: 'triage' }
  });
  return { ...digest, deliveryStatus: 'sent', deliveryId: sent.id, updatedAt: Date.now() };
};

export const runTenantSchedule = async (
  schedule: TenantSchedule,
  scheduledFor = schedule.nextRunAt
): Promise<ScheduleExecutionResult> => {
  const run = await claimScheduleRun(schedule, scheduledFor, randomUUID());
  if (!run) return { scheduleId: schedule.id, status: 'duplicate' };
  let cursorBefore: string | undefined;

  try {
    if (schedule.activity === 'flow_start') {
      const outcome = await advanceScheduledServerFlow(schedule.orgId, schedule.projectId, {
        scheduleId: schedule.id,
        scheduleRunId: run.id,
        scheduledFor,
        flowId: schedule.flowId,
        input: schedule.input,
        resetPolicy: schedule.resetPolicy,
        clearProjectDataKeys: schedule.clearProjectDataKeys
      });
      if (!outcome.ok) throw new Error(outcome.reason || 'Scheduled flow could not be started');
      await finishScheduleRun(run, { status: 'completed', processedCount: 1 });
      await advanceTenantSchedule(schedule, scheduledFor);
      return {
        scheduleId: schedule.id,
        status: 'completed',
        processedCount: 1,
        projectId: schedule.projectId,
        runId: run.id
      };
    }

    const cursorKey = schedule.connectionId || 'default';
    cursorBefore = reconciliationCursor(
      await readCommunicationCursor(schedule.orgId, cursorKey),
      schedule.createdAt
    );
    const client = createCommunicationsClient();
    if (schedule.connectionId) {
      const sync = await client.syncMailbox(schedule.orgId, schedule.connectionId, `schedule:${schedule.id}`);
      if (sync.in_progress === true) throw new Error('Mailbox reconciliation is already running; this occurrence will retry');
    }
    const candidates = await listInboundEmailSince(client, schedule.orgId, cursorBefore, 20, schedule.connectionId);

    const loadedThreads = new Map<string, CommunicationResult[]>();
    const processedItems: TriageItem[] = [];
    const communicationsSettings = await readTenantCommunicationsSettings(schedule.orgId);
    for (const communication of candidates) {
      const detailed = await client.getCommunication(schedule.orgId, communication.id);
      // Load the complete thread for relevant messages before classifying. The
      // classifier sees bounded context, not just a subject line.
      if (detailed.threadId && !loadedThreads.has(detailed.threadId)) {
        const thread = await client.getThread(schedule.orgId, detailed.threadId);
        loadedThreads.set(detailed.threadId, thread.communications);
      }
      let item = triageItemFromCommunication(schedule.orgId, detailed);
      if (item.memoryEligible !== false) {
        try {
          const analysis = await classifyEmailForTriage(detailed, detailed.threadId ? loadedThreads.get(detailed.threadId) : []);
          item = {
            ...item,
            priority: analysis.priority,
            intent: analysis.intent,
            requestedAction: analysis.requestedAction,
            deadline: analysis.deadline,
            risk: analysis.risk,
            summary: analysis.summary,
            evidence: analysis.evidence,
            recommendation: analysis.recommendation,
            interpretation: {
              intent: analysis.intent,
              confidence: analysis.confidence,
              evidence: analysis.evidence.join(' | '),
              modelVersion: analysis.modelVersion,
              interpretedAt: Date.now()
            },
            disposition: analysis.risk === 'high' || analysis.confidence < 0.7 ? 'needs_review' : item.disposition,
            proposedAction: analysis.recommendation,
            audit: [...item.audit, { at: Date.now(), action: 'triage.classified', actor: analysis.modelVersion }]
          };
          const draftingEnabled = (communicationsSettings.allowedAutomaticActions || []).includes('create_draft');
          const recipient = emailAddressFromSender(detailed.sender);
          if (schedule.connectionId && draftingEnabled && analysis.shouldDraft && recipient && analysis.draftBody) {
            try {
              const draft = await client.createMailboxDraft(schedule.orgId, schedule.connectionId, {
                to: [recipient],
                subject: analysis.draftSubject || (/^re:/i.test(detailed.subject || '') ? detailed.subject! : `Re: ${detailed.subject || 'Your email'}`),
                text: analysis.draftBody,
                communication_id: detailed.id,
                provider_thread_id: detailed.providerThreadId,
                in_reply_to: detailed.messageId,
                references: detailed.messageId,
                initiator_id: `schedule:${schedule.id}`
              }, `hyperflow:triage:${schedule.orgId}:${detailed.id}:draft:v1`);
              item = {
                ...item,
                providerDraftId: typeof draft.provider_draft_id === 'string' ? draft.provider_draft_id : undefined,
                disposition: 'draft_prepared',
                proposedAction: 'Review the provider-native Gmail draft; it has not been sent',
                audit: [...item.audit, { at: Date.now(), action: 'mailbox.draft.created', actor: schedule.id }]
              };
            } catch (error: any) {
              item = {
                ...item,
                disposition: 'needs_review',
                proposedAction: 'Draft creation failed; review the email and retry explicitly',
                audit: [...item.audit, { at: Date.now(), action: 'mailbox.draft.failed', actor: schedule.id, detail: String(error?.message || error).slice(0, 300) }]
              };
            }
          }
        } catch (error: any) {
          item = {
            ...item,
            disposition: 'needs_review',
            proposedAction: 'Automated classification failed; review this message manually',
            audit: [...item.audit, { at: Date.now(), action: 'triage.classification_failed', actor: schedule.id, detail: String(error?.message || error).slice(0, 300) }]
          };
        }
      }
      const storedItem = await upsertTriageItem({
        ...item,
        proposedAction: schedule.policy === 'draft_only' && item.disposition !== 'draft_prepared'
          ? `${item.proposedAction || 'Review this message'}; automatic sending is disabled`
          : item.proposedAction,
        audit: [...item.audit, { at: Date.now(), action: 'scheduled_reconciliation', actor: schedule.id }]
      });
      processedItems.push(storedItem);
    }

    const currentTriage = await listTenantTriageItems(schedule.orgId, 250);
    let digest = buildTriageDigest({
      orgId: schedule.orgId,
      scheduleId: schedule.id,
      scheduledFor,
      timezone: schedule.timezone,
      items: currentTriage.filter(item => item.channel === 'email'),
      newItemIds: processedItems.map(item => item.id),
      deliveryChannel: schedule.digestChannel || 'web'
    });
    await saveTriageDigest(digest);
    try {
      digest = await deliverTriageDigest(client, schedule, digest, run.id);
    } catch (error: any) {
      digest = {
        ...digest, deliveryStatus: 'failed',
        deliveryError: String(error?.message || error).slice(0, 1_000), updatedAt: Date.now()
      };
    }
    await saveTriageDigest(digest);

    const cursorAfter = cursorAfterCommunications(cursorBefore, candidates);
    if (cursorAfter) await writeCommunicationCursor(schedule.orgId, cursorKey, cursorAfter);
    await finishScheduleRun(run, {
      status: 'completed',
      cursorBefore,
      cursorAfter,
      processedCount: candidates.length
    });
    await advanceTenantSchedule(schedule, scheduledFor);
    return { scheduleId: schedule.id, status: 'completed', processedCount: candidates.length };
  } catch (error: any) {
    const message = error?.message || String(error);
    await finishScheduleRun(run, { status: 'failed', cursorBefore, error: message });
    // A failed run does not advance the cursor or schedule occurrence. The
    // stale-run lease allows a later tick to retry this exact occurrence.
    return { scheduleId: schedule.id, status: 'failed', error: message };
  }
};

export const tickSchedules = async (now = Date.now()): Promise<ScheduleExecutionResult[]> => {
  const agentJobs = await processAgentInbox(10);
  const coachingRetries = await claimDueCoachingRetries(now, 10);
  const due = (await listDueSchedules(now)).slice(0, 25);
  const results: ScheduleExecutionResult[] = agentJobs.claimed
    ? [{ scheduleId: 'agent_inbox', status: 'completed', processedCount: agentJobs.completed }]
    : [];
  for (const retry of coachingRetries) {
    try {
      const outcome = await advanceServerFlow(retry.orgId, retry.projectId);
      if (!outcome.ok) throw new Error(outcome.reason || 'Coaching retry could not advance');
      results.push({
        scheduleId: retry.scheduleId || `coaching_retry:${retry.id}`,
        status: 'completed', processedCount: 1, projectId: retry.projectId, runId: retry.scheduleRunId
      });
    } catch (error: any) {
      const message = error?.message || String(error);
      await releaseCoachingRetry(retry, message);
      results.push({
        scheduleId: retry.scheduleId || `coaching_retry:${retry.id}`,
        status: 'failed', projectId: retry.projectId, runId: retry.scheduleRunId, error: message
      });
    }
  }
  for (const schedule of due) {
    const overdueBy = now - schedule.nextRunAt;
    const occurrenceWindow = Math.max(5, schedule.intervalMinutes) * 60_000;
    if (schedule.misfirePolicy === 'skip' && overdueBy >= occurrenceWindow) {
      await advanceTenantSchedule(schedule, schedule.nextRunAt, now);
      results.push({ scheduleId: schedule.id, status: 'skipped' });
      continue;
    }
    results.push(await runTenantSchedule(schedule, schedule.nextRunAt));
  }
  return results;
};
