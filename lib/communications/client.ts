import { CommunicationsApiError, CommunicationsConfigurationError } from './errors.js';
import type {
  CommunicationResult,
  CommunicationListOptions,
  CommunicationListResult,
  CommunicationsTriageItem,
  CommunicationsClient,
  CommunicationThreadResult,
  ResolveAskResult,
  SendEmailRequest,
  SendSmsRequest,
  StartCallRequest
} from './types.js';

const REQUEST_TIMEOUT_MS = 15_000;

export interface CommunicationsClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}

export class HttpCommunicationsClient implements CommunicationsClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: CommunicationsClientOptions = {}) {
    const baseUrl = options.baseUrl ?? process.env.COMMUNICATIONS_API_URL;
    const apiKey = options.apiKey ?? process.env.COMMUNICATIONS_API_KEY;
    if (!baseUrl) throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL environment variable is required');
    if (!apiKey) throw new CommunicationsConfigurationError('COMMUNICATIONS_API_KEY environment variable is required');

    let parsed: URL;
    try {
      parsed = new URL(baseUrl);
    } catch {
      throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL must be an absolute http/https URL');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new CommunicationsConfigurationError('COMMUNICATIONS_API_URL must use http or https');
    }

    this.baseUrl = parsed.toString().replace(/\/$/, '');
    this.apiKey = apiKey;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  sendSms(request: SendSmsRequest): Promise<CommunicationResult> {
    return this.communicationRequest('/v1/messages', { method: 'POST', body: request, idempotencyKey: this.operationKey('sms', request) });
  }

  startCall(request: StartCallRequest): Promise<CommunicationResult> {
    return this.communicationRequest('/v1/calls', { method: 'POST', body: request, idempotencyKey: this.operationKey('voice', request) });
  }

  sendEmail(request: SendEmailRequest): Promise<CommunicationResult> {
    return this.communicationRequest('/v1/emails', {
      method: 'POST', body: request, idempotencyKey: this.operationKey('email', request)
    });
  }

