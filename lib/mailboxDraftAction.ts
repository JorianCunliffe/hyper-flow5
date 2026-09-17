import { createCommunicationsClient, type CommunicationsClientWithDraftUpdate } from './communications/client.js';
import { findProject, listMailboxConnectionRefs } from './serverStore.js';
import type { MailboxDraftRequest } from './communications/types.js';

/** Native mailbox drafts only. This adapter has no send operation. */
export const executeMailboxDraft = async (
  operation: 'create_mailbox_draft' | 'update_mailbox_draft',
  input: Record<string, any>,
  correlation: { orgId?: string; projectId?: string; runId?: string },
  dependencies = { findProject, listMailboxConnectionRefs, client: createCommunicationsClient }
) => {
  const { orgId, projectId, runId } = correlation;
  if (!orgId || !projectId || !runId) throw new Error('Mailbox drafts require tenant, project and operation identity');
  const located = await dependencies.findProject(orgId, projectId);
  if (!located) throw new Error('Project does not belong to this tenant');
  const connectionId = String(located.project.projectData?.triage_connection_id || '').trim();
  if (!connectionId || (input.connection_id && input.connection_id !== connectionId)) throw new Error('Select this project’s mailbox before creating or updating drafts');
  const connections = await dependencies.listMailboxConnectionRefs(orgId);
  if (!connections.some(c => c.id === connectionId && c.state === 'connected' && ['gmail', 'outlook'].includes(c.provider))) throw new Error('The selected mailbox is not connected');
  const to = Array.isArray(input.to) ? input.to : [input.to];
  if (!to.length || to.length > 25 || to.some(address => typeof address !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address))) throw new Error('Draft recipients must be email addresses');
  if (typeof input.subject !== 'string' || typeof input.text !== 'string' || !input.text.trim()) throw new Error('Draft subject and text are required');
  const request: MailboxDraftRequest = { to, subject: input.subject, text: input.text };
  for (const key of ['communication_id', 'provider_thread_id', 'in_reply_to', 'references'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error(`Draft ${key} must be text`);
      (request as any)[key] = input[key];
    }
  }
  const client: CommunicationsClientWithDraftUpdate = dependencies.client();
  const draftId = input.provider_draft_id;
  if (operation === 'update_mailbox_draft' && (typeof draftId !== 'string' || !draftId.trim())) throw new Error('Updating requires the original provider_draft_id');
  const result = operation === 'update_mailbox_draft'
    ? await client.updateMailboxDraft(orgId, connectionId, draftId, request, runId)
    : await client.createMailboxDraft(orgId, connectionId, request, runId);
  if (typeof result.provider_draft_id !== 'string' || !result.provider_draft_id || (operation === 'update_mailbox_draft' && result.provider_draft_id !== draftId)) throw new Error('Mailbox did not confirm the original draft identity');
  return { ...result, provider_draft_id: String(result.provider_draft_id), connection_id: connectionId, draft_only: true };
};
