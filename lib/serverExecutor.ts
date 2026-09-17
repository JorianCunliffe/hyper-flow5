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
const executeServerAction: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
  let tenantCommunications: Awaited<ReturnType<typeof readTenantCommunicationsSettings>> | undefined;
  try { tenantCommunications = await readTenantCommunicationsSettings(ctx.orgId); } catch { /* use project/env fallback */ }

  const autonomous = Boolean(projectData?.flow_trigger_event_id);
  const capability = TASK_CAPABILITY[taskType];
  let profile: Awaited<ReturnType<typeof readTenantAgentProfile>> = null;
  if (capability || autonomous) {
    try { profile = ctx.orgId ? await readTenantAgentProfile(ctx.orgId) : null; } catch { profile = null; }
    if (ctx.orgId) {
      try {
        const capabilityPolicy = await readTenantCapabilityPolicy(ctx.orgId);
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
  const channel = communicationChannel(taskType);
  if (autonomous && channel) {
    if (!ctx.orgId) throw new Error('Autonomous communication requires tenant correlation');
    const parsed = jsonTemplate(templateFile);
    if (!parsed) throw new Error('Autonomous communication requires a JSON action template with person_id');
    let personId = String(parsed.person_id || parsed.target_person_id || '').trim();
    if (parsed.target_source === 'event_person') {
      if (!ctx.flowRunId || channel === 'voice') throw new Error('Event sender targeting is available only for replies, not calls');
      const run = await readFlowRun(ctx.orgId, ctx.projectId, ctx.flowRunId);
      if (!run || run.trigger !== 'event' || run.triggerId !== run.state.projectData.flow_trigger_event_id) throw new Error('A verified inbound FlowRun is required');
      personId = String(run.state.projectData.flow_trigger_person_id || '');
    }
    const target = await resolveGrantedPersonTarget({
      orgId: ctx.orgId,
      projectId: ctx.projectId,
      personId,
      channel,
      profile
    });
    const claim = await claimContactDispatch(ctx.orgId, {
      operationId: ctx.runId,
      target,
      channel,
      coalesce: false
    });
    // The durable operation owns an existing budget reservation during recovery.
    if (!claim.allowed && claim.existingOperationId !== ctx.runId) throw new Error(claim.reason || 'Tenant contact policy refused the autonomous communication');
    safeTemplate = JSON.stringify({ ...parsed, to: channel === 'email' ? [target] : target });
  }

  const resourceName = resourceNameFromTemplate(safeTemplate);
  const result = await withActionExecutionScope({ resourceName }, () => executeTask(taskType, safeTemplate, projectData, {
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
    return { status: 'error', error: body.error || `Action failed (HTTP ${result.httpStatus})`, logs: body.logs };
  }
  return {
    status: body.pending ? 'pending' : 'success', output: body.output, logs: body.logs,
    externalId: body.externalId, externalExecutionId: body.externalExecutionId,
    externalService: body.externalService, startedAt: body.startedAt
  };
};

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
