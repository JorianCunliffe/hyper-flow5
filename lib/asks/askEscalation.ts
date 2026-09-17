import type { HumanAsk } from '../../types.js';
import type { FlowHoldConfig } from '../flowRuntimeTypes.js';
import type { CommunicationResult } from '../communications/types.js';
import { nextDailyScheduleOccurrence } from '../serverStore.js';

export type EscalationPlan = NonNullable<NonNullable<FlowHoldConfig['human']>['escalation']>;
export const validateEscalation = (plan: EscalationPlan): void => {
  if (![plan.primaryPersonId, plan.fallbackPersonId].every(id => typeof id === 'string' && id.trim() && !id.includes('{{'))) throw new Error('Escalation requires two configured person IDs');
  if (!Number.isInteger(plan.retryMinutes) || plan.retryMinutes < 1 || plan.retryMinutes > 1440) throw new Error('Retry delay must be 1–1440 minutes');
  nextDailyScheduleOccurrence(Date.now(), plan.repeatLocalTime, plan.timezone, plan.daysOfWeek);
};
export const escalationStep = (plan: EscalationPlan, step: number) => ({
  personId: step === 2 || step === 4 ? plan.fallbackPersonId : plan.primaryPersonId,
  channel: step < 3 ? 'voice' as const : 'sms' as const
});
export const nextEscalationCycle = (plan: EscalationPlan, state: NonNullable<HumanAsk['escalationState']>, now: number) => ({
  cycle: state.cycle + 1, step: 0,
  nextAt: nextDailyScheduleOccurrence(now, plan.repeatLocalTime, plan.timezone, plan.daysOfWeek)
});
/** Unknown/pending provider state never authorizes another call. */
export const reconcileEscalationCall = (
  plan: EscalationPlan, state: NonNullable<HumanAsk['escalationState']>, communication: CommunicationResult, now: number
): NonNullable<HumanAsk['escalationState']> => {
  if (!['completed', 'failed'].includes(communication.status)) return { ...state, nextAt: now + 60_000 };
  const output = { ...(communication.outcome || {}), ...(communication.output || {}) };
  if (output.conversation_completed === true || output.successful === true || output.disposition === 'human_completed') return nextEscalationCycle(plan, state, now);
  const didNotConnect = communication.status === 'failed' || ['no_answer', 'busy', 'voicemail', 'provider_failed', 'canceled'].includes(String(output.disposition));
  if (!didNotConnect) return { ...state, nextAt: now + 300_000, error: 'Provider outcome is not sufficient to authorize another call' };
  return { cycle: state.cycle, step: state.step + 1, nextAt: now + (state.step === 0 ? plan.retryMinutes * 60_000 : 0) };
};
