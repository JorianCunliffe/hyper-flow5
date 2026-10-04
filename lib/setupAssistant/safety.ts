import { TenantControlError } from '../tenantControl/model.js';
import { hash, type Change } from '../configuration/model.js';
import type { SetupScope } from './types.js';

export const fail = (status: number, message: string): never => { throw new TenantControlError(status, message); };
const SECRET = /^token$|authorization|cookie|password|secret|api.?key|access.?token|refresh.?token|zapikey|credential/i;
export function redact(value: any): any {
  if (typeof value === 'string') return value
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[redacted]')
    .replace(/((?:zapikey|api[_-]?key|access_token|refresh_token|secret|token)=)[^&\s"']+/gi, '$1[redacted]')
    .replace(/hf\.[A-Za-z0-9_.-]+/g, '[redacted]')
    .replace(/\b(?:sk-[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{25,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)\b/g, '[redacted]');
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET.test(k) ? '[redacted]' : redact(v)]));
  return value;
}
export function noSecrets(value: any) {
  if (JSON.stringify(value) !== JSON.stringify(redact(value))) fail(422, 'Use connected resource references; enter credentials in the existing integration form.');
}
export function scopedChanges(scope: SetupScope, changes: Change[]) {
  if (!Array.isArray(changes) || !changes.length || changes.length > 100) fail(422, 'Supply 1–100 configuration changes.');
  noSecrets(changes);
  for (const c of changes) {
    if (!['project', 'node', 'subtask'].includes(c.resource)) fail(403, 'This assistant configures only its selected workflow.');
    const projectId = c.resource === 'project' ? c.id || c.value?.id : c.projectId;
    if (projectId !== scope.projectId) fail(403, 'Expand the session scope before changing another workflow.');
    if (scope.kind === 'element' && (c.resource !== 'node' || c.operation !== 'update' || c.id !== scope.nodeId)) fail(403, 'Expand to workflow scope before changing dependencies or other elements.');
  }
}
export function scopedExtras(scope: SetupScope, extras: any = {}) {
  if (!extras || Object.keys(extras).some(k => !['resources', 'schedules'].includes(k))) fail(422, 'Unsupported setup operation.');
  if (scope.kind === 'element' && ((extras.resources?.length || 0) + (extras.schedules?.length || 0))) fail(403, 'Expand to workflow scope before changing resources or schedules.');
  if (extras.resources !== undefined && (!Array.isArray(extras.resources) || extras.resources.length > 25)) fail(422, 'At most 25 named resources.');
  if (extras.schedules !== undefined && (!Array.isArray(extras.schedules) || extras.schedules.length > 10)) fail(422, 'At most 10 schedules.');
  for (const s of extras.schedules || []) {
    if (s.projectId !== scope.projectId || s.activity !== 'flow_start' || s.enabled === true) fail(422, 'Setup schedules must belong to this workflow, use flow_start, and remain disabled.');
    if (!['daily', 'interval'].includes(s.recurrence?.kind)) fail(422, 'Choose an existing daily or interval schedule.');
    if (s.recurrence.kind === 'daily' && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(s.recurrence.localTime || '')) fail(422, 'Supply a valid local schedule time.');
    if (s.recurrence.kind === 'interval' && (!Number.isFinite(s.recurrence.intervalMinutes) || s.recurrence.intervalMinutes < 1)) fail(422, 'Supply a positive interval in minutes.');
    try { new Intl.DateTimeFormat('en-AU', { timeZone: s.timezone }).format(); } catch { fail(422, 'Select a valid schedule timezone.'); }
    if (Object.keys(s.input || {}).some(k => /^(flow_|schedule_|communications_)|policy|grant|allowed|budget|permission|authority|enabled/i.test(k))) fail(422, 'Schedule inputs cannot override runtime or authority fields.');
  }
  noSecrets(extras);
}
export const reviewFingerprint = (value: any) => hash(value);
export function safeError(error: any) {
  if (error instanceof TenantControlError && error.status < 500) return redact(error.message).slice(0, 1000);
  return 'The operation could not be verified. Inspect its status before retrying.';
}
