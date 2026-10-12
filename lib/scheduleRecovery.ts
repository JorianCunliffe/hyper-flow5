import { createHash } from 'node:crypto';
import { runtimeDatabase } from './runtimeDatabase.js';
import { decodeRtdbRecord, encodeRtdbRecord } from './rtdbJson.js';
import { normalizeFlowRun } from './flowRunStore.js';
import { flowRunIdForOccurrence } from './flowRun.js';
import { actionAttemptIdentity } from './flowOrchestrator.js';
import { nextDailyScheduleOccurrence } from './serverStore.js';
import { HttpCommunicationsClient } from './communications/client.js';
import { recordOperationalEvent } from './operationalLog.js';

export class RecoveryError extends Error { constructor(public status: number, message: string) { super(message); } }
const fail = (message: string): never => { throw new RecoveryError(409, message); };
const key = (v: string) => encodeURIComponent(v).replace(/\./g, '%2E');
const digest = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const clean = (v: any) => JSON.parse(JSON.stringify(v));
const scheduleVersion = (s: any) => { const { recoveryCommands, recoveryPendingId, ...configuration } = s; return digest(configuration); };
export type RecoveryChoice = 'resume_future' | 'retry_original' | 'keep_held';
export function requireRecoveryAdministrator(member: {role:string;apiClientId?:string}) {
  if(member.apiClientId || !['owner','admin'].includes(member.role)) throw new RecoveryError(403,'A human administrator must review schedule recovery');
}

/** Derive only the frozen provider key. Never infer a new identifier for reconciliation. */
export function recoveryProviderKey(row: any): string | null {
  const request: any = Object.values(row.providerRequests || {}).find((v: any) => v?.correlation?.run_id === row.id);
  const ask = request?.purpose?.ask_id;
  return row.id.startsWith('op:') && !ask ? row.id : request
    ? `hyperflow:${row.orgId}:${request.correlation.external_project_id || request.correlation.project_id}:${row.id}:${request.correlation.task_id}:voice:${ask || 'action'}` : null;
}
export async function readProvider(row: any, configuredClient?: Pick<HttpCommunicationsClient,'readCallOperation'|'getCommunication'>) {
  const id = recoveryProviderKey(row);
  if (!id) return { outcome: 'unknown', receiptStatus: 'unavailable' };
  let receiptFound = false;
  try {
    const client = configuredClient || new HttpCommunicationsClient();
    const receipt = await client.readCallOperation(row.orgId, id);
    receiptFound = true;
    if (receipt.status === 'failed') return { outcome: 'failed', receiptStatus: 'failed', providerId: receipt.provider_id || null };
    if (receipt.communication_id) {
      const communication = await client.getCommunication(row.orgId, receipt.communication_id);
      return { outcome: communication.status === 'completed' ? 'completed' : ['failed','cancelled'].includes(communication.status) ? 'failed' : 'in_progress', receiptStatus: receipt.status, communicationId: receipt.communication_id, providerId: receipt.provider_id || null };
    }
    return { outcome: 'unknown', receiptStatus: receipt.status };
  } catch (e: any) {
    // Only an explicit pre-dispatch failure plus a successful missing-receipt lookup allows retry.
    return { outcome: !receiptFound && e.status === 404 && row.providerCode === 'OUTBOUND_NOT_READY' && !row.externalId && !row.outcome && !row.terminal ? 'not_dispatched' : 'unknown', receiptStatus: !receiptFound && e.status === 404 ? 'missing' : 'unavailable' };
  }
}
export function nextRecoveryTime(schedule: any, now: number) {
  return schedule.recurrence?.kind === 'daily'
    ? nextDailyScheduleOccurrence(now, schedule.recurrence.localTime, schedule.timezone, schedule.recurrence.daysOfWeek)
    : now + Math.max(5, schedule.recurrence?.intervalMinutes || schedule.intervalMinutes) * 60000;
}
export function retryRun(run: any, dispatch: any, now: number) {
  const next = clean(run);
  const node = next.state.milestones.find((n: any) => n.id === dispatch.nodeId);
  if (!node?.actionConfig || node.actionConfig.lastRun?.id !== dispatch.id) fail('Original action no longer matches the held run');
  delete node.actionConfig.lastRun;
  const identity = actionAttemptIdentity({ id: run.projectId, ...next.state } as any, dispatch.nodeId);
  if (identity.runId !== dispatch.id) fail('The original operation cannot be retried without changing its identity');
  for (const ask of node.asks || []) if (ask.id === run.outboundRecoveryHold?.askId) { ask.status = 'answered'; ask.answeredAt = now; ask.appliedAt = now; }
  delete next.outboundRecoveryHold;
  delete next.completedAt;
  next.status = 'running'; next.updatedAt = now; next.revision = Number(run.revision || 0) + 1;
  return next;
}

