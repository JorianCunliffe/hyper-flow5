export type CapturedWorkKind = 'task' | 'meeting' | 'reminder' | 'follow_up' | 'note' | 'unknown';
export type CapturedWorkStatus = 'captured' | 'clarifying' | 'resolved' | 'dismissed';
export interface WorkIntent {
  id: string;
  kind: Exclude<CapturedWorkKind, 'unknown'>;
  title: string;
  projectId?: string;
  at?: number;
  durationMinutes?: number;
  mode?: 'in_person' | 'phone' | 'online';
  location?: string;
  notes?: string;
  // Intent is ready for an explicit downstream primitive, not an executed effect.
  executionStatus: 'not_executed';
}
export interface CapturedWorkItem {
  id: string; orgId: string; capturedForUserId: string;
  rawText: string; title?: string; kind?: CapturedWorkKind;
  sourceProjectId?: string; sourceRunId?: string; sourceNodeId?: string;
  sourceCommunicationId?: string; sourceThreadId?: string;
  proposedProjectId?: string; proposedProjectName?: string;
  proposedAt?: number; proposedDueAt?: number; proposedLocation?: string; notes?: string;
  proposedMode?: 'in_person' | 'phone' | 'online'; proposedDurationMinutes?: number;
  status: CapturedWorkStatus; createdAt: number; updatedAt: number; version: number;
  captureFingerprint: string;
  resolvedAt?: number; resolvedObjectId?: string; resolvedObjectType?: 'work_intent';
  resolvedProjectId?: string; resolutionSummary?: string; intent?: WorkIntent;
}
export interface CaptureReviewConfig {
  scope?: 'current_run' | 'current_project' | 'user_unresolved';
  maxItems?: number;
  includeOlderItems?: boolean;
  capturedForUserId?: string;
}
export interface CaptureReviewState {
  itemIds: string[];
  cursor: number;
  askId?: string;
  itemVersion?: number;
  completedIds: string[];
  draft?: Record<string, any>; stage?: string; ownerId?: string;
  intents?: WorkIntent[];
}
export class CaptureError extends Error {
  constructor(public status: number, message: string) { super(message); }
}
export const kinds: CapturedWorkKind[] = ['task', 'meeting', 'reminder', 'follow_up', 'note', 'unknown'];
export const unresolved = (item: CapturedWorkItem) => item.status === 'captured' || item.status === 'clarifying';
export function text(value: unknown, name: string, max = 4000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new CaptureError(422, `${name} must be nonempty text (maximum ${max} characters)`);
  return value.trim();
}
export function instant(value: unknown, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 8_640_000_000_000_000) throw new CaptureError(422, `${name} must be an epoch timestamp in milliseconds`);
  return value;
}
export function captureFields(body: Record<string, unknown>, includeSource = false): Partial<CapturedWorkItem> {
  const result: Record<string, unknown> = {};
  const strings = ['title', 'proposedProjectId', 'proposedProjectName', 'proposedLocation', 'notes'];
  if (includeSource) strings.push('sourceProjectId', 'sourceRunId', 'sourceNodeId', 'sourceCommunicationId', 'sourceThreadId');
  for (const key of strings) if (body[key] !== undefined) result[key] = body[key] === '' || body[key] === null ? null : text(body[key], key, key === 'notes' ? 4000 : 500);
  for (const key of ['proposedAt', 'proposedDueAt']) if (body[key] !== undefined) result[key] = body[key] === null ? null : instant(body[key], key);
  if (body.proposedMode !== undefined) {
    if (!['in_person', 'phone', 'online'].includes(String(body.proposedMode))) throw new CaptureError(422, 'Invalid proposed meeting mode');
    result.proposedMode = body.proposedMode;
  }
  if (body.proposedDurationMinutes !== undefined) {
    const minutes = body.proposedDurationMinutes;
    if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new CaptureError(422, 'Duration must be 1–1440 minutes');
    result.proposedDurationMinutes = minutes;
  }
  if (body.kind !== undefined) {
    if (!kinds.includes(body.kind as CapturedWorkKind)) throw new CaptureError(422, 'Invalid kind');
    result.kind = body.kind;
  }
  return result;
}
export function normalizeIntent(input: any, id: string): WorkIntent {
  if (!input || !kinds.includes(input.kind) || input.kind === 'unknown') throw new CaptureError(422, 'Choose a work kind');
  const intent: WorkIntent = { id, kind: input.kind, title: text(input.title, 'title', 500), executionStatus: 'not_executed' };
  if (input.projectId) intent.projectId = text(input.projectId, 'projectId', 500);
  if (input.notes) intent.notes = text(input.notes, 'notes');
  if (input.at !== undefined) intent.at = instant(input.at, 'at');
  if (input.kind === 'reminder' && !intent.at) throw new CaptureError(422, 'Reminder time is required');
  if (input.kind === 'meeting') {
    if (!intent.at) throw new CaptureError(422, 'Meeting time is required');
    if (!['in_person', 'phone', 'online'].includes(input.mode)) throw new CaptureError(422, 'Meeting mode is required');
    intent.mode = input.mode;
    const minutes = input.durationMinutes ?? 30;
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 1440) throw new CaptureError(422, 'Duration must be 1–1440 minutes');
    intent.durationMinutes = minutes;
    if (input.mode === 'in_person') intent.location = text(input.location, 'Meeting location', 500);
  }
  return intent;
}
export function transition(item: CapturedWorkItem, operation: string, body: any, now = Date.now()): CapturedWorkItem {
  if (operation === 'resolve' && item.status === 'resolved' && JSON.stringify(normalizeIntent(body.intent, `${item.id}_intent`)) === JSON.stringify(item.intent)) return item;
  if (operation === 'dismiss' && item.status === 'dismissed') return item;
  if (!unresolved(item)) throw new CaptureError(409, 'This item is already closed');
  if (body.version !== item.version) throw new CaptureError(409, 'Item changed; refresh before reviewing');
  const next = { ...item, updatedAt: now, version: item.version + 1 };
  if (operation === 'resolve') {
    if (body.confirmed !== true) throw new CaptureError(422, 'Explicit confirmation is required');
    const intent = normalizeIntent(body.intent, `${item.id}_intent`);
    return { ...next, status: 'resolved', intent, resolvedAt: now, resolvedObjectId: intent.id, resolvedObjectType: 'work_intent', ...(intent.projectId ? { resolvedProjectId: intent.projectId } : {}), resolutionSummary: 'Confirmed work intent; downstream execution is still required.' };
  }
  if (operation === 'dismiss') return { ...next, status: 'dismissed' };
  if (operation === 'update') return { ...next, ...captureFields(body), status: 'clarifying' };
  throw new CaptureError(400, 'Unknown operation');
}
export function selectReviewItems(items: CapturedWorkItem[], config: CaptureReviewConfig, context: { userId: string; projectId: string; runId?: string; startedAt?: number }): CapturedWorkItem[] {
  if (!context.userId) throw new CaptureError(422, 'Configure a review owner');
  const scope = config.scope || 'user_unresolved';
  if (!['current_run', 'current_project', 'user_unresolved'].includes(scope)) throw new CaptureError(422, 'Invalid review scope');
  const max = config.maxItems ?? 5;
  if (!Number.isInteger(max) || max < 1 || max > 20) throw new CaptureError(422, 'Review limit must be 1–20');
  return items.filter(item => unresolved(item) && item.capturedForUserId === context.userId &&
    (scope !== 'current_run' || (!!context.runId && item.sourceRunId === context.runId)) &&
    (scope !== 'current_project' || item.sourceProjectId === context.projectId || item.proposedProjectId === context.projectId) &&
    (config.includeOlderItems !== false || item.createdAt >= (context.startedAt ?? Infinity)))
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)).slice(0, max);
}
