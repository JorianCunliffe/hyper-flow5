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
}

export const safeDraftWebUrl = (value: unknown, provider: string): string | undefined => {
  if (typeof value !== 'string' || provider !== 'outlook') return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return undefined;
    return ['outlook.office.com', 'outlook.office365.com', 'outlook.cloud.microsoft', 'outlook.live.com'].includes(url.hostname) ? url.href : undefined;
  } catch { return undefined; }
};

// Resolve all provider identifiers from the authenticated tenant's saved item.
// Callers cannot supply an arbitrary connection or draft ID.
export async function readTriageDraftPreview(orgId: string, itemId: unknown, deps = {
  readItem: readTenantTriageItem, requireProject: requireProjectInTenant, client: createCommunicationsClient
}): Promise<DraftPreview> {
  if (typeof itemId !== 'string' || !itemId.trim()) throw new ApiAuthError(400, 'Email item is required');
  const item = await deps.readItem(orgId, itemId);
  if (!item || item.orgId !== orgId) throw new ApiAuthError(404, 'Email item not found');
  if (item.projectId) await deps.requireProject(orgId, item.projectId);
  if (!item.connectionId || !item.providerDraftId) throw new ApiAuthError(404, 'No mailbox draft is recorded for this email');
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
    webUrl: safeDraftWebUrl(preview.web_url, preview.provider), fetchedAt: new Date().toISOString()
  };
}
