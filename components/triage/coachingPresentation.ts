import type { CoachingSession } from '../../types';

export type CoachingTone = 'emerald' | 'violet' | 'red' | 'amber' | 'slate';

export interface CoachingPresentation {
  label: string;
  detail: string;
  nextStep: string;
  tone: CoachingTone;
}

const retryDate = (value?: number) => value ? new Date(value).toLocaleString() : undefined;

export const coachingPresentation = (session: CoachingSession): CoachingPresentation => {
  if (session.status === 'completed') return {
    label: 'Completed',
    detail: session.sheetWrite ? 'The coaching outcome and tracker update are recorded.' : 'The coaching outcome is recorded; no tracker write is linked.',
    nextStep: session.nextActions || session.commitments || 'Review the outcome and confirm the next coaching focus.',
    tone: 'emerald'
  };
  if (session.status === 'review_required') return {
    label: 'Needs review',
    detail: 'The extracted coaching outcome needs a person to review it before it is treated as final.',
    nextStep: 'Review the summary, commitments, next actions, and supporting transcript evidence.',
    tone: 'amber'
  };
  if (session.status === 'failed') {
    const retryAt = session.retryStatus === 'pending' ? retryDate(session.nextRetryAt) : undefined;
    return {
      label: session.retryStatus === 'pending' ? 'Retry scheduled' : 'Failed',
      detail: session.failureReason || 'The coaching call did not produce a completed human coaching outcome.',
      nextStep: retryAt ? `The next retry is scheduled for ${retryAt}.` : session.retryStatus === 'exhausted' ? 'The retry window is exhausted; review the failure before trying again.' : 'Review the failure and retry policy before running another call.',
      tone: 'red'
    };
  }
  if (session.status === 'calling') return {
    label: 'Call in progress',
    detail: 'The coaching call has started but no final outcome is recorded yet.',
    nextStep: 'Wait for the call outcome and transcript processing to complete.',
    tone: 'violet'
  };
  return {
    label: 'Scheduled',
    detail: 'The coaching occurrence is queued and has not started yet.',
    nextStep: session.scheduledFor ? `Scheduled for ${new Date(session.scheduledFor).toLocaleString()}.` : 'Wait for the scheduled run or start it from the coaching project.',
    tone: 'slate'
  };
};

export const coachingToneClass = (tone: CoachingTone) => ({
  emerald: 'bg-emerald-50 text-emerald-700',
  violet: 'bg-violet-50 text-violet-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600'
}[tone]);
