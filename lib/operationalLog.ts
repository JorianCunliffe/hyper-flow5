import { createHash, randomUUID } from 'node:crypto';

export type OperationalEventInput = {
  tenantId: string; type: string; status?: string; severity?: 'info' | 'warning' | 'error';
  projectId?: string; runId?: string; nodeId?: string; askId?: string; communicationId?: string;
  operationId?: string; occurrenceId?: string; campaignId?: string; sourceId?: string;
  actorId?: string; at?: number; dedupeKey?: string; details?: Record<string, unknown>;
};
const identifiers = ['projectId','runId','nodeId','askId','communicationId','operationId','occurrenceId','campaignId','sourceId','actorId'] as const;
const detailKeys = new Set(['revision','expectedRevision','storedRevision','policyRevision','attempt','latencyMs','tokens','round','providerCalled','count','model','promptVersion','reasonCode','providerCode','previousStatus','decision','channel','scheduleId','deployment','errorCode']);
const safeText = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || !value || value.length > 180) return undefined;
  // No URLs, addresses, arbitrary messages, JWTs or credential-shaped values.
  if (!/^[a-zA-Z0-9_:. -]+$/.test(value) || /bearer|secret|token=|password|eyJ[A-Za-z0-9_-]+\./i.test(value)) return undefined;
  return value;
};
export function operationalEvent(input: OperationalEventInput, now = Date.now()) {
  if (!/^[a-zA-Z0-9_-]{1,120}$/.test(input.tenantId)) throw new Error('Invalid log tenant');
  if (!/^[a-z][a-z0-9_.]{1,100}$/.test(input.type)) throw new Error('Invalid log event type');
  const at = Number.isSafeInteger(input.at) && input.at! > 0 ? input.at! : now;
  const details: Record<string, unknown> = {};
  for (const [k,v] of Object.entries(input.details || {})) {
    if (!detailKeys.has(k)) continue;
    if (typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) details[k] = v;
    else { const text = safeText(v); if (text) details[k] = text; }
  }
  const correlation: Partial<Record<typeof identifiers[number],string>> = {};
  for (const k of identifiers) { const value = safeText(input[k]); if (value) correlation[k] = value; }
  const fingerprint = createHash('sha256').update(input.dedupeKey || randomUUID()).digest('hex');
  return {
    schemaVersion: 1, id: `${String(at).padStart(13,'0')}_${fingerprint.slice(0,32)}`,
    service: 'hyperflow', tenantId: input.tenantId, at, type: input.type,
    severity: ['info','warning','error'].includes(input.severity || '') ? input.severity : 'info',
    status: safeText(input.status) || 'recorded', ...correlation, details,
    build: safeText(process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT) || 'unknown',
  };
}
export type OperationalEvent = ReturnType<typeof operationalEvent>;
const localHealth = { failedWrites: 0, lastFailureAt: 0, lastSuccessAt: 0 };
export const operationalLogLocalHealth = () => ({ ...localHealth, status: localHealth.failedWrites ? 'degraded' : localHealth.lastSuccessAt ? 'ok' : 'unknown' });

export async function recordOperationalEvent(input: OperationalEventInput, persist?: (event: OperationalEvent) => Promise<void>): Promise<void> {
  try {
    const event = operationalEvent(input);
    if (persist) await persist(event);
    else {
      const { runtimeDatabase } = await import('./runtimeDatabase.js');
      const db = await runtimeDatabase();
      await db.ref(`operational_events/${event.tenantId}/${event.id}`).transaction(current => current || event, undefined, false);
      await db.ref(`operational_log_health/${event.tenantId}`).update({ lastSuccessAt: Date.now() });
    }
    localHealth.lastSuccessAt = Date.now();
  } catch {
    // Do not turn a completed external effect into a retry because diagnostics failed.
    localHealth.failedWrites++;
    localHealth.lastFailureAt = Date.now();
    console.error('[operational-log] write failed', { type: input.type, failedWrites: localHealth.failedWrites });
    if (!persist && /^[a-zA-Z0-9_-]{1,120}$/.test(input.tenantId)) {
      try {
        const { runtimeDatabase } = await import('./runtimeDatabase.js');
        await (await runtimeDatabase()).ref(`operational_log_health/${input.tenantId}`).update({ lastFailureAt: localHealth.lastFailureAt, gapDetected: true });
      } catch { /* The console/local health is the final fallback when storage is down. */ }
    }
  }
}

