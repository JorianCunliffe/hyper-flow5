import type { HumanAsk } from '../../types.js';

/** Expires an unanswered ask without altering settled or cancelled asks. */
export const expireAsk = (ask: HumanAsk, now = Date.now()): HumanAsk =>
  ask.status === 'open' && !!ask.dueAt && now >= ask.dueAt
    ? { ...ask, status: 'expired' }
    : ask;
