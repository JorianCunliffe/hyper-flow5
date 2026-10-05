import type { ScheduleRun } from '../types.js';

/** Provider holds are not failed scheduler infrastructure and never change keys. */
export function outboundScheduleRecovery(error: unknown, now = Date.now()): Partial<ScheduleRun> & Pick<ScheduleRun, 'status'> | null {
  const value = error as { providerCode?: string; responseBody?: { code?: string } };
  const code = value?.providerCode || value?.responseBody?.code;
  if (code === 'OUTBOUND_NOT_READY' || code === 'IDEMPOTENCY_IN_PROGRESS') {
    return { status: 'recoverable', providerCode: code, retryAfter: now + 15 * 60_000 };
  }
  if (code === 'IDEMPOTENCY_RECONCILIATION_REQUIRED' || code === 'OUTBOUND_PROVIDER_REJECTED') {
    return { status: 'blocked', providerCode: code, retryAfter: 0 };
  }
  return null;
}
