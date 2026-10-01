import { createHash } from 'node:crypto';
import { ApiAuthError, requireProjectInTenant } from '../apiAuth.js';
import { readTenantTriageItem } from '../serverStore.js';
import { createCommunicationsClient } from '../communications/client.js';

export interface DraftPreview {
  provider: 'outlook' | 'gmail';
  subject: string;
  to: string[];
  cc: string[];
  bcc: string[];
  body: string;
  bodyType: 'text' | 'html';
  truncated: boolean;
  webUrl?: string;
  fetchedAt: string;
  /** Present when the service supplies them; used only to approve a legacy draft baseline. */
  contentHash?: string;
  revision?: number;
  /** The draft has no saved provider version, so updates are held until a reviewer approves this content. */
  baselineRequired?: boolean;
}

export const safeDraftWebUrl = (value: unknown, provider: string): string | undefined => {
  if (typeof value !== 'string' || provider !== 'outlook') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    return ['outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft', 'outlook.live.com'].includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
};

type DraftDeps = { readItem: typeof readTenantTriageItem; requireProject: typeof requireProjectInTenant; client: typeof createCommunicationsClient };
const defaultDeps: DraftDeps = { readItem: readTenantTriageItem, requireProject: requireProjectInTenant, client: createCommunicationsClient };

// Resolve all provider identifiers from the authenticated tenant's saved item.
// Callers cannot supply an arbitrary connection or draft ID.
const readLinkedItem = async (orgId: string, itemId: unknown, deps: DraftDeps) => {
  if (typeof itemId !== 'string' || !itemId.trim()) throw new ApiAuthError(400, 'Email item is required');
  const item = await deps.readItem(orgId, itemId);
  if (!item || item.orgId !== orgId) throw new ApiAuthError(404, 'Email item not found');
  if (item.projectId) await deps.requireProject(orgId, item.projectId);
  if (!item.connectionId || !item.providerDraftId) throw new ApiAuthError(404, 'No mailbox draft is recorded for this email');
  return item as typeof item & { connectionId: string; providerDraftId: string };
};

export async function readTriageDraftPreview(orgId: string, itemId: unknown, deps: DraftDeps = defaultDeps): Promise<DraftPreview> {
  const item = await readLinkedItem(orgId, itemId, deps);
  let draft: Record<string, any>;
  try {
    draft = await deps.client().getMailboxDraft(orgId, item.connectionId, item.providerDraftId);
  } catch (error: any) {
    const status = Number(error?.status);
    if ([404, 409].includes(status)) throw new ApiAuthError(404, 'This draft is no longer available. It may have been sent, moved or deleted in the mailbox.');
    throw new ApiAuthError(502, 'The mailbox draft could not be loaded. Try refreshing or check the mailbox connection.');
  }
  if (draft.provider_draft_id !== item.providerDraftId || draft.provider?.is_draft !== true) throw new ApiAuthError(409, 'The mailbox did not confirm this draft');
  const preview = draft.preview;
  if (!preview || !['outlook', 'gmail'].includes(preview.provider) || typeof preview.body !== 'string') throw new ApiAuthError(502, 'Draft preview is unavailable from the mailbox service. Please try again shortly.');
  const addresses = (value: unknown): string[] => Array.isArray(value) ? value.filter(v => typeof v === 'string').slice(0, 100) : [];
  return {
    provider: preview.provider, subject: String(preview.subject || ''),
    to: addresses(preview.to), cc: addresses(preview.cc), bcc: addresses(preview.bcc),
    body: preview.body.slice(0, 200_000), bodyType: preview.body_type === 'html' ? 'html' : 'text',
    truncated: preview.truncated === true || preview.body.length > 200_000,
    webUrl: safeDraftWebUrl(preview.web_url, preview.provider), fetchedAt: new Date().toISOString(),
    ...(typeof preview.content_hash === 'string' && /^[a-f0-9]{64}$/.test(preview.content_hash) ? { contentHash: preview.content_hash } : {}),
    ...(Number.isInteger(draft.revision) && draft.revision >= 1 ? { revision: draft.revision } : {}),
    baselineRequired: preview.provider === 'outlook' ? !draft.provider_change_key : !draft.provider_message_id
  };
}

const BASELINE_ERRORS: Record<string, string> = {
  DRAFT_PROVIDER_CHANGED: 'The draft changed in the mailbox after you reviewed it. Refresh and review the current draft.',
  STALE_REVISION: 'The draft was updated after you reviewed it. Refresh and review the current draft.',
  DRAFT_UPDATE_CONFLICT: 'The draft changed while it was being approved. Refresh and review it again.',
  DRAFT_UPDATE_IN_PROGRESS: 'An update to this draft is in progress. Try again when it finishes.',
  BASELINE_NOT_REQUIRED: 'This draft already has a saved version; no approval is needed.',
};

