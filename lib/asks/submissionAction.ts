import type { HumanAsk, HumanResponse } from '../../types.js';
export type AskSubmissionAction = 'answer' | 'comment' | 'close_recovery';

/** Explicit authenticated web answers need no model interpretation when there is no field schema. */
export function applySubmissionAction(ask: HumanAsk, response: HumanResponse, action?: AskSubmissionAction, verified = false): HumanResponse {
  if (!action) return response;
  if (!verified || response.via !== 'web') throw new Error('Sign in to submit an explicit answer or comment');
  if (action === 'comment') {
    if (!response.text?.trim()) throw new Error('Enter a comment');
    return {...response, decision: undefined, values: undefined, attachments: undefined, needsInterpretation: true};
  }
  if (action === 'answer' && ask.kind === 'question' && !(ask.fields || []).length) {
    if (!response.text?.trim()) throw new Error('Enter an answer');
    return {...response, needsInterpretation: undefined};
  }
  return response;
}
