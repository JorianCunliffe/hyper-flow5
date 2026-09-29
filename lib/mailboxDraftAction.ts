import { createCommunicationsClient, type CommunicationsClientWithDraftUpdate } from './communications/client.js';
import { CommunicationsApiError } from './communications/errors.js';
import { findProject, listMailboxConnectionRefs, readTenantTriageItem, readAgentInboxJob, recoverTriageDraftLink } from './serverStore.js';
import type { MailboxDraftRequest } from './communications/types.js';

/** Provider version holds that only a reviewed reconciliation can release. */
const DRAFT_HOLD_CODES: Record<string, string> = {
  DRAFT_VERSION_UNAVAILABLE: 'The existing draft has no saved provider version. Review its current mailbox content and reconcile its baseline before HyperFlow updates it.',
  DRAFT_PROVIDER_CHANGED: 'The existing draft was changed in the mailbox after HyperFlow last saved it. Review the mailbox version before updating it.',
  DRAFT_RECONCILIATION_REQUIRED: 'The outcome of an earlier draft update is uncertain. Reconcile it before updating this draft.',
  STALE_REVISION: 'The draft revision changed. Reload the draft before updating it.',
  DRAFT_UPDATE_IN_PROGRESS: 'Another update to this draft is in progress. Retry after it completes.',
};

const explainDraftError = (error: unknown): never => {
  const code = error instanceof CommunicationsApiError && error.responseBody && typeof error.responseBody === 'object'
    ? String((error.responseBody as any).code || '') : '';
  if (code && DRAFT_HOLD_CODES[code]) throw new Error(`${(error as Error).message} (${code}). ${DRAFT_HOLD_CODES[code]}`);
  throw error;
};

type Dependencies = {
  findProject: typeof findProject;
  listMailboxConnectionRefs: typeof listMailboxConnectionRefs;
  client: () => CommunicationsClientWithDraftUpdate;
  readTriageItem?: typeof readTenantTriageItem;
  readAgentJob?: typeof readAgentInboxJob;
  linkDraft?: typeof recoverTriageDraftLink;
};

/** Native mailbox drafts only. This adapter has no send operation. */
export const executeMailboxDraft = async (
  operation: 'create_mailbox_draft' | 'update_mailbox_draft',
  input: Record<string, any>,
  correlation: { orgId?: string; projectId?: string; runId?: string },
  dependencies: Dependencies = { findProject, listMailboxConnectionRefs, client: createCommunicationsClient }
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
  if (operation === 'update_mailbox_draft' && input.revision !== undefined) {
    if (!Number.isInteger(input.revision) || input.revision < 1) throw new Error('Draft revision must be a positive integer');
    request.revision = input.revision;
  }
  for (const key of ['communication_id', 'provider_thread_id', 'in_reply_to', 'references'] as const) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string') throw new Error(`Draft ${key} must be text`);
      (request as any)[key] = input[key];
    }
  }
  const client: CommunicationsClientWithDraftUpdate = dependencies.client();

  if (operation === 'create_mailbox_draft') {
    const communicationId = typeof request.communication_id === 'string' ? request.communication_id.trim() : '';
    // A reply without its source communication cannot prove that no earlier draft
    // exists for that email, so creating one could duplicate a reviewed draft.
    if (request.in_reply_to !== undefined && !communicationId) {
      throw new Error('Reply drafts must include the source communication_id so an existing draft can be reused instead of duplicated');
    }
    if (communicationId) {
      const readItem = dependencies.readTriageItem || readTenantTriageItem;
      const item = await readItem(orgId, communicationId);
      if (item && (item.orgId !== orgId || item.communicationId !== communicationId)) throw new Error('Source email does not belong to this tenant');
      if (item?.providerDraftId) {
        if (item.connectionId && item.connectionId !== connectionId) {
          throw new Error('The existing draft for this email is in a different mailbox; review it before continuing');
        }
        const result = await client.updateMailboxDraft(orgId, connectionId, item.providerDraftId, request, runId).catch(explainDraftError);
        if (typeof result.provider_draft_id !== 'string' || result.provider_draft_id !== item.providerDraftId) throw new Error('Mailbox did not confirm the original draft identity');
        return { ...result, provider_draft_id: item.providerDraftId, connection_id: connectionId, draft_only: true, reused_existing_draft: true };
      }
      if (item) {
        const job = await (dependencies.readAgentJob || readAgentInboxJob)(orgId, communicationId);
        if (job?.responseDraftId) {
          throw new Error('An earlier draft receipt exists for this email but is not linked. Recover and review that draft before continuing');
        }
      }
      const created = await client.createMailboxDraft(orgId, connectionId, request, runId);
      if (typeof created.provider_draft_id !== 'string' || !created.provider_draft_id) throw new Error('Mailbox did not confirm the draft identity');
      if (item) {
        // Link the new draft to its email so a later run updates it instead of creating another.
        const linked = await (dependencies.linkDraft || recoverTriageDraftLink)(orgId, item.id, communicationId, connectionId, created.provider_draft_id, `operation:${runId}`);
        if (!linked) throw new Error('The email gained a different draft while this one was created; review both drafts before continuing');
      }
      return { ...created, provider_draft_id: String(created.provider_draft_id), connection_id: connectionId, draft_only: true };
    }
  }

  const draftId = input.provider_draft_id;
  if (operation === 'update_mailbox_draft' && (typeof draftId !== 'string' || !draftId.trim())) throw new Error('Updating requires the original provider_draft_id');
  const result = operation === 'update_mailbox_draft'
    ? await client.updateMailboxDraft(orgId, connectionId, draftId, request, runId).catch(explainDraftError)
    : await client.createMailboxDraft(orgId, connectionId, request, runId);
  if (typeof result.provider_draft_id !== 'string' || !result.provider_draft_id || (operation === 'update_mailbox_draft' && result.provider_draft_id !== draftId)) throw new Error('Mailbox did not confirm the original draft identity');
  return { ...result, provider_draft_id: String(result.provider_draft_id), connection_id: connectionId, draft_only: true };
};
