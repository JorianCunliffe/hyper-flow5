import { CommunicationsApiError, CommunicationsConfigurationError } from './errors.js';
import type {
  CommunicationResult,
  CommunicationsClient,
  DeliverAskRequest,
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
    return this.request('/v1/messages', { method: 'POST', body: request });
  }

  startCall(request: StartCallRequest): Promise<CommunicationResult> {
    return this.request('/v1/calls', { method: 'POST', body: request });
  }

  deliverAsk(request: DeliverAskRequest): Promise<CommunicationResult> {
    return this.request('/v1/asks', { method: 'POST', body: request });
  }

  getCommunication(id: string): Promise<CommunicationResult> {
    if (!id) throw new CommunicationsApiError('Communication id is required');
    return this.request(`/v1/communications/${encodeURIComponent(id)}`, { method: 'GET' });
  }

  private async request(
    path: string,
    options: { method: 'GET' | 'POST'; body?: SendSmsRequest | StartCallRequest | DeliverAskRequest }
  ): Promise<CommunicationResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        method: options.method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
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

      const result = body?.communication ?? body;
      if (!result || typeof result.id !== 'string' || !result.id) {
        throw new CommunicationsApiError('Communications API response did not include a communication id', response.status, body);
      }
      return {
        id: result.id,
        status: result.status || 'accepted',
        channel: result.channel,
        output: result.output,
        error: result.error
      };
    } catch (error: any) {
      if (error instanceof CommunicationsApiError) throw error;
      if (error?.name === 'AbortError') throw new CommunicationsApiError('Communications API request timed out');
      throw new CommunicationsApiError(`Communications API request failed: ${error?.message || String(error)}`);
    } finally {
      clearTimeout(timer);
    }
  }
}

export const createCommunicationsClient = (options?: CommunicationsClientOptions): CommunicationsClient =>
  new HttpCommunicationsClient(options);
