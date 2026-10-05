import type { ScheduleRun } from '../types.js';

/** Provider holds are not failed scheduler infrastructure and never change keys. */
export function outboundScheduleRecovery(error: unknown, now = Date.now(), previous?: Partial<ScheduleRun>): Partial<ScheduleRun> & Pick<ScheduleRun, 'status'> | null {
  const value = error as { providerCode?: string; operationId?: string; responseBody?: { code?: string } };
  const code = value?.providerCode || value?.responseBody?.code;
  if (value?.operationId && previous?.recoveryOperationId && value.operationId !== previous.recoveryOperationId) previous = undefined;
  if (!['OUTBOUND_NOT_READY', 'IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_RECONCILIATION_REQUIRED', 'OUTBOUND_PROVIDER_REJECTED'].includes(code || '')) return null;
  const firstFailureAt = previous?.recoveryStartedAt ?? now;
  const uncertain = code === 'IDEMPOTENCY_IN_PROGRESS' || code === 'IDEMPOTENCY_RECONCILIATION_REQUIRED';
  const deadline = Math.min(previous?.recoveryDeadlineAt ?? Infinity, firstFailureAt + (uncertain ? 30 : 60) * 60_000);
  const metadata = { providerCode: code, recoveryStartedAt: firstFailureAt, recoveryDeadlineAt: deadline,
    providerOutcome: uncertain ? 'unknown' as const : code === 'OUTBOUND_PROVIDER_REJECTED' ? 'rejected' as const : 'not_dispatched' as const };
  if (code === 'OUTBOUND_PROVIDER_REJECTED' || now >= deadline) {
    return { ...metadata, status: 'failed', retryAfter: 0, manualReviewRequired: true };
  }
  if (code === 'OUTBOUND_NOT_READY' || code === 'IDEMPOTENCY_IN_PROGRESS') {
    return { ...metadata, status: 'recoverable', retryAfter: Math.min(deadline, now + 15 * 60_000) };
  }
  if (code === 'IDEMPOTENCY_RECONCILIATION_REQUIRED' || code === 'OUTBOUND_PROVIDER_REJECTED') {
    return { ...metadata, status: 'blocked', retryAfter: Math.min(deadline, now + 5 * 60_000) };
  }
  return null;
}