  async listCommunications(tenantId: string, options: CommunicationListOptions = {}): Promise<CommunicationListResult> {
    this.requireTenant(tenantId);
    const query = new URLSearchParams();
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.channel) query.set('channel', options.channel);
    if (options.threadId) query.set('thread_id', options.threadId);
    if (options.askId) query.set('ask_id', options.askId);
    if (options.personId) query.set('person_id', options.personId);
    if (options.memoryEligible !== undefined) query.set('memory_eligible', String(options.memoryEligible));
    const body = await this.rawRequest(`/v1/communications${query.size ? `?${query}` : ''}`, {
      method: 'GET', tenantId
    });
    let data = Array.isArray(body?.data) ? body.data.map((item: any) => this.normalizeCommunication(item)) : [];
    // The current Communications endpoint has not yet promoted direction to a
    // query parameter, so filter it here without widening tenant scope.
    if (options.direction) data = data.filter((item: CommunicationResult) => item.direction === options.direction);
    return {
      data,
      count: typeof body?.count === 'number' ? body.count : data.length,
      limit: typeof body?.limit === 'number' ? body.limit : (options.limit || 50),
      nextCursor: typeof body?.next_cursor === 'string' ? body.next_cursor : undefined
    };
  }

  async getCommunication(tenantId: string, id: string): Promise<CommunicationResult> {
    this.requireTenant(tenantId);
    if (!id) throw new CommunicationsApiError('Communication id is required');
    const communication = await this.communicationRequest(`/v1/communications/${encodeURIComponent(id)}`, { method: 'GET', tenantId });
    if (communication.channel !== 'email') return communication;
    // The email detail route adds safe sender/recipient/subject metadata that
    // the canonical list projection intentionally omits.
    return this.communicationRequest(`/v1/emails/${encodeURIComponent(id)}`, { method: 'GET', tenantId });
  }

  async getThread(tenantId: string, threadId: string): Promise<CommunicationThreadResult> {
    this.requireTenant(tenantId);
    if (!threadId) throw new CommunicationsApiError('Thread id is required');
    const body = await this.rawRequest(`/v1/threads/${encodeURIComponent(threadId)}`, { method: 'GET', tenantId });
    return {
      ...body,
      threadId: String(body?.thread_id || threadId),
      communications: Array.isArray(body?.communications)
        ? body.communications.map((item: any) => this.normalizeCommunication(item))
        : []
    };
  }

  async listTriageItems(tenantId: string, options: CommunicationListOptions = {}): Promise<CommunicationsTriageItem[]> {
    this.requireTenant(tenantId);
    const query = new URLSearchParams();
    if (options.cursor) query.set('cursor', options.cursor);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.channel) query.set('channel', options.channel);
    const body = await this.rawRequest(`/v1/inbox${query.size ? `?${query}` : ''}`, { method: 'GET', tenantId });
    return Array.isArray(body?.data) ? body.data.map((raw: any) => {
      const communication = this.normalizeCommunication(raw);
      return {
        id: communication.id,
        communicationId: communication.id,
        threadId: communication.threadId,
        disposition: String(communication.outcome?.disposition || 'unassigned'),
        communication
      };
    }) : [];
  }

  async setTriageDisposition(
    tenantId: string,
    itemId: string,
    disposition: string
  ): Promise<CommunicationsTriageItem> {
    this.requireTenant(tenantId);
    if (!itemId) throw new CommunicationsApiError('Triage item id is required');
    if (!disposition) throw new CommunicationsApiError('Triage disposition is required');
    const communication = this.normalizeCommunication(await this.rawRequest(
      `/v1/communications/${encodeURIComponent(itemId)}/disposition`,
      { method: 'POST', tenantId, body: { disposition } }
    ));
    return {
      id: communication.id,
      communicationId: communication.id,
      threadId: communication.threadId,
      disposition: String(communication.outcome?.disposition || disposition),
      communication
    };
  }

  async resolveAsk(tenantId: string, askId: string, communicationId: string): Promise<ResolveAskResult> {
    this.requireTenant(tenantId);
    if (!askId) throw new CommunicationsApiError('Ask id is required');
    if (!communicationId) throw new CommunicationsApiError('Communication id is required');
    const body = await this.rawRequest(`/v1/asks/${encodeURIComponent(askId)}/resolve`, {
      method: 'POST', tenantId, body: { communication_id: communicationId }
    });
    return {
      ask_id: typeof body?.ask_id === 'string' ? body.ask_id : askId,
      status: 'resolved',
      communication_id: typeof body?.communication_id === 'string' ? body.communication_id : communicationId
    };
  }

  private async communicationRequest(
    path: string,
    options: {
      method: 'GET' | 'POST';
      body?: SendSmsRequest | StartCallRequest | SendEmailRequest;
      idempotencyKey?: string;
      tenantId?: string;
    }
  ): Promise<CommunicationResult> {
    const tenantId = options.tenantId || options.body?.correlation?.tenant_id;
    const body = await this.rawRequest(path, { ...options, tenantId });
    const result = body?.communication ?? body;
    const id = result?.communication_id ?? result?.id;
    if (typeof id !== 'string' || !id) {
      throw new CommunicationsApiError('Communications API response did not include a communication_id', undefined, body);
    }
    return this.normalizeCommunication({
      ...result,
      id,
      status: result.status || 'accepted'
    });
  }

  private async rawRequest(
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string; tenantId?: string }
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          'X-API-Key': this.apiKey,
          ...(options.tenantId ? { 'X-Tenant-Id': options.tenantId } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
          Accept: 'application/json',
          ...(options.body ? { 'Content-Type': 'application/json' } : {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });
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
      return body;
    } catch (error: any) {
      if (error instanceof CommunicationsApiError) throw error;
      if (error?.name === 'AbortError') throw new CommunicationsApiError('Communications API request timed out');
      throw new CommunicationsApiError(`Communications API request failed: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }

  private operationKey(channel: 'email' | 'sms' | 'voice', request: SendSmsRequest | StartCallRequest | SendEmailRequest): string {
    const correlation = request.correlation;
    const purpose = request.purpose?.ask_id || 'action';
    return `hyperflow:${correlation.tenant_id}:${correlation.external_project_id || correlation.project_id}:${correlation.run_id}:${correlation.task_id}:${channel}:${purpose}`;
  }

  private requireTenant(tenantId: string): void {
    if (!tenantId || !tenantId.trim()) throw new CommunicationsApiError('Tenant id is required');
  }

  private normalizeCommunication(result: any): CommunicationResult {
    const id = result?.communication_id ?? result?.id;
    return {
      id,
      status: result?.status || result?.outcome?.business_status || 'accepted',
      channel: result?.channel,
      tenantId: result?.tenant_id,
      threadId: result?.thread_id,
      direction: result?.direction,
      occurredAt: result?.occurred_at,
      personId: result?.person_id,
      content: result?.content,
      summary: result?.summary,
      subject: result?.email?.subject || result?.subject,
      sender: Array.isArray(result?.email?.from_addresses)
        ? result.email.from_addresses.map(String).join(', ')
        : result?.sender,
      recipients: Array.isArray(result?.email?.to_addresses)
        ? result.email.to_addresses.map(String)
        : result?.recipients,
      correlation: result?.correlation,
      purpose: result?.purpose,
      outcome: result?.outcome,
      output: result?.output,
      error: result?.error
    };
  }
}

export const createCommunicationsClient = (options?: CommunicationsClientOptions): CommunicationsClient =>
  new HttpCommunicationsClient(options);
