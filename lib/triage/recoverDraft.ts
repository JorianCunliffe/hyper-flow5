import { ApiAuthError, requireProjectInTenant } from '../apiAuth.js';
import { readTenantTriageItem, readAgentInboxJob, recoverTriageDraftLink } from '../serverStore.js';
import { createCommunicationsClient } from '../communications/client.js';

export async function recoverTriageDraft(orgId: string, itemId: unknown, actor: string, deps = {
  readItem: readTenantTriageItem, readJob: readAgentInboxJob, requireProject: requireProjectInTenant,
  client: createCommunicationsClient, save: recoverTriageDraftLink
}) {
  if (typeof itemId !== 'string' || !itemId.trim()) throw new ApiAuthError(400, 'Email item is required');
  const item = await deps.readItem(orgId, itemId);
  if (!item || item.orgId !== orgId || item.channel !== 'email') throw new ApiAuthError(404, 'Email item not found');
  if (item.projectId) await deps.requireProject(orgId, item.projectId);
  if (item.connectionId && item.providerDraftId) return item;
  const job = await deps.readJob(orgId, item.communicationId);
  if (!job || job.orgId !== orgId || job.communicationId !== item.communicationId || !job.responseDraftId) {
    throw new ApiAuthError(409, 'No saved agent draft receipt is available for recovery');
  }
  const client = deps.client();
  const draft = await client.getMailboxDraftByReceipt(orgId, job.responseDraftId);
  const source = await client.getCommunication(orgId, item.communicationId);
  if (draft.id !== job.responseDraftId || draft.tenant_id !== orgId || draft.communication_id !== item.communicationId
    || draft.status !== 'created' || typeof draft.provider_draft_id !== 'string' || !draft.provider_draft_id
    || typeof draft.provider_connection_id !== 'string' || !draft.provider_connection_id
    || source.id !== item.communicationId || source.connectionId !== draft.provider_connection_id
    || (draft.provider as any)?.is_draft !== true || (draft.provider as any)?.id !== draft.provider_draft_id) {
    throw new ApiAuthError(409, 'The receipt, receiving mailbox and live draft do not agree; review is required');
  }
  const saved = await deps.save(orgId, itemId, item.communicationId, draft.provider_connection_id, draft.provider_draft_id, actor);
  if (!saved) throw new ApiAuthError(409, 'Email linkage changed or disappeared during recovery; refresh and review');
  return saved;
}
