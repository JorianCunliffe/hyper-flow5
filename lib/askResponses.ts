import { AskChannel, AskDecision, AskField, Attachment, HumanAsk, HumanResponse } from '../types';

/**
 * Turning what a person actually sent into a structured HumanResponse.
 *
 * Deterministic matching first, always. Most answers — especially by SMS — are a
 * single word, and an exact match is free, instant and cannot hallucinate. Only
 * genuine prose should ever reach a model, and anything a model inferred is
 * flagged so it cannot silently sign work off.
 */

let responseCounter = 0;
export const newResponseId = (): string =>
  `resp_${Date.now().toString(36)}_${(++responseCounter).toString(36)}`;

// Accepted only as a complete reply.
const APPROVE_WORDS = ['yes', 'y', 'approve', 'approved', 'ok', 'okay', 'yep', 'yeah', 'confirm', 'confirmed', 'accept', 'accepted', 'sign off', 'signed off', 'lgtm', '1'];
const REJECT_WORDS = ['no', 'n', 'reject', 'rejected', 'decline', 'declined', 'deny', 'denied', 'cancel', 'abandon', '3'];
const REVISE_WORDS = ['revise', 'revisit', 'redo', 'changes', 'change', 'rework', 'amend', 'again', 'send back', '2'];

/**
 * Accepted as the first word of a longer reply. Deliberately excludes short,
 * ambiguous words — "no", "ok" and "yes" open ordinary sentences ("no problem,
 * looks great") far too often to be read as commands there. Only unambiguous
 * imperatives qualify.
 */
const LEAD_APPROVE = ['approve', 'approved', 'confirm', 'confirmed', 'accept', 'accepted', 'lgtm'];
const LEAD_REJECT = ['reject', 'rejected', 'decline', 'declined', 'deny', 'denied', 'abandon'];
const LEAD_REVISE = ['revise', 'revisit', 'redo', 'rework', 'amend', 'changes', 'change'];

const normalise = (text: string) => text.trim().toLowerCase().replace(/[.!,;:]+$/, '');

/**
 * Matches a decision without a model.
 *
 * Whole-string match first: a reply of exactly "no" is a rejection, but "no
 * problem, looks great" must not be. Matching short command words anywhere in a
 * sentence is how these systems end up approving things nobody approved, so
 * anything that isn't an exact reply or an unambiguous leading imperative falls
 * through as unclassified for a human to read.
 */
export const parseDecisionText = (text: string | undefined): AskDecision | undefined => {
  if (!text) return undefined;
  const t = normalise(text);
  if (!t) return undefined;

  if (APPROVE_WORDS.includes(t)) return 'approved';
  if (REJECT_WORDS.includes(t)) return 'rejected';
  if (REVISE_WORDS.includes(t)) return 'revise';

  // Leading imperative followed by explanation: "revise - the pricing is wrong".
  const lead = t.split(/[\s\-–—:]+/)[0];
  if (LEAD_REVISE.includes(lead)) return 'revise';
  if (LEAD_REJECT.includes(lead)) return 'rejected';
  if (LEAD_APPROVE.includes(lead)) return 'approved';

  return undefined;
};

/** Coerces a raw submitted value to the field's declared type. */
export const coerceFieldValue = (field: AskField, raw: any): any => {
  if (raw === undefined || raw === null) return undefined;
  // An empty reply is not an answer — without this, Number('') coerces to 0 and
  // a blank becomes a real value in project data.
  if (typeof raw === 'string' && raw.trim() === '') return undefined;

  switch (field.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw;
      const t = normalise(String(raw));
      if (APPROVE_WORDS.includes(t)) return true;
      if (REJECT_WORDS.includes(t)) return false;
      return undefined;
    }
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? n : undefined;
    }
    case 'date': {
      const d = new Date(raw);
      return Number.isNaN(d.getTime()) ? undefined : d.toISOString().split('T')[0];
    }
    default:
      return typeof raw === 'string' ? raw.trim() : raw;
  }
};

/** Applies an ask's schema to a raw values object, dropping anything unrecognised. */
export const coerceValues = (ask: HumanAsk, raw: Record<string, any> | undefined): Record<string, any> => {
  if (!raw || typeof raw !== 'object') return {};

  const fields = ask.fields || [];
  if (fields.length === 0) {
    // No schema to validate against — accept scalars only, so a caller cannot
    // push arbitrary nested structures into project data.
    return Object.fromEntries(
      Object.entries(raw).filter(([, v]) => v === null || ['string', 'number', 'boolean'].includes(typeof v))
    );
  }

  const out: Record<string, any> = {};
  for (const field of fields) {
    const value = coerceFieldValue(field, raw[field.name]);
    if (value !== undefined) out[field.name] = value;
  }
  return out;
};

export interface BuildResponseInput {
  via: AskChannel;
  actor: string;
  decision?: AskDecision;
  text?: string;
  values?: Record<string, any>;
  attachments?: Attachment[];
  raw?: any;
  at?: number;
}

/**
 * Builds a normalised response for an ask.
 *
 * When no explicit decision is given, an approval ask tries to read one from the
 * reply text. If the text is prose we cannot classify, the response is recorded
 * but marked as needing interpretation — it will not close the ask.
 */
export const buildResponse = (ask: HumanAsk, input: BuildResponseInput): HumanResponse => {
  const values = coerceValues(ask, input.values);

  let decision = input.decision;
  let needsInterpretation = false;

  if (!decision && ask.kind === 'approval') {
    decision = parseDecisionText(input.text);
    if (!decision) needsInterpretation = true;
  }

  // A question ask answered with prose but no recognisable values needs a human
  // to look at it rather than being dropped on the floor.
  if (ask.kind !== 'approval' && input.text && Object.keys(values).length === 0 && !input.attachments?.length) {
    needsInterpretation = true;
  }

  return {
    id: newResponseId(),
    at: input.at ?? Date.now(),
    via: input.via,
    actor: input.actor,
    decision,
    text: input.text,
    values: Object.keys(values).length ? values : undefined,
    attachments: input.attachments?.length ? input.attachments : undefined,
    needsInterpretation: needsInterpretation || undefined,
    raw: input.raw
  };
};

/** A reviewer sending work back must say why — the comment is the agent's next instruction. */
export const validateResponse = (ask: HumanAsk, response: HumanResponse): string | null => {
  if (response.decision === 'revise' && !response.text?.trim()) {
    return 'Sending work back requires a comment explaining what needs to change.';
  }
  if (ask.kind === 'approval' && !response.decision && !response.needsInterpretation) {
    return 'A decision is required.';
  }
  return null;
};
