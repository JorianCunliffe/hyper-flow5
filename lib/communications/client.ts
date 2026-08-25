import { CommunicationsApiError, CommunicationsConfigurationError } from './errors.js';
import type {
  CommunicationResult,
  CommunicationsClient,
  ResolveAskResult,
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

  getCommunication(id: string): Promise<CommunicationResult> {
    if (!id) throw new CommunicationsApiError('Communication id is required');
    return this.communicationRequest(`/v1/communications/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  async resolveAsk(askId: string, communicationId: string): Promise<ResolveAskResult> {
    if (!askId) throw new CommunicationsApiError('Ask id is required');
    if (!communicationId) throw new CommunicationsApiError('Communication id is required');
    try {
      const body = await this.rawRequest(`/v1/asks/${encodeURIComponent(askId)}/resolve`, {
        method: 'POST', body: { communication_id: communicationId }
      });
      return {
        ask_id: typeof body?.ask_id === 'string' ? body.ask_id : askId,
        status: 'resolved',
        communication_id: typeof body?.communication_id === 'string' ? body.communication_id : communicationId
      };
    } catch (error: any) {
      // Communications currently returns 409 without the existing resolution
      // identity. HyperFlow calls this only after confirming its canonical
      // response already points at this communication, making replay safe.
      if (error instanceof CommunicationsApiError && error.status === 409) {
        return { ask_id: askId, status: 'already_resolved', communication_id: communicationId };
      }
      throw error;
    }
  }

  private async communicationRequest(
    path: string,
    options: { method: 'GET' | 'POST'; body?: SendSmsRequest | StartCallRequest; idempotencyKey?: string }
  ): Promise<CommunicationResult> {
    const body = await this.rawRequest(path, options);
    const result = body?.communication ?? body;
    const id = result?.communication_id ?? result?.id;
    if (typeof id !== 'string' || !id) {
      throw new CommunicationsApiError('Communications API response did not include a communication_id', undefined, body);
    }
    return {
      id,
      status: result.status || 'accepted',
      channel: result.channel,
      output: result.output,
      error: result.error
    };
  }

  private async rawRequest(
    path: string,
    options: { method: 'GET' | 'POST'; body?: unknown; idempotencyKey?: string }
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          'X-API-Key': this.apiKey,
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

  private operationKey(channel: 'sms' | 'voice', request: SendSmsRequest | StartCallRequest): string {
    const correlation = request.correlation;
    const purpose = request.purpose?.ask_id || 'action';
    return `hyperflow:${correlation.tenant_id}:${correlation.external_project_id || correlation.project_id}:${correlation.run_id}:${correlation.task_id}:${channel}:${purpose}`;
  }
}

export const createCommunicationsClient = (options?: CommunicationsClientOptions): CommunicationsClient =>
  new HttpCommunicationsClient(options);
