import { readFlowRun } from './flowRunStore.js';
import { executeTask } from './executeTask.js';
import type { ActionExecutor } from './flowOrchestrator.js';
import { claimContactDispatch, readTenantAgentProfile, readTenantCommunicationsSettings } from './serverStore.js';
import { assertCapabilityAllowed, TASK_CAPABILITY } from './capabilityPolicy.js';
import { readTenantCapabilityPolicy } from './capabilityPolicyStore.js';
import { resolveGrantedPersonTarget } from './actionTarget.js';
import { withActionExecutionScope } from './actionExecutionScope.js';
import { ActionRecoveryRequired, durableActionExecutor } from './actionDispatch.js';
import { normalizeTaskType } from './taskTypes.js';

const communicationChannel = (taskType: string): 'email' | 'sms' | 'voice' | undefined => {
  if (taskType === 'send_email') return 'email';
  if (taskType === 'send_sms') return 'sms';
  if (taskType === 'outgoing_call') return 'voice';
  return undefined;
};

const jsonTemplate = (templateFile: string): Record<string, any> | null => {
  try {
    const parsed = JSON.parse(templateFile);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const resourceNameFromTemplate = (templateFile: string): string | undefined => {
  const raw = jsonTemplate(templateFile)?.resource_name;
  if (raw === undefined || raw === null || raw === '') return undefined;
  const name = String(raw).trim();
  if (!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)) {
    throw new Error('resource_name must be a literal named project resource');
  }
  return name;
};

/**
 * Server-side action boundary. The graph decides what should happen; this layer
 * enforces tenant authority and resolves configured people/resources immediately
 * before the effect.
 */
const serverActionDependencies = { readTenantCommunicationsSettings, readTenantAgentProfile,
  readTenantCapabilityPolicy, readFlowRun, resolveGrantedPersonTarget, claimContactDispatch, executeTask };

export const createServerActionExecutor = (dependencies = serverActionDependencies): ActionExecutor => async (taskType, templateFile, projectData, ctx) => {
  let tenantCommunications: Awaited<ReturnType<typeof readTenantCommunicationsSettings>> | undefined;
  try { tenantCommunications = await dependencies.readTenantCommunicationsSettings(ctx.orgId); } catch { /* use project/env fallback */ }

  const autonomous = Boolean(projectData?.flow_trigger_event_id);
  const capability = TASK_CAPABILITY[taskType];
  let profile: Awaited<ReturnType<typeof readTenantAgentProfile>> = null;
  if (capability || autonomous) {
    try { profile = ctx.orgId ? await dependencies.readTenantAgentProfile(ctx.orgId) : null; } catch { profile = null; }
    if (ctx.orgId) {
      try {
        const capabilityPolicy = await dependencies.readTenantCapabilityPolicy(ctx.orgId);
        profile = profile ? { ...profile, capabilityPolicy } : {
          agentId: 'policy-only',
          displayName: 'Capability Policy',
          timezone: 'Australia/Brisbane',
          capabilityPolicy
        };
      } catch {
        // Fail closed for autonomous effects through the default approval mode.
      }
    }
  }
  if (capability) assertCapabilityAllowed({ profile, capability, autonomous });

  let safeTemplate = templateFile;
  let sourceCommunicationId:string|undefined;
  let replyFrom:string|undefined;
  let policyDecision:Awaited<ReturnType<typeof claimContactDispatch>>|undefined;
  const channel = communicationChannel(taskType);
  const parsed = jsonTemplate(templateFile);
  // Configured people need the same grant lookup for manual and scheduled runs.
  // Direct destinations retain their existing manual behavior.
  const hasPersonTarget = Boolean(parsed?.person_id || parsed?.target_person_id || parsed?.target_source);
  if (channel && (autonomous || hasPersonTarget)) {
    if (!ctx.orgId) throw new Error('Autonomous communication requires tenant correlation');
    if (!parsed) throw new Error('Autonomous communication requires a JSON action template with person_id');
    let personId = String(parsed.person_id || parsed.target_person_id || '').trim();
    if (parsed.target_source === 'event_person') {
      if (!ctx.flowRunId || channel === 'voice') throw new Error('Event sender targeting is available only for replies, not calls');
      const run = await dependencies.readFlowRun(ctx.orgId, ctx.projectId, ctx.flowRunId);
      if (!run || run.trigger !== 'event' || run.triggerId !== run.state.projectData.flow_trigger_event_id) throw new Error('A verified inbound FlowRun is required');
      personId = String(run.state.projectData.flow_trigger_person_id || '');
      sourceCommunicationId=String(run.state.projectData.flow_trigger_communication_id||'')||undefined;
      if(!sourceCommunicationId) throw new Error('The inbound run has no source communication.');
      replyFrom=tenantCommunications?.fromNumber||profile?.serviceIdentities?.sms;
    }
    const target = await dependencies.resolveGrantedPersonTarget({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      personId,
      channel,
      profile
    });
    const claim = await dependencies.claimContactDispatch(ctx.orgId, {
      operationId: ctx.runId,
      target,
      channel,
      coalesce: false, sourceCommunicationId, from:replyFrom,projectId:ctx.projectId
    });
    policyDecision=claim;
    // The durable operation owns an existing budget reservation during recovery.
    if (!claim.allowed && claim.existingOperationId !== ctx.runId) return {
      status:parsed.contact_policy?.onRestriction==='branch'?'success':'error',
      recoveryRequired:parsed.contact_policy?.onRestriction!=='branch',providerCode:'CONTACT_POLICY_HOLD',
      error:claim.reason,output:{provider_called:false,successful:false,provider_status:'not_called',contact_policy:claim},logs:[claim.reason]
    };
    const acknowledgement = claim.reason === 'After-hours acknowledgement only.';
    safeTemplate = JSON.stringify({ ...parsed, to: channel === 'email' ? [target] : target, ...(sourceCommunicationId?{from:replyFrom}:{}), ...(channel==='sms' && (claim.notice || acknowledgement)?{body:[claim.notice, acknowledgement?'Your message has been received for review during business hours.':String(parsed.body||'')].filter(Boolean).join(' ')}: {}) });
  }

  if(channel && channel!=='email' && !policyDecision && ctx.orgId && parsed) {
    const target=typeof parsed.to==='string'?parsed.to:'';
    if(!/^\+[1-9]\d{7,14}$/.test(target)) throw new Error('A verified destination is required for contact policy.');
    const claim=await dependencies.claimContactDispatch(ctx.orgId,{operationId:ctx.runId,target,channel,coalesce:false,projectId:ctx.projectId});
    policyDecision=claim;
    if(!claim.allowed&&claim.existingOperationId!==ctx.runId)return {status:parsed.contact_policy?.onRestriction==='branch'?'success':'error',recoveryRequired:parsed.contact_policy?.onRestriction!=='branch',providerCode:'CONTACT_POLICY_HOLD',error:claim.reason,output:{provider_called:false,successful:false,provider_status:'not_called',contact_policy:claim}};
  }
  const resourceName = resourceNameFromTemplate(safeTemplate);
  const result = await withActionExecutionScope({ resourceName }, () => dependencies.executeTask(taskType, safeTemplate, projectData, {
    webhookBaseUrl: process.env.PUBLIC_BASE_URL,
    communicationsFromNumber: tenantCommunications?.fromNumber,
    communicationsEmailIdentity: tenantCommunications?.defaultEmailIdentity,
    communicationsReplyIdentity: tenantCommunications?.replyServiceIdentity,
    communicationsConnectionId: tenantCommunications?.connectionId,
    correlation: { orgId: ctx.orgId, projectId: ctx.projectId, nodeId: ctx.nodeId, runId: ctx.runId },
    revision: ctx.revision
  }));
  const body = result.body || {};
  if (result.httpStatus >= 400 || (body.status && body.status !== 'success')) {
    return { status: 'error', providerCode: body.code, error: body.error || `Action failed (HTTP ${result.httpStatus})`, logs: body.logs };
  }
  return {
    status: body.pending ? 'pending' : 'success', output: policyDecision?{...body.output,provider_called:true,contact_policy:policyDecision}:body.output, logs: body.logs,
    externalId: body.externalId, externalExecutionId: body.externalExecutionId,
    externalService: body.externalService, startedAt: body.startedAt
  };
};

const executeServerAction = createServerActionExecutor();
const dispatchServerAction = durableActionExecutor(executeServerAction);
export const serverExecutor: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
  if (ctx.flowRunId && projectData.flow_dispatch_version !== 1 &&
      !['read_google_doc', 'read_google_sheet', 'write_report', 'extract_coaching_result'].includes(taskType)) {
    throw new ActionRecoveryRequired('Legacy occurrence requires provider reconciliation before new external effects');
  }
  return dispatchServerAction(taskType, templateFile, projectData, ctx);
};

/** HTTP/manual execution uses the same ledger; callers must retain their run ID on retries. */
export const executeDurableTask = async (
  taskType: string, template: string, data: Record<string, any>, context: Parameters<ActionExecutor>[3]
) => {
  if (!context.orgId || !context.projectId || !context.nodeId || !context.runId) {
    return { httpStatus: 400, body: { error: 'orgId, projectId, nodeId and runId are required for durable action execution' } };
  }
  const normalized = normalizeTaskType(taskType);
  if (!normalized) return { httpStatus: 400, body: { error: 'Unknown task type' } };
  const outcome = await serverExecutor(normalized, template, data || {}, context);
  return { httpStatus: outcome.status === 'error' ? 422 : 200, body: {
    ...outcome, status: outcome.status === 'error' ? 'error' : 'success', pending: outcome.status === 'pending'
  } };
};
