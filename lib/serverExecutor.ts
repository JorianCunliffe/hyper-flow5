import { executeTask } from './executeTask.js';
import type { ActionExecutor } from './flowOrchestrator.js';
import { claimContactDispatch, readTenantAgentProfile, readTenantCommunicationsSettings } from './serverStore.js';
import { assertCapabilityAllowed, TASK_CAPABILITY } from './capabilityPolicy.js';
import { readTenantCapabilityPolicy } from './capabilityPolicyStore.js';
import { resolveGrantedPersonTarget } from './actionTarget.js';

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

/**
 * Server-side action boundary. The graph decides what should happen; this layer
 * enforces tenant authority and, for autonomous communications, turns a stable
 * granted person id into the actual destination immediately before the effect.
 */
export const serverExecutor: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
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
        // If the policy store is unavailable, autonomous effects fail closed via
        // the legacy/default approval mode below rather than bypassing authority.
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
    const personId = String(parsed.person_id || parsed.target_person_id || '').trim();
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
    if (!claim.allowed) throw new Error(claim.reason || 'Tenant contact policy refused the autonomous communication');
    safeTemplate = JSON.stringify({ ...parsed, to: channel === 'email' ? [target] : target });
  }

  const result = await executeTask(taskType, safeTemplate, projectData, {
    webhookBaseUrl: process.env.PUBLIC_BASE_URL,
    communicationsFromNumber: tenantCommunications?.fromNumber,
    communicationsEmailIdentity: tenantCommunications?.defaultEmailIdentity,
    communicationsReplyIdentity: tenantCommunications?.replyServiceIdentity,
    communicationsConnectionId: tenantCommunications?.connectionId,
    correlation: { orgId: ctx.orgId, projectId: ctx.projectId, nodeId: ctx.nodeId, runId: ctx.runId },
    revision: ctx.revision
  });
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