/** Tenant-local durable saga. The schedule lock fences ticks/configuration while each step commits.
 * Lost responses resume the same command; provider dispatch is exclusively the normal scheduler path.
 */
export function createScheduleRecovery(deps = { database: runtimeDatabase, provider: readProvider, now: Date.now }) {
  const paths = (org: string, id: string, at: number) => ({ schedule: `schedules/${key(org)}/${key(id)}`, occurrence: `schedule_runs/${key(org)}/${key(id)}/${at}` });
  async function transact(ref: any, fn: (v: any) => any) {
    const listener = () => {};
    try {
      await new Promise<void>((resolve, reject) => { ref.on('value', listener, reject); ref.once('value', resolve, reject); });
      const result = await ref.transaction(fn, undefined, false);
      if (!result.committed) fail('Recovery state changed. Refresh the review.');
      return result.snapshot.val();
    } finally { ref.off('value', listener); }
  }
  async function snapshot(org: string, id: string, at: number) {
    const db = await deps.database(); const p = paths(org, id, at);
    const schedule = (await db.ref(p.schedule).get()).val();
    const occurrence = (await db.ref(p.occurrence).get()).val();
    if (!schedule || schedule.orgId !== org || !occurrence || occurrence.orgId !== org || occurrence.scheduleId !== id || occurrence.projectId !== schedule.projectId) throw new RecoveryError(404, 'Held schedule occurrence not found');
    const runId = occurrence.flowRunId || flowRunIdForOccurrence(org, schedule.projectId, occurrence.id);
    const flowPath = `flow_runs/${key(org)}/${key(schedule.projectId)}/${key(runId)}`;
    const raw = (await db.ref(flowPath).get()).val();
    const run = raw ? normalizeFlowRun(raw) : null;
    const savedCommand: any = Object.values(schedule.recoveryCommands || {}).find((c: any) => c.scheduledFor === at && c.operationId);
    const operationId = occurrence.recoveryOperationId || run?.outboundRecoveryHold?.operationId || savedCommand?.operationId;
    if (!operationId || !run || run.orgId !== org || run.projectId !== schedule.projectId || run.occurrenceId !== occurrence.id) fail('The original held workflow is unavailable');
    const dispatchPath = `action_dispatches/${key(org)}/${key(operationId)}`;
    const dispatch = decodeRtdbRecord((await db.ref(dispatchPath).get()).val());
    if (!dispatch || dispatch.orgId !== org || dispatch.projectId !== schedule.projectId || dispatch.flowRunId !== run.id || dispatch.request.taskType !== 'outgoing_call') fail('Original call operation is unavailable');
    return { db, p, schedule, occurrence, run, dispatch, flowPath, dispatchPath };
  }
  function checkHeld(s: any) {
    if (s.schedule.nextRunAt !== s.occurrence.scheduledFor || s.occurrence.recoveryResolution || !['failed','blocked'].includes(s.occurrence.status)
      || (!s.occurrence.manualReviewRequired && !s.occurrence.recoveryReviewedAt && s.occurrence.status !== 'blocked')) fail('This occurrence is no longer held at the schedule head');
    if (s.dispatch.leaseUntil > deps.now()) fail('The original dispatch still has an active worker');
  }
  function token(s: any, evidence: any, reviewedAt: number) {
    return digest([scheduleVersion(s.schedule), s.occurrence, s.run.revision, s.dispatch, evidence, reviewedAt]);
  }
  return {
    async preview(org: string, id: string, at: number) {
      const s = await snapshot(org,id,at);
      if (s.schedule.recoveryPendingId) {
        const command = s.schedule.recoveryCommands[s.schedule.recoveryPendingId];
        return { pending: { requestId: command.requestId, decision: command.decision,
          nextRunAt:command.decision==='resume_future' && command.nextRunAt<=deps.now()?nextRecoveryTime(s.schedule,deps.now()):command.nextRunAt,
          timeReviewRequired:command.decision==='resume_future' && command.nextRunAt<=deps.now() }, scheduledFor: at, timezone: s.schedule.timezone };
      }
      checkHeld(s);
      const evidence = await deps.provider(s.dispatch); const reviewedAt = deps.now();
      let canRetry = evidence.outcome === 'not_dispatched' && s.occurrence.providerOutcome === 'not_dispatched';
      if (canRetry) { try { retryRun(s.run,s.dispatch,reviewedAt); } catch { canRetry=false; } }
      const frozen: any = Object.values(s.dispatch.providerRequests || {})[0];
      canRetry=canRetry && typeof frozen?.to==='string' && /^\+[1-9]\d{7,14}$/.test(frozen.to);
      return { planHash: token(s,evidence,reviewedAt), reviewedAt, scheduledFor: at, timezone: s.schedule.timezone,
        nextRunAt: nextRecoveryTime(s.schedule, reviewedAt), evidence, canRetry, operationId: s.dispatch.id,
        recipient: frozen?.to || frozen?.to_number || s.dispatch.request.data.phoneNumber || 'Original configured recipient',
        explanation: canRetry ? 'Retry uses the original frozen request and operation ID on a scheduler tick.' : 'Retry is unavailable: no proof that the original call never dispatched. Future sessions can be resumed separately.' };
    },
    async apply(org: string, actor: string, body: any) {
      const { id, scheduledFor, requestId } = body;
      if (!/^[a-zA-Z0-9_-]{8,100}$/.test(requestId || '')) throw new RecoveryError(422,'A stable request ID is required');
      const s = await snapshot(org,id,scheduledFor); const ref = s.db.ref(s.p.schedule);
      let command = s.schedule.recoveryCommands?.[requestId];
      if (command) {
        if (command.actor !== actor || command.scheduledFor !== scheduledFor) fail('Recovery request belongs to another review');
        if (body.decision && body.decision !== command.decision) fail('Request ID was already used for another decision');
        if(body.decision && digest([body.decision,body.note?.trim(),body.planHash,body.reviewedAt,!!body.acceptUncertainty,!!body.confirmCall])!==command.approvalHash)fail('Request ID was already used for different review inputs');
        if (command.phase === 'completed') return command.receipt;
        if(command.decision==='resume_future' && command.nextRunAt<=deps.now()) {
          if(body.nextRunAt!==nextRecoveryTime(s.schedule,deps.now()))fail('The approved time has passed. Refresh evidence and confirm the new next call time.');
          command={...command,nextRunAt:body.nextRunAt};
          await transact(ref,current=>{
            if(current?.recoveryPendingId!==requestId)fail('Recovery ownership changed');
            return {...current,recoveryCommands:{...current.recoveryCommands,[requestId]:command}};
          });
        }
      } else {
        checkHeld(s);
        if (s.schedule.recoveryPendingId) fail('Another recovery is being applied. Continue that operation.');
        if (!['resume_future','retry_original','keep_held'].includes(body.decision) || typeof body.note !== 'string' || !body.note.trim() || body.note.length>1000) throw new RecoveryError(422,'Choose a recovery action and enter a note (up to 1000 characters)');
        if (!Number.isSafeInteger(body.reviewedAt) || body.reviewedAt>deps.now() || deps.now()-body.reviewedAt>600000) fail('Recovery preview expired. Review again.');
        const evidence = await deps.provider(s.dispatch);
        if (token(s,evidence,body.reviewedAt)!==body.planHash) fail('The schedule or provider evidence changed. Review again.');
        if (body.decision==='retry_original') {
          if (!body.confirmCall || evidence.outcome!=='not_dispatched' || s.occurrence.providerOutcome!=='not_dispatched') fail('Retry requires verified non-dispatch and explicit call confirmation');
          retryRun(s.run,s.dispatch,deps.now());
          const frozen:any=Object.values(s.dispatch.providerRequests || {})[0];
          if(typeof frozen?.to!=='string' || !/^\+[1-9]\d{7,14}$/.test(frozen.to))fail('The exact original recipient is unavailable for call approval');
        }
        if (body.decision==='resume_future' && ['unknown','in_progress'].includes(evidence.outcome) && !body.acceptUncertainty) fail('Acknowledge the unresolved original call before resuming independent future sessions');
        const nextRunAt = nextRecoveryTime(s.schedule,body.reviewedAt);
        if (body.decision==='resume_future' && nextRunAt<=deps.now()) fail('The reviewed next call time has passed. Review again.');
        command = clean({requestId,actor,scheduledFor,operationId:s.dispatch.id,decision:body.decision,note:body.note.trim(),evidence,nextRunAt,phase:'applying',at:deps.now(),runRevision:s.run.revision,occurrenceHash:digest(s.occurrence),dispatchHash:digest(s.dispatch),approvalHash:digest([body.decision,body.note.trim(),body.planHash,body.reviewedAt,!!body.acceptUncertainty,!!body.confirmCall])});
        await transact(ref,current=>{
          if (!current || current.recoveryPendingId || scheduleVersion(current)!==scheduleVersion(s.schedule)) return undefined;
          if (Object.keys(current.recoveryCommands || {}).length>=500) fail('Recovery history limit reached; administrator maintenance required');
          return {...current,recoveryPendingId:requestId,recoveryCommands:{...current.recoveryCommands,[requestId]:command}};
        });
      }
      // Keep the original operation/flow evidence intact when closing an occurrence.
      if (command.decision==='resume_future') {
        await transact(s.db.ref(s.p.occurrence),current=>{
          if(current?.recoveryResolution?.requestId===requestId)return current;
          if(digest(current)!==command.occurrenceHash)fail('Occurrence changed during recovery; keep held for operator review');
          return {...current,claimId:`recovery_${requestId}`,recoveryResolution:{requestId,decision:'resume_future',at:command.at,actor},manualReviewRequired:false};
        });
      } else if (command.decision==='retry_original') {
        // Each checkpoint carries the command ID, so a lost response never resets a newer attempt.
        await transact(s.db.ref(s.dispatchPath),raw=>{
          const current:any=decodeRtdbRecord(raw);
          if(current?.recoveryCommandId===requestId)return raw;
          if(digest(current)!==command.dispatchHash)fail('Dispatch changed during recovery');
          return encodeRtdbRecord({...current,recoveryCommandId:requestId,manualReviewRequired:false,providerCode:'',leaseUntil:0,updatedAt:command.at});
        });
        await transact(s.db.ref(s.flowPath),raw=>{
          const current=normalizeFlowRun(raw) as any;
          if(current.recoveryCommandId===requestId)return raw;
          if(current.revision!==command.runRevision)fail('Workflow changed during recovery');
          return encodeRtdbRecord({...retryRun(current,s.dispatch,command.at),recoveryCommandId:requestId});
        });
        await transact(s.db.ref(s.p.occurrence),current=>{
          if(current?.recoveryRetryCommandId===requestId)return current;
          if(digest(current)!==command.occurrenceHash)fail('Occurrence changed during recovery');
          return {...current,claimId:`recovery_${requestId}`,status:'recoverable',manualReviewRequired:false,recoveryReviewedAt:null,providerCode:null,recoveryStartedAt:null,recoveryDeadlineAt:null,retryAfter:0,recoveryRetryCommandId:requestId};
        });
      }
      const receipt = {requestId,decision:command.decision,at:command.at,originalScheduledFor:scheduledFor,
        nextRunAt:command.decision==='resume_future'?command.nextRunAt:s.schedule.nextRunAt,timezone:s.schedule.timezone,
        originalOutcome:command.evidence.outcome,callDispatched:false};
      const saved=await transact(ref,current=>{
        if(current?.recoveryCommands?.[requestId]?.phase==='completed')return current;
        if(current?.recoveryPendingId!==requestId)fail('Recovery ownership changed');
        if(command.decision==='resume_future' && command.nextRunAt<=deps.now())fail('The approved next call time has passed. Refresh and confirm a new time.');
        return {...current,...(command.decision==='keep_held'?{}:{enabled:true,nextRunAt:receipt.nextRunAt}),updatedAt:deps.now(),recoveryPendingId:null,
          recoveryCommands:{...current.recoveryCommands,[requestId]:{...command,phase:'completed',receipt}}};
      });
      await recordOperationalEvent({tenantId:org,type:'schedule.recovery_resolved',actorId:actor,operationId:requestId,status:command.decision,details:{scheduleId:id}});
      return saved.recoveryCommands[requestId].receipt;
    }
  };
}
export const scheduleRecovery = createScheduleRecovery();
