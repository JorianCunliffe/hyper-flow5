import { executeTask } from './executeTask.js';
import type { ActionExecutor } from './flowOrchestrator.js';
import { readTenantCommunicationsSettings } from './serverStore.js';

/** Server-side action execution shared by flow advancement and ask responses. */
export const serverExecutor: ActionExecutor = async (taskType, templateFile, projectData, ctx) => {
  let tenantCommunications: Awaited<ReturnType<typeof readTenantCommunicationsSettings>> | undefined;
  try { tenantCommunications = await readTenantCommunicationsSettings(ctx.orgId); } catch { /* use project/env fallback */ }
  const result = await executeTask(taskType, templateFile, projectData, {
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