export type LogQuery = { before?: string; projectId?: string; runId?: string; operationId?: string; communicationId?: string; campaignId?: string; type?: string; severity?: string; from?: number; to?: number; archive?: boolean };
export function logQuery(raw: Record<string, unknown>): LogQuery {
  const result: any = {};
  for (const key of ['projectId','runId','operationId','communicationId','campaignId','type','severity']) {
    if (raw[key] !== undefined) { if (!safeText(raw[key])) throw new Error(`Invalid ${key}`); result[key] = raw[key]; }
  }
  if (raw.before !== undefined) {
    if (typeof raw.before !== 'string' || !/^\d{13}_[a-f0-9]{32}$/.test(raw.before)) throw new Error('Invalid cursor');
    result.before = raw.before;
  }
  for (const key of ['from','to']) if (raw[key] !== undefined) {
    const value = Number(raw[key]); if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Invalid ${key}`); result[key] = value;
  }
  if (result.from && result.to && result.from > result.to) throw new Error('Invalid time range');
  result.archive = raw.archive === 'true';
  return result;
}
export function selectLogPage(rows: Record<string, OperationalEvent>, query: LogQuery) {
  const sorted = Object.values(rows).filter(e => !query.before || e.id < query.before).sort((a,b) => b.id.localeCompare(a.id)).slice(0,200);
  const items = sorted.filter(e => (!query.from || e.at >= query.from) && (!query.to || e.at <= query.to)
    && ['projectId','runId','operationId','communicationId','campaignId','type','severity'].every(k => !(query as any)[k] || (e as any)[k] === (query as any)[k]));
  return { items, scanned: sorted.length, next: sorted.length === 200 ? sorted.at(-1)!.id : null };
}
export async function readOperationalEvents(tenantId: string, query: LogQuery) {
  const { runtimeDatabase } = await import('./runtimeDatabase.js');
  let ref = (await runtimeDatabase()).ref(`${query.archive ? 'operational_event_archive' : 'operational_events'}/${tenantId}`).orderByKey();
  if (query.before) ref = ref.endBefore(query.before);
  return selectLogPage((await ref.limitToLast(200).get()).val() || {}, query);
}
export async function operationalLogHealth(tenantId: string) {
  const { runtimeDatabase } = await import('./runtimeDatabase.js');
  const db = await runtimeDatabase();
  const [health, policy] = await Promise.all([db.ref(`operational_log_health/${tenantId}`).get(),db.ref(`operational_log_policy/${tenantId}`).get()]);
  const saved = health.val() || {};
  return { ...saved, status: saved.gapDetected ? 'degraded' : saved.lastSuccessAt ? 'ok' : 'unknown', local: operationalLogLocalHealth(), policy: policy.val() || { revision:0, hotRetentionDays:90 }, automaticDeletion:false };
}

/** Copy and remove the same bounded batch atomically. Archive retains original IDs. No purge API. */
export async function archiveOperationalEvents(tenantId: string, now = Date.now()) {
  const { runtimeDatabase } = await import('./runtimeDatabase.js');
  const db = await runtimeDatabase();
  const policy = (await db.ref(`operational_log_policy/${tenantId}`).get()).val() || {hotRetentionDays:90};
  const cutoff = now - policy.hotRetentionDays * 86400000;
  const rows = (await db.ref(`operational_events/${tenantId}`).orderByKey().endBefore(`${String(cutoff).padStart(13,'0')}_`).limitToFirst(200).get()).val() || {};
  const updates: Record<string,unknown> = {};
  for (const [id,event] of Object.entries(rows)) {
    updates[`operational_event_archive/${tenantId}/${id}`] = event;
    updates[`operational_events/${tenantId}/${id}`] = null;
  }
  if (Object.keys(updates).length) await db.ref().update(updates);
  return { archived: Object.keys(rows).length, cutoff, morePossible:Object.keys(rows).length === 200 };
}
