import type { HumanAsk, HumanResponse, AskDecision } from '../../types.js';
import { createAsk } from '../asks/createAsk.js';
import { recordAskResponse } from '../humanAsk.js';
import { validateResponse } from '../askResponses.js';

export type CommitmentState = 'candidate' | 'accepted' | 'in_progress' | 'submitted' | 'fulfilled' | 'disputed' | 'cancelled' | 'dismissed';
export interface CommitmentTerms {
  owner: string; beneficiary: string; deliverable: string; criteria: string;
  dueAt: string; timezone: string;
}
export interface CommitmentSource {
  id: string; version: string; communicationIds: string[]; threadId?: string; wording: string;
  provider?: 'promise-ledger.v1'; jointPromisorIds?: string[];
}
export interface Commitment {
  id: string; orgId: string; projectId: string; version: number; state: CommitmentState;
  reviewerUid: string; createdBy: string; createdAt: number; updatedAt: number;
  terms: CommitmentTerms; proposedTerms?: CommitmentTerms; source?: CommitmentSource;
  sourceChanged?: boolean; observedSourceVersion?: string; acceptedEvidence?: string;
  submission?: { evidence: string; at: number; actor: string };
  review?: { kind: 'clarify' | 'accept' | 'change' | 'fulfill' | 'cancel'; ask: HumanAsk; version: number };
  asks: HumanAsk[];
  followUp: { enabled: boolean; leadHours: number; channel: 'web' };
  history: Array<{ version: number; at: number; actor: string; action: string; note: string; terms?: CommitmentTerms }>;
}
export class CommitmentError extends Error { constructor(public status: number, message: string) { super(message); } }
export function normalizeCommitment(value: Commitment): Commitment {
  const array = <T>(items: T[] | Record<string,T> | undefined): T[] => Array.isArray(items) ? items : Object.values(items || {});
  const ask = (item: HumanAsk): HumanAsk => ({ ...item, responses: array(item.responses), assignees: array(item.assignees), channels: array(item.channels), ...(item.fields ? { fields: array(item.fields) } : {}) });
  return { ...value, asks: array(value.asks).map(ask), history: array(value.history),
    ...(value.review ? { review: { ...value.review, ask: ask(value.review.ask) } } : {}),
    ...(value.source ? { source: { ...value.source, communicationIds: array(value.source.communicationIds) } } : {}) };
}
const fail = (status: number, message: string): never => { throw new CommitmentError(status, message); };
export const bounded = (value: unknown, max = 4000): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
export function readTerms(value: unknown): CommitmentTerms {
  const row = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return Object.fromEntries(['owner','beneficiary','deliverable','criteria','dueAt','timezone'].map(key => [key, bounded(row[key])])) as unknown as CommitmentTerms;
}
export function missingTerms(terms: CommitmentTerms): string[] {
  const missing = Object.entries(terms).filter(([,value]) => !value).map(([key]) => key);
  for (const key of ['owner','beneficiary'] as const) if (terms[key] && !/^(user|contact):[^\s]+$/.test(terms[key])) missing.push(key);
  if (terms.dueAt) {
    const date = new Date(`${terms.dueAt.slice(0,10)}T00:00:00Z`);
    if (!/^\d{4}-\d\d-\d\dT(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?(Z|[+-]\d\d:[0-5]\d)$/.test(terms.dueAt)
      || !Number.isFinite(Date.parse(terms.dueAt)) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== terms.dueAt.slice(0,10)) missing.push('dueAt');
  }
  if (terms.timezone) { try { new Intl.DateTimeFormat('en', { timeZone: terms.timezone }); } catch { missing.push('timezone'); } }
  return [...new Set(missing)];
}
function review(row: Commitment, kind: NonNullable<Commitment['review']>['kind'], now: number, askId: string): void {
  if (kind !== 'change') delete row.proposedTerms;
  if (row.review) { row.asks.push({ ...row.review.ask, status: 'cancelled' }); }
  const missing = missingTerms(row.proposedTerms || row.terms);
  const clarification = kind === 'clarify';
  const ask = createAsk({ askId, taskId: row.id, projectId: row.projectId,
    question: clarification ? `Clarify ${missing.join(', ') || 'the promise terms'} before acceptance.` : `${kind === 'fulfill' ? 'Accept the submitted evidence as fulfillment' : kind === 'change' ? 'Approve changed terms' : kind === 'cancel' ? 'Approve cancellation' : 'Accept this obligation'}: ${(row.proposedTerms || row.terms).deliverable}`,
    responseType: clarification ? 'question' : 'approval', assignees: [row.reviewerUid], channels: ['web'], now,
    fields: clarification ? missing.map(name => ({ name, type: 'string', required: true })) : undefined,
    responseContract: { automaticProgress: 'never', reviewRequired: true },
  });
  // This is an aggregate review revision, not a workflow run identifier.
  ask.revision = row.version;
  row.review = { kind, version: row.version, ask };
}
export function createCommitment(input: { id: string; orgId: string; projectId: string; actor: string; terms: unknown; source?: CommitmentSource; now: number; askId: string }): Commitment {
  const row: Commitment = { id: input.id, orgId: input.orgId, projectId: input.projectId, version: 1, state: 'candidate',
    reviewerUid: input.actor, createdBy: input.actor, createdAt: input.now, updatedAt: input.now, terms: readTerms(input.terms),
    ...(input.source ? { source: input.source } : {}), asks: [], followUp: { enabled: false, leadHours: 24, channel: 'web' },
    history: [{ version: 1, at: input.now, actor: input.actor, action: 'candidate_created', note: 'Requires explicit review; source status is not acceptance.', terms: readTerms(input.terms) }] };
  review(row, missingTerms(row.terms).length ? 'clarify' : 'accept', input.now, input.askId);
  return row;
}
export interface CommitmentCommand {
  action: 'respond' | 'terms' | 'progress' | 'submit' | 'dispute' | 'cancel' | 'dismiss' | 'follow_up';
  expectedVersion: number; askId?: string; decision?: AskDecision; note?: string; terms?: unknown;
  enabled?: boolean; leadHours?: number;
}
export function transitionCommitment(current: Commitment, command: CommitmentCommand, actor: string, now: number, nextAskId: string): Commitment {
  if (current.version !== command.expectedVersion) fail(409, 'This obligation changed. Reload before reviewing.');
  if (actor !== current.reviewerUid && current.terms.owner !== `user:${actor}` && current.terms.beneficiary !== `user:${actor}`) fail(403, 'Only the assigned parties or reviewer can change this obligation.');
  const row = structuredClone(current); const note = bounded(command.note);
  if (['fulfilled','cancelled','dismissed'].includes(row.state)) fail(409, 'This obligation is closed.');
  row.version++; row.updatedAt = now;
  const closeReview = () => { if (row.review) { row.asks.push({ ...row.review.ask, status: 'cancelled' }); delete row.review; } };
  if (command.action === 'respond') {
    const gate = current.review;
    if (!gate || gate.ask.id !== command.askId || gate.ask.status !== 'open' || gate.version !== current.version) fail(409, 'Only the current Ask can change this obligation.');
    if (actor !== current.reviewerUid) fail(403, 'This Ask is assigned to a different reviewer.');
    if (!note) fail(400, 'Record the acceptance evidence or reason for this decision.');
    if (gate.kind === 'clarify') {
      if (command.decision) fail(400, 'Clarification is not approval. Supply the missing terms first.');
      const terms = readTerms(command.terms);
      if (missingTerms(terms).length) fail(400, `Clarify: ${missingTerms(terms).join(', ')}.`);
      const response: HumanResponse = { id: `${gate.ask.id}:response`, at: now, via: 'web', actor, text: note, values: { ...terms } };
      const invalid = validateResponse(gate.ask, response); if (invalid) fail(400, invalid);
      row.asks.push(recordAskResponse(gate.ask, response)); delete row.review;
      row.terms = terms; review(row, 'accept', now, nextAskId);
    } else {
      if (command.terms && JSON.stringify(readTerms(command.terms)) !== JSON.stringify(readTerms(row.proposedTerms || row.terms))) fail(409, 'Save changed terms before answering this Ask.');
      const response: HumanResponse = { id: `${gate.ask.id}:response`, at: now, via: 'web', actor, text: note, decision: command.decision };
      const invalid = validateResponse(gate.ask, response); if (invalid) fail(400, invalid);
      if (!['approved','rejected','revise'].includes(String(command.decision))) fail(400, 'Choose approve, reject or revise.');
      row.asks.push(recordAskResponse(gate.ask, response)); delete row.review;
      if (command.decision === 'approved') {
        if (gate.kind === 'accept' || gate.kind === 'change') {
          const terms = row.proposedTerms || row.terms;
          if (missingTerms(terms).length) fail(400, 'Accepted terms must have an owner, beneficiary, deliverable, criteria, due instant and timezone.');
          row.terms = terms; delete row.proposedTerms; row.acceptedEvidence = note;
          if (gate.kind === 'accept') row.state = 'accepted';
        } else if (gate.kind === 'fulfill') {
          if (!row.submission?.evidence) fail(409, 'Submission evidence is required.');
          row.state = 'fulfilled';
        } else if (gate.kind === 'cancel') row.state = 'cancelled';
      } else if (gate.kind === 'accept') { row.state = command.decision === 'rejected' ? 'dismissed' : 'candidate'; }
      else if (gate.kind === 'fulfill') { row.state = 'in_progress'; delete row.submission; }
      else if (gate.kind === 'change') delete row.proposedTerms;
    }
  } else if (command.action === 'terms') {
    if (row.state === 'submitted') fail(409, 'Resolve the submission before changing terms.');
    const terms = readTerms(command.terms);
    if (row.state === 'candidate') { row.terms = terms; review(row, missingTerms(terms).length ? 'clarify' : 'accept', now, nextAskId); }
    else { if (missingTerms(terms).length || !note) fail(400, 'Proposed terms and a reason must be complete.'); row.proposedTerms = terms; review(row, 'change', now, nextAskId); }
  } else if (command.action === 'dismiss') {
    if (row.state !== 'candidate' || !note) fail(400, 'Only a candidate can be dismissed, with a reason.');
    if (actor !== row.reviewerUid) fail(403, 'Only the reviewer can dismiss this candidate.');
    row.state = 'dismissed'; closeReview();
  } else if (command.action === 'cancel') {
    if (!note) fail(400, 'A cancellation reason is required.'); review(row, 'cancel', now, nextAskId);
  } else if (command.action === 'follow_up') {
    if (actor !== row.reviewerUid) fail(403, 'Only the reviewer can configure follow-up.');
    if (typeof command.enabled !== 'boolean' || !Number.isFinite(command.leadHours) || command.leadHours! < 0 || command.leadHours! > 720) fail(400, 'Choose a follow-up lead time from 0 to 720 hours.');
    row.followUp = { enabled: command.enabled, leadHours: command.leadHours!, channel: 'web' };
  } else {
    if (row.state === 'candidate' || !row.acceptedEvidence) fail(409, 'Accept the obligation first.');
    if (!note) fail(400, 'Evidence or an explanation is required.');
    if (command.action === 'submit') {
      if (row.review || !['accepted','in_progress','disputed'].includes(row.state)) fail(409, 'Resolve the current review before submitting.');
      if (actor !== row.reviewerUid && row.terms.owner !== `user:${actor}`) fail(403, 'Only the owner or reviewer can submit.');
      row.submission = { evidence: note, at: now, actor }; row.state = 'submitted'; review(row, 'fulfill', now, nextAskId);
    } else if (command.action === 'progress') {
      if (row.review) fail(409, 'Resolve the current review first.'); row.state = 'in_progress';
    } else if (command.action === 'dispute') { row.state = 'disputed'; delete row.proposedTerms; closeReview(); }
    else fail(400, 'Unknown action.');
  }
  // Non-review edits invalidate stale versions without orphaning the current gate.
  if (row.review) { row.review.version = row.version; row.review.ask.revision = row.version; }
  row.history.push({ version: row.version, at: now, actor, action: command.action, note,
    ...(command.action === 'terms' || (command.action === 'respond' && (command.decision === 'approved' || current.review?.kind === 'clarify'))
      ? { terms: structuredClone(row.proposedTerms || row.terms) } : {}) });
  return row;
}
export function commitmentTiming(row: Commitment, now = Date.now()): { overdue: boolean; atRisk: boolean } {
  const active = !['candidate','fulfilled','cancelled','dismissed'].includes(row.state);
  const remaining = Date.parse(row.terms.dueAt) - now;
  return { overdue: active && remaining < 0, atRisk: active && (row.state === 'disputed' || Boolean(row.proposedTerms) || remaining <= row.followUp.leadHours * 3600000) };
}
