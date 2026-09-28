import type { HumanAsk } from '../../types.js';
import type { FlowHoldConfig } from '../flowRuntimeTypes.js';
import type { CommunicationResult } from '../communications/types.js';
import { nextDailyScheduleOccurrence } from '../serverStore.js';

export type EscalationPlan = NonNullable<NonNullable<FlowHoldConfig['human']>['escalation']>;
export const validateEscalation = (plan: EscalationPlan): void => {
  if (plan.mode !== undefined && !['morning', 'incident'].includes(plan.mode)) throw new Error('Unknown escalation mode');
  if (![plan.primaryPersonId, plan.fallbackPersonId].every(id => typeof id === 'string' && id.trim() && !id.includes('{{'))) throw new Error('Escalation requires two configured person IDs');
  if (!Number.isInteger(plan.retryMinutes) || plan.retryMinutes < 1 || plan.retryMinutes > 1440) throw new Error('Retry delay must be 1–1440 minutes');
  nextDailyScheduleOccurrence(Date.now(), plan.repeatLocalTime, plan.timezone, plan.daysOfWeek);
};
export const escalationLastStep = (plan: EscalationPlan): number => plan.mode === 'incident' ? 2 : 4;
export const escalationStep = (plan: EscalationPlan, step: number) => {
  if (!Number.isInteger(step) || step < 0 || step > escalationLastStep(plan)) throw new Error('Invalid escalation step');
  return {
    personId: step === 2 || step === 4 ? plan.fallbackPersonId : plan.primaryPersonId,
    channel: (plan.mode === 'incident' ? step === 1 : step >= 3) ? 'sms' as const : 'voice' as const
  };
};
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
  if (state.step === escalationLastStep(plan)) return nextEscalationCycle(plan, state, now);
  return { cycle: state.cycle, step: state.step + 1, nextAt: now + (state.step === 0 && plan.mode !== 'incident' ? plan.retryMinutes * 60_000 : 0) };
};
