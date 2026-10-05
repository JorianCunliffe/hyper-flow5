import { encodeRtdbRecord, decodeRtdbRecord } from './rtdbJson.js';
import { createHash, randomUUID } from 'node:crypto';
import type { ActionExecutionContext, ActionExecutor, ActionOutcome } from './flowOrchestrator.js';
import { runtimeDatabase } from './runtimeDatabase.js';
import { withActionExecutionScope } from './actionExecutionScope.js';
import { TRIAGE_BATCH_CHECKPOINT } from './actionRecovery.js';

/** Infrastructure uncertainty must never enter a graph's business retry branch. */
export class ActionRecoveryRequired extends Error {
  readonly recoverable = true;
  constructor(message: string, public readonly providerCode?: string, public readonly operationId?: string) { super(message); }
}

export interface ActionDispatch {
  id: string;
  orgId: string;
  projectId: string;
  flowRunId?: string;
  nodeId: string;
  occurrenceId?: string;
  attempt: number;
  idempotencyKey: string;
  externalId?: string;
  state: 'claimed' | 'dispatching' | 'dispatched' | 'resolved';
  request: { taskType: string; template: string; data: Record<string, any>; context: ActionExecutionContext };
  createdAt: number;
  updatedAt: number;
  owner?: string;
  leaseUntil?: number;
  outcome?: ActionOutcome;
  terminal?: ActionOutcome;
  eventIds?: Record<string, true>;
  providerRequests?: Record<string, any>;
  providerCode?: string;
  manualReviewRequired?: boolean;
}

export interface DispatchStore {
  transact(orgId: string, id: string, update: (current: ActionDispatch | null) => ActionDispatch): Promise<ActionDispatch>;
}
const key = (value: string) => encodeURIComponent(value).replace(/\./g, '%2E');
const clean = <T>(value: T): T => JSON.parse(JSON.stringify(value));
export const dispatchStore: DispatchStore = {
  async transact(orgId, id, update) {
    const reference = (await runtimeDatabase()).ref(`action_dispatches/${key(orgId)}/${key(id)}`);
    const listener = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        reference.on('value', listener, reject);
        reference.once('value', () => resolve(), reject);
      });
      const result = await reference.transaction(current => encodeRtdbRecord(update(decodeRtdbRecord(current))), undefined, false);
      if (!result.committed) throw new ActionRecoveryRequired('Action dispatch transaction was not committed');
      return decodeRtdbRecord(result.snapshot.val());
    } finally { reference.off('value', listener); }
  }
};

export const readActionDispatch = async (orgId: string, id: string): Promise<ActionDispatch | null> =>
  decodeRtdbRecord((await (await runtimeDatabase()).ref(`action_dispatches/${key(orgId)}/${key(id)}`).get()).val());

export const listRunDispatches = async (orgId: string, flowRunId: string): Promise<ActionDispatch[]> => {
  const snapshot = await (await runtimeDatabase()).ref(`action_dispatches/${key(orgId)}`)
    .orderByChild('flowRunId').equalTo(flowRunId).get();
  return Object.values(snapshot.val() || {}).map(decodeRtdbRecord) as ActionDispatch[];
};

export const findDispatchByExternalId = async (orgId: string, projectId: string, externalId: string): Promise<ActionDispatch | null> => {
  const snapshot = await (await runtimeDatabase()).ref(`action_dispatches/${key(orgId)}`)
    .orderByChild('externalId').equalTo(externalId).get();
  const matches = (Object.values(snapshot.val() || {}).map(decodeRtdbRecord) as ActionDispatch[]).filter(row => row.projectId === projectId);
  return matches.length === 1 ? matches[0] : null;
};

/** Only adapters with a durable provider-side key can safely repeat an ambiguous POST. */
const replaySafe = (taskType: string): boolean =>
  ['read_google_doc', 'read_google_sheet', 'write_report', 'extract_coaching_result', 'run_email_triage'].includes(taskType)
  || ['outgoing_call', 'send_sms', 'send_email', 'create_mailbox_draft', 'update_mailbox_draft'].includes(taskType);

