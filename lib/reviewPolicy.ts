import type { AskChannel, ReviewPolicy } from '../types.js';

const ALLOWED_CHANNELS = new Set<AskChannel>(['web', 'email', 'sms', 'voice']);

export interface ReviewPolicyDraft {
  required: boolean;
  reviewers: string[];
  channels: AskChannel[];
  slaHours: number | '';
  onExpiry: NonNullable<ReviewPolicy['onExpiry']>;
  maxRevisions: number | '';
}

export const buildReviewPolicy = (
  existing: ReviewPolicy | undefined,
  draft: ReviewPolicyDraft
): ReviewPolicy | undefined => {
  if (!draft.required) return undefined;

  const reviewers = Array.from(new Set(draft.reviewers.map(value => value.trim()).filter(Boolean)));
  const channels = Array.from(new Set(draft.channels.filter(channel => ALLOWED_CHANNELS.has(channel))));

  return {
    ...(existing || {}),
    required: true,
    reviewers: reviewers.length ? reviewers : undefined,
    channels: channels.length ? channels : ['web'],
    slaHours: draft.slaHours === '' ? undefined : Number(draft.slaHours),
    onExpiry: draft.onExpiry,
    maxRevisions: draft.maxRevisions === '' ? undefined : Number(draft.maxRevisions)
  };
};
