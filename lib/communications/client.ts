import { HttpCommunicationsClient as CoreHttpCommunicationsClient } from './clientCore.js';
import type { CommunicationsClientOptions } from './clientCore.js';
import type { CommunicationsClient, MailboxDraftRequest } from './types.js';
import { CommunicationsApiError, CommunicationsConfigurationError } from './errors.js';
import { currentCommunicationRequestRecorder } from '../actionExecutionScope.js';

export type { CommunicationsClientOptions } from './clientCore.js';

export interface MailboxDraftResult {
  id: string;
  provider_draft_id: string;
  provider_message_id?: string | null;
  provider_thread_id?: string | null;
  status: string;
  updated_at?: string;
}

export type CommunicationsClientWithDraftUpdate = CommunicationsClient & {
  updateMailboxDraft(
    tenantId: string,
    connectionId: string,
    draftId: string,
    request: MailboxDraftRequest,
    idempotencyKey: string
  ): Promise<MailboxDraftResult>;
};

export class HttpCommunicationsClient extends CoreHttpCommunicationsClient {
  private readonly draftBaseUrl: string;
  private readonly draftApiKey: string;
  private readonly draftFetch: typeof fetch;
  private readonly draftTimeoutMs: number;
  private readonly draftFreezeRequest?: CommunicationsClientOptions['freezeRequest'];

  constructor(options: CommunicationsClientOptions = {}) {
    super({ ...options, freezeRequest: options.freezeRequest || currentCommunicationRequestRecorder() });
    const baseUrl = options.baseUrl ?? process.env.COMMUNICATIONS_API_URL;
    const apiKey = options.apiKey ?? process.env.COMMUNICATIONS_API_KEY;
    if (!baseUrl) throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL environment variable is required');
    if (!apiKey) throw new CommunicationsConfigurationError('COMMUNICATIONS_API_KEY environment variable is required');
    let parsed: URL;
    try { parsed = new URL(baseUrl); }
    catch { throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL must be an absolute http/https URL'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL must use http or https');
    }
    this.draftBaseUrl = parsed.toString().replace(/\/$/, '');
    this.draftApiKey = apiKey;
    this.draftFetch = options.fetchImpl ?? fetch;
    this.draftFreezeRequest = options.freezeRequest || currentCommunicationRequestRecorder();
    this.draftTimeoutMs = Math.max(250, Math.min(options.timeoutMs || 15_000, 15_000));
  }

  async updateMailboxDraft(
    tenantId: string,
    connectionId: string,
    draftId: string,
    request: MailboxDraftRequest,
    idempotencyKey: string
  ): Promise<MailboxDraftResult> {
    if (!tenantId?.trim()) throw new CommunicationsApiError('Tenant id is required');
    if (!connectionId?.trim()) throw new CommunicationsApiError('Mailbox connection id is required');
    if (!draftId?.trim()) throw new CommunicationsApiError('Mailbox draft id is required');
    if (!idempotencyKey?.trim()) throw new CommunicationsApiError('Idempotency key is required');
    const path = `/v1/mailboxes/${encodeURIComponent(connectionId)}/drafts/${encodeURIComponent(draftId)}`;
    const frozen = this.draftFreezeRequest ? await this.draftFreezeRequest(path, idempotencyKey, request) : request;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.draftTimeoutMs);
    try {
      const response = await this.draftFetch(
        `${this.draftBaseUrl}/v1/mailboxes/${encodeURIComponent(connectionId)}/drafts/${encodeURIComponent(draftId)}`,
        {
          method: 'PATCH',
          headers: {
            'X-API-Key': this.draftApiKey,
            'X-Tenant-Id': tenantId,
            'Idempotency-Key': idempotencyKey,
            Accept: 'application/json',
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(frozen),
          signal: controller.signal
        }
      );
      const text = await response.text();
      let body: any = null;
      try { body = text ? JSON.parse(text) : null; } catch { body = text; }
      if (!response.ok) {
        const detail = body && typeof body === 'object' ? body.error || body.message : body;
        throw new CommunicationsApiError(
          `Communications API returned ${response.status}${detail ? `: ${String(detail)}` : ''}`,
          response.status,
          body
        );
      }
      if (!body || typeof body.provider_draft_id !== 'string' || body.provider_draft_id !== draftId) {
        throw new CommunicationsApiError('Communications API changed or omitted the provider draft identity', 502, body);
      }
      return body as MailboxDraftResult;
    } catch (error: any) {
      if (error instanceof CommunicationsApiError) throw error;
      if (error?.name === 'AbortError') throw new CommunicationsApiError('Communications API request timed out');
      throw new CommunicationsApiError(`Communications API request failed: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const createCommunicationsClient = (options?: CommunicationsClientOptions): CommunicationsClientWithDraftUpdate =>
  new HttpCommunicationsClient(options);
