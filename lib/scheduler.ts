import { randomUUID } from 'node:crypto';
import type { ScheduleRun, TenantSchedule } from '../types.js';
import type { CommunicationResult, CommunicationsClient } from './communications/types.js';
import { createCommunicationsClient } from './communications/client.js';
import { triageItemFromCommunication } from './triage/emailTriage.js';
import {
  advanceTenantSchedule,
  claimScheduleRun,
  finishScheduleRun,
  listDueSchedules,
  readCommunicationCursor,
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

export const listInboundEmailSince = async (
  client: CommunicationsClient,
  orgId: string,
  committedCursor?: string,
  maxPages = 20
): Promise<CommunicationResult[]> => {
  const collected: CommunicationResult[] = [];
  let pageCursor: string | undefined;
  const cutoff = occurredMs(committedCursor);
  for (let page = 0; page < maxPages; page++) {
    const listed = await client.listCommunications(orgId, {
      cursor: pageCursor,
      limit: 200,
      channel: 'email',
      direction: 'inbound'
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
  status: 'completed' | 'failed' | 'duplicate';
  processedCount?: number;
  error?: string;
}

export const runTenantSchedule = async (
  schedule: TenantSchedule,
  scheduledFor = schedule.nextRunAt
): Promise<ScheduleExecutionResult> => {
  const run = await claimScheduleRun(schedule, scheduledFor, randomUUID());
  if (!run) return { scheduleId: schedule.id, status: 'duplicate' };
  const cursorKey = schedule.connectionId || 'default';
  const cursorBefore = await readCommunicationCursor(schedule.orgId, cursorKey);

  try {
    const client = createCommunicationsClient();
    const candidates = await listInboundEmailSince(client, schedule.orgId, cursorBefore);

    const loadedThreads = new Set<string>();
    for (const communication of candidates) {
      // Load the complete thread for relevant messages before classifying. The
      // current triage projection uses the communication itself, but the read
      // is intentional: later policies can use context without changing cursor
      // or idempotency semantics.
      if (communication.threadId && !loadedThreads.has(communication.threadId)) {
        await client.getThread(schedule.orgId, communication.threadId);
        loadedThreads.add(communication.threadId);
      }
      const item = triageItemFromCommunication(schedule.orgId, communication);
      await upsertTriageItem({
        ...item,
        proposedAction: schedule.policy === 'draft_only'
          ? 'Review and prepare a draft; automatic sending is disabled'
          : item.proposedAction,
        audit: [...item.audit, { at: Date.now(), action: 'scheduled_reconciliation', actor: schedule.id }]
      });
    }

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
  const due = (await listDueSchedules(now)).slice(0, 25);
  const results: ScheduleExecutionResult[] = [];
  for (const schedule of due) results.push(await runTenantSchedule(schedule, schedule.nextRunAt));
  return results;
};