/** Explicitly review one rejected update; provider identities come only from the tenant item. */
export async function recoverReviewedTriageDraft(orgId: string, itemId: unknown,
  review: { contentHash?: unknown; revision?: unknown; failedReceiptId?: unknown }, actor: string, deps: DraftDeps = defaultDeps) {
  if (typeof review.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(review.contentHash)
    || !Number.isInteger(review.revision) || (review.revision as number) < 1) {
    throw new ApiAuthError(400, 'Refresh and review the current draft before recovering an update');
  }
  if (typeof review.failedReceiptId !== 'string' || !/^[a-f0-9-]{36}$/i.test(review.failedReceiptId)) {
    throw new ApiAuthError(400, 'The rejected update receipt ID is required');
  }
  const item = await readLinkedItem(orgId, itemId, deps);
  const client = deps.client();
  if (!client.recoverMailboxDraftUpdate) throw new ApiAuthError(501, 'The mailbox service does not support reviewed recovery');
  const key = `reviewed-draft-recovery:${createHash('sha256').update(JSON.stringify([
    orgId, item.connectionId, item.providerDraftId, review.failedReceiptId, review.contentHash, review.revision
  ])).digest('hex')}`;
  try {
    const result = await client.recoverMailboxDraftUpdate(orgId, item.connectionId, item.providerDraftId, {
      failed_update_receipt_id: review.failedReceiptId, reviewed_content_hash: review.contentHash,
      expected_revision: review.revision as number, initiator_id: actor
    }, key);
    if (result.provider_draft_id !== item.providerDraftId || result.status !== 'created'
      || result.recovered_from_receipt_id !== review.failedReceiptId
      || result.reviewed_content_hash !== review.contentHash
      || result.revision !== (review.revision as number) + 1
      || typeof result.update_receipt_id !== 'string' || !result.update_receipt_id) {
      throw new ApiAuthError(502, 'The mailbox service did not verify this draft recovery; preserve the review and retry');
    }
    return { recovered: true, revision: result.revision, receiptId: result.update_receipt_id };
  } catch (error: any) {
    if (error instanceof ApiAuthError) throw error;
    const code = String(error?.responseBody?.code || '');
    if (['DRAFT_PROVIDER_CHANGED', 'STALE_REVISION', 'DRAFT_UPDATE_CONFLICT'].includes(code)) {
      throw new ApiAuthError(409, 'The draft changed after review. Refresh and review it again.');
    }
    if (Number(error?.status) === 404) throw new ApiAuthError(404, 'The rejected update was not found for this draft');
    if (Number(error?.status) === 409) throw new ApiAuthError(409, 'Recovery is held by the mailbox service. Keep this review and check the update receipt before retrying.');
    throw new ApiAuthError(502, 'Recovery could not be confirmed. Keep this review and retry the same recovery; do not create another draft.');
  }
}

/**
 * Approve the exact previewed content of a legacy draft as its starting version.
 * Only the item's own linked draft is addressed, and the mailbox is never written.
 */
export async function adoptTriageDraftBaseline(orgId: string, itemId: unknown, review: { contentHash?: unknown; revision?: unknown }, actor: string, deps: DraftDeps = defaultDeps) {
  if (typeof review.contentHash !== 'string' || !/^[a-f0-9]{64}$/.test(review.contentHash)) throw new ApiAuthError(400, 'Review the current draft before approving it');
  if (!Number.isInteger(review.revision) || (review.revision as number) < 1) throw new ApiAuthError(400, 'Review the current draft before approving it');
  const item = await readLinkedItem(orgId, itemId, deps);
  const client = deps.client();
  if (!client.adoptMailboxDraftBaseline) throw new ApiAuthError(501, 'The mailbox service cannot approve draft versions');
  try {
    const result = await client.adoptMailboxDraftBaseline(orgId, item.connectionId, item.providerDraftId, {
      reviewed_content_hash: review.contentHash, expected_revision: review.revision as number, initiator_id: actor
    });
    if (result?.provider_draft_id !== item.providerDraftId || result?.baseline_adopted !== true) throw new ApiAuthError(502, 'The mailbox service did not confirm the approved draft');
    return { adopted: true, revision: result.revision };
  } catch (error: any) {
    if (error instanceof ApiAuthError) throw error;
    const code = String(error?.responseBody?.code || '');
    if (BASELINE_ERRORS[code]) throw new ApiAuthError(409, BASELINE_ERRORS[code]);
    if (Number(error?.status) === 404) throw new ApiAuthError(404, 'This draft is no longer available in the mailbox.');
    throw new ApiAuthError(502, 'The draft approval could not be confirmed. Refresh the draft before trying again.');
  }
}
