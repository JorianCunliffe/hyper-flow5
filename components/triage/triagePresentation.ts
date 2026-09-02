import type { AgentInboxJob, TriageItem } from '../../types';

export type TriageResponseTone = 'emerald' | 'indigo' | 'red' | 'amber' | 'slate';

export interface TriageResponsePresentation {
  kind: 'response_created' | 'draft_prepared' | 'draft_failed' | 'needs_review' | 'excluded' | 'none';
  label: string;
  detail: string;
  tone: TriageResponseTone;
}

const hasAuditAction = (item: TriageItem, action: string) =>
  item.audit?.some(entry => entry.action === action) === true;

export const triageResponsePresentation = (item: TriageItem, job?: AgentInboxJob): TriageResponsePresentation => {
  if (job?.responseCommunicationId) return {
    kind: 'response_created', label: 'Response created', tone: 'emerald',
    detail: 'A response communication is linked to this email.'
  };
  if (item.providerDraftId || job?.responseDraftId || item.disposition === 'draft_prepared') return {
    kind: 'draft_prepared', label: 'Draft prepared', tone: 'indigo',
    detail: 'A mailbox draft was prepared for review and has not been sent automatically.'
  };
  if (hasAuditAction(item, 'mailbox.draft.failed') || item.disposition === 'delivery_failure' || job?.status === 'failed') return {
    kind: 'draft_failed', label: 'Draft failed', tone: 'red',
    detail: 'An attempted draft or delivery failed. Open the timeline for the recorded error.'
  };
  if (item.memoryEligible === false || item.disposition === 'spam_automatic') return {
    kind: 'excluded', label: 'Excluded', tone: 'slate',
    detail: 'This automated, bounced, or spam-classified message is not eligible for drafting.'
  };
  if (item.disposition === 'needs_review' || job?.status === 'needs_review') return {
    kind: 'needs_review', label: 'Needs review', tone: 'amber',
    detail: 'A person needs to review this item before any response is prepared.'
  };
  return {
    kind: 'none', label: 'No draft recorded', tone: 'slate',
    detail: 'No draft is linked to this item. The current data does not record whether drafting was unnecessary or disabled.'
  };
};

export const triageResponseToneClass = (tone: TriageResponseTone) => ({
  emerald: 'bg-emerald-50 text-emerald-700',
  indigo: 'bg-indigo-50 text-indigo-700',
  red: 'bg-red-50 text-red-700',
  amber: 'bg-amber-50 text-amber-700',
  slate: 'bg-slate-100 text-slate-600'
}[tone]);

export const triageRecommendedAction = (item: TriageItem): string | undefined =>
  item.requestedAction || item.recommendation || item.proposedAction;
