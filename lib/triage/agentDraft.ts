import { patchTenantTriageItem } from '../serverStore.js';

// Keep the provider identity separate from the service's internal receipt ID.
export async function recordAgentDraft(
  orgId: string, itemId: string, connectionId: string,
  draft: Record<string, unknown>, patch = patchTenantTriageItem
): Promise<string> {
  const providerDraftId = typeof draft.provider_draft_id === 'string' ? draft.provider_draft_id.trim() : '';
  if (!providerDraftId) throw new Error('Communications API did not return a provider draft id');
  const item = await patch(orgId, itemId, { connectionId, providerDraftId }, 'agent-router', 'draft:linked');
  if (!item) throw new Error('Mailbox draft exists but its enquiry linkage could not be saved');
  return typeof draft.id === 'string' && draft.id ? draft.id : providerDraftId;
}