export const durableActionExecutor = (
  execute: ActionExecutor,
  store: DispatchStore = dispatchStore,
  now: () => number = Date.now,
  reconcile: (row: ActionDispatch) => Promise<ActionOutcome | null> = async row => (await import('./outboundCallReconciliation.js')).reconcileOutboundCall(row)
): ActionExecutor => async (taskType, template, data, context) => {
  if (!context.orgId || !context.runId) throw new ActionRecoveryRequired('Durable dispatch requires tenant and operation identity');
  const orgId = context.orgId;
  const id = context.runId;
  const owner = randomUUID();
  try {
    // Separate commits distinguish never dispatched from possibly dispatched.
    let row = await store.transact(orgId, id, current => current || {
      id, orgId, projectId: context.projectId, nodeId: context.nodeId,
      flowRunId: context.flowRunId, occurrenceId: context.occurrenceId, attempt: context.attempt || 1,
      idempotencyKey: id, state: 'claimed', createdAt: now(), updatedAt: now(),
      request: { taskType, template, data: clean(data), context: clean(context) }
    });
    if (row.projectId !== context.projectId || row.nodeId !== context.nodeId) throw new ActionRecoveryRequired('Operation identity belongs to another action');
    if (row.manualReviewRequired) throw new ActionRecoveryRequired('Outbound operation failed; operator review is required', row.providerCode, id);
    if (row.terminal || row.outcome) return row.terminal || row.outcome!;
    row = await store.transact(orgId, id, current => {
      if (!current) throw new ActionRecoveryRequired('Action claim disappeared');
      if (current.terminal || current.outcome) return current;
      if (current.state === 'dispatching' && ((current.leaseUntil || 0) > now() || !replaySafe(current.request.taskType))) return current;
      return { ...current, state: 'dispatching', owner, leaseUntil: now() + 120_000, updatedAt: now() };
    });
    if (row.terminal || row.outcome) return row.terminal || row.outcome!;
    if (row.owner !== owner) throw new ActionRecoveryRequired('Action already started; awaiting provider reconciliation');
    // Always replay the frozen request, including its original correlation/key.
    const request = row.request;
    if (request.taskType === 'outgoing_call' && ['IDEMPOTENCY_IN_PROGRESS', 'IDEMPOTENCY_RECONCILIATION_REQUIRED'].includes(row.providerCode || '')) {
      const reconciled = await reconcile(row);
      if (!reconciled) throw new ActionRecoveryRequired('Original call receipt is still unresolved; no new call was dispatched', 'IDEMPOTENCY_RECONCILIATION_REQUIRED', id);
      if (reconciled.status === 'error') throw new ActionRecoveryRequired(reconciled.error!, reconciled.providerCode, id);
      const saved = await store.transact(orgId, id, current => {
        if (!current || current.owner !== owner) throw new ActionRecoveryRequired('Dispatch ownership changed');
        return { ...current, outcome: reconciled, externalId: reconciled.externalExecutionId,
          state: 'dispatched', updatedAt: now() };
      });
      return saved.terminal || saved.outcome!;
    }
    const outcome = await withActionExecutionScope({
      freezeCommunicationRequest: async (path, requestKey, body) => {
        const index = createHash('sha256').update(JSON.stringify([path, requestKey])).digest('hex');
        const saved = await store.transact(orgId, id, current => {
          if (!current || current.owner !== owner) throw new ActionRecoveryRequired('Dispatch ownership changed');
          return { ...current, providerRequests: { ...(current.providerRequests || {}),
            [index]: current.providerRequests?.[index] || clean(body) } };
        });
        return saved.providerRequests![index];
      }
    }, () => execute(request.taskType, request.template, request.data, request.context));
    if (outcome.status === 'error' && !(outcome.providerCode==='CONTACT_POLICY_HOLD'&&outcome.output?.provider_called===false)) {
      // Network/HTTP errors cannot prove that the provider did not perform the effect.
      throw new ActionRecoveryRequired(outcome.error || 'Action outcome is uncertain', outcome.providerCode
        || (taskType === 'outgoing_call' ? 'IDEMPOTENCY_RECONCILIATION_REQUIRED' : undefined));
    }
    row = await store.transact(orgId, id, current => {
      if (!current) throw new ActionRecoveryRequired('Action claim disappeared');
      if (current.owner !== owner || current.terminal) return current;
      return { ...current, outcome, externalId: outcome.externalExecutionId || outcome.externalId || outcome.output?.communication_id,
        state: outcome.status === 'pending' ? 'dispatched' : 'resolved', updatedAt: now() };
    });
    if (!row.terminal && !row.outcome) throw new ActionRecoveryRequired('Action result needs reconciliation');
    return row.terminal || row.outcome!;
  } catch (error) {
    if (taskType === 'run_email_triage' && error instanceof ActionRecoveryRequired && error.message === TRIAGE_BATCH_CHECKPOINT) {
      // This batch has finished and committed its checkpoint; no request remains
      // in flight. Release only our lease so the same operation can continue now.
      await store.transact(orgId, id, current => {
        if (!current) throw error;
        return current.owner === owner && !current.outcome && !current.terminal
          ? { ...current, leaseUntil: 0, updatedAt: now() } : current;
      });
    }
    if (error instanceof ActionRecoveryRequired && error.providerCode) {
      await store.transact(orgId, id, current => {
        if (!current || current.owner !== owner) throw error;
        return { ...current, providerCode: error.providerCode, leaseUntil: 0, updatedAt: now() };
      });
      throw new ActionRecoveryRequired(error.message, error.providerCode, id);
    }
    if (error instanceof ActionRecoveryRequired) throw error;
    if (taskType === 'outgoing_call') {
      const code = (error as {responseBody?: {code?: string}})?.responseBody?.code || 'IDEMPOTENCY_RECONCILIATION_REQUIRED';
      await store.transact(orgId, id, current => {
        if (!current || current.owner !== owner) throw error;
        return {...current, providerCode: code, leaseUntil: 0, updatedAt: now()};
      });
      throw new ActionRecoveryRequired(error instanceof Error ? error.message : String(error), code, id);
    }
    throw new ActionRecoveryRequired(error instanceof Error ? error.message : String(error));
  }
};

/** Monotonic settlement: verified completion wins over failure regardless of arrival order. */
export const settleActionDispatch = async (
  orgId: string, id: string, eventId: string, outcome: ActionOutcome, store: DispatchStore = dispatchStore
): Promise<ActionDispatch> => store.transact(orgId, id, current => {
  if (!current) throw new ActionRecoveryRequired('Action correlation is not committed yet');
  const eventKey = createHash('sha256').update(eventId).digest('hex');
  if (current.eventIds?.[eventKey]) return current;
  const terminal = current.terminal?.status === 'success' ? current.terminal : outcome;
  return { ...current, terminal, externalId: current.externalId || outcome.externalExecutionId || outcome.externalId,
    state: 'resolved', updatedAt: Date.now(),
    eventIds: { ...(current.eventIds || {}), [eventKey]: true } };
});
