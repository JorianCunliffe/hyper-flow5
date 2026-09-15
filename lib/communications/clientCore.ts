import type { MemoryRequest, MemoryEnvelope } from './memoryTypes.js';
import type { MeetingInput, MeetingRecord } from './meetingTypes.js';
import { CommunicationsApiError, CommunicationsConfigurationError } from './errors.js';
import { assertEmailSendAllowed } from './emailPolicy.js';
import type {
  CommunicationResult,
  CommunicationListOptions,
  CommunicationListResult,
  CommunicationsTriageItem,
  CommunicationsClient,
  CommunicationsMailboxRef,
  CommunicationsPersonRef,
  CommunicationThreadResult,
  ThreadRegisterOptions,
  ThreadRegisterEntry,
  ThreadCandidate,
  ThreadCorrectionRequest,
  ThreadCorrectionResult,
  ThreadRegisterPatch,
  ResolveAskResult,
  MailboxDraftRequest,
  SendEmailRequest,
  SendSmsRequest,
  StartCallRequest
} from './types.js';

const REQUEST_TIMEOUT_MS = 15_000;

export interface CommunicationsClientOptions {
  baseUrl?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class HttpCommunicationsClient implements CommunicationsClient {
  async changeTenantLifecycle(tenantId:string,body:Record<string,unknown>):Promise<any>{this.requireTenant(tenantId);return this.rawRequest('/v1/tenant/lifecycle',{method:'POST',tenantId,body});}
  async readTenantLifecycle(tenantId:string):Promise<any>{this.requireTenant(tenantId);return this.rawRequest('/v1/tenant/lifecycle',{method:'GET',tenantId});}
  async ingestCalendarObservation(tenantId:string,event:Record<string,unknown>):Promise<any>{
    this.requireTenant(tenantId);return this.rawRequest('/v1/calendar/events',{method:'POST',tenantId,body:event});
  }
  private readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

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
    this.timeoutMs = Math.max(250, Math.min(options.timeoutMs || REQUEST_TIMEOUT_MS, REQUEST_TIMEOUT_MS));
  }

  async listMeetings(tenantId:string, offset=0): Promise<{data:MeetingRecord[];next:number|null}> {
    this.requireTenant(tenantId); return this.rawRequest(`/v1/meetings?offset=${offset}`,{method:'GET',tenantId});
  }
  async getMeeting(tenantId:string,id:string):Promise<MeetingRecord> {
    this.requireTenant(tenantId); return this.rawRequest(`/v1/meetings/${encodeURIComponent(id)}`,{method:'GET',tenantId});
  }
  async findMeeting(tenantId:string,source:string,externalId:string):Promise<MeetingRecord|null> {
    this.requireTenant(tenantId);
    try{return await this.rawRequest(`/v1/meetings/by-source?${new URLSearchParams({source,externalId})}`,{method:'GET',tenantId});}
    catch(error){if(error instanceof CommunicationsApiError && error.status===404)return null;throw error;}
  }
  async importMeeting(tenantId:string,input:MeetingInput):Promise<{id:string;version:number;duplicate:boolean}> {
    this.requireTenant(tenantId);return this.rawRequest('/v1/meetings',{method:'POST',tenantId,body:input});
  }

  async getMemoryContext(tenantId: string, input: MemoryRequest): Promise<MemoryEnvelope> {
    this.requireTenant(tenantId);
    const result = await this.rawRequest('/v1/context/memory', { method: 'POST', tenantId, body: input });
    if (result?.contract_version !== 'memory-context.v1' || !result.data || typeof result.data !== 'object'
      || !['current', 'stale'].includes(result.memory_status?.state) || !Number.isFinite(Date.parse(result.memory_status?.retrieved_at))) {
      throw new CommunicationsApiError('Memory context is unavailable; Communications needs a compatible version', 503);
    }
    return result;
  }

  sendSms(request: SendSmsRequest): Promise<CommunicationResult> {
    return this.communicationRequest('/v1/messages', { method: 'POST', body: request, idempotencyKey: this.operationKey('sms', request) });
  }

  startCall(request: StartCallRequest): Promise<CommunicationResult> {
    return this.communicationRequest('/v1/calls', { method: 'POST', body: request, idempotencyKey: this.operationKey('voice', request) });
  }

  async sendEmail(request: SendEmailRequest): Promise<CommunicationResult> {
    const policy = await this.getEmailPolicy(request.correlation?.tenant_id);
    assertEmailSendAllowed(request.correlation?.tenant_id, policy.mode);
    return this.communicationRequest('/v1/emails', {
      method: 'POST', body: request, idempotencyKey: this.operationKey('email', request)
    });
  }

  async getEmailPolicy(tenantId: string): Promise<{ mode: string; configuredMode: string | null; version: string }> {
    this.requireTenant(tenantId);
    const result = await this.rawRequest('/v1/tenant-policy/email', { method: 'GET', tenantId });
    if (!result || !['draft_only', 'allow_send'].includes(result.mode) || typeof result.version !== 'string') {
      throw new CommunicationsApiError('Email policy is unavailable or invalid', 503);
    }
    return result;
  }

  saveEmailPolicy(tenantId: string, mode: string, version: string): Promise<{ mode: string; version: string }> {
    this.requireTenant(tenantId);
    return this.rawRequest('/v1/tenant-policy/email', { method: 'POST', tenantId, body: { mode, version } });
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
    if (options.connectionId) query.set('provider_connection_id', options.connectionId);
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

  async listThreadRegister(tenantId: string, options: ThreadRegisterOptions = {}): Promise<{ data: ThreadRegisterEntry[]; count: number; has_more?: boolean }> {
    this.requireTenant(tenantId);
    const query = new URLSearchParams();
    if (options.status) query.set('status', options.status);
    if (options.personId) query.set('person_id', options.personId);
    if (options.externalProjectId) query.set('external_project_id', options.externalProjectId);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset !== undefined) query.set('offset', String(options.offset));
    if (options.threadId) query.set('thread_id', options.threadId);
    if (options.communicationOffset !== undefined) query.set('communication_offset', String(options.communicationOffset));
    const body = await this.rawRequest(`/v1/thread-register${query.size ? `?${query}` : ''}`, { method: 'GET', tenantId });
    const data = Array.isArray(body?.data) ? body.data.map((item: ThreadRegisterEntry) => ({
      ...item,
      participants: Array.isArray(item.participants) ? item.participants : [],
      communications: Array.isArray(item.communications) ? item.communications : [],
      decisions: Array.isArray(item.decisions) ? item.decisions : [],
      corrections: Array.isArray(item.corrections) ? item.corrections : []
    })) : [];
    return { data, count: typeof body?.count === 'number' ? body.count : data.length, has_more: body?.has_more === true };
  }

  async getThreadCandidates(tenantId: string, communicationId: string): Promise<{ communication_id: string; current_thread_id: string | null; candidates: ThreadCandidate[] }> {
    this.requireTenant(tenantId);
    if (!communicationId) throw new CommunicationsApiError('Communication id is required');
    const body = await this.rawRequest(`/v1/communications/${encodeURIComponent(communicationId)}/thread-candidates`, { method: 'GET', tenantId });
    return {
      communication_id: body?.communication_id || communicationId,
      current_thread_id: body?.current_thread_id || null,
      candidates: Array.isArray(body?.candidates) ? body.candidates : []
    };
  }

  async correctThread(tenantId: string, communicationId: string, request: ThreadCorrectionRequest): Promise<ThreadCorrectionResult> {
    this.requireTenant(tenantId);
    if (!communicationId) throw new CommunicationsApiError('Communication id is required');
    return this.rawRequest(`/v1/communications/${encodeURIComponent(communicationId)}/rethread`, {
      method: 'POST', tenantId, body: request
    });
  }

  async updateThread(tenantId: string, threadId: string, patch: ThreadRegisterPatch): Promise<Record<string, unknown>> {
    this.requireTenant(tenantId);
    if (!threadId) throw new CommunicationsApiError('Thread id is required');
    return this.rawRequest(`/v1/threads/${encodeURIComponent(threadId)}`, { method: 'PATCH', tenantId, body: patch });
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

  async listMailboxes(tenantId: string): Promise<CommunicationsMailboxRef[]> {
    this.requireTenant(tenantId);
    const body = await this.rawRequest('/v1/mailboxes', { method: 'GET', tenantId });
    return Array.isArray(body?.data) ? body.data.map((item: any) => ({
      id: String(item.id),
      provider: item.provider,
      mailboxAddress: String(item.mailbox_address || ''),
      state: item.state,
      scopes: Array.isArray(item.scopes) ? item.scopes.map(String) : [],
      lastSuccessfulSyncAt: typeof item.last_successful_sync_at === 'string' ? item.last_successful_sync_at : undefined,
      watchExpiration: typeof item.watch_expiration === 'string' ? item.watch_expiration : undefined,
      lastError: typeof item.last_error === 'string' ? item.last_error : undefined,
      canCreateDrafts: item.can_create_drafts === true
    })) : [];
  }

  async listPeople(tenantId: string): Promise<CommunicationsPersonRef[]> {
    this.requireTenant(tenantId);
    const body = await this.rawRequest('/v1/contacts', { method: 'GET', tenantId });
    return Array.isArray(body?.data) ? body.data.map((item: any) => ({
      id: String(item.person_id || item.id),
      name: typeof item.name === 'string' ? item.name : undefined,
      email: typeof item.email === 'string' ? item.email : undefined,
      phone: typeof item.phone_number === 'string' ? item.phone_number : undefined
    })) : [];
  }

  async startMailboxOAuth(
    tenantId: string,
    initiatorId: string,
    returnUrl: string,
    provider: 'gmail' | 'outlook',
    setupDraftId?: string
  ): Promise<string> {
    this.requireTenant(tenantId);
    const routeProvider = provider === 'outlook' ? 'microsoft' : 'google';
    const body = await this.rawRequest(`/v1/mailboxes/oauth/${routeProvider}/start`, {
      method: 'POST', tenantId, body: {
        initiator_id: initiatorId,
        return_url: returnUrl,
        ...(setupDraftId ? { setup_draft_id: setupDraftId } : {})
      }
    });
    if (typeof body?.authorization_url !== 'string') throw new CommunicationsApiError(`Communications API did not return a ${provider} authorization URL`);
    return body.authorization_url;
  }

  async startGmailOAuth(tenantId: string, initiatorId: string, returnUrl: string): Promise<string> {
    return this.startMailboxOAuth(tenantId, initiatorId, returnUrl, 'gmail');
  }

  async syncMailbox(tenantId: string, connectionId: string, initiatorId?: string): Promise<Record<string, unknown>> {
    this.requireTenant(tenantId);
    return this.rawRequest(`/v1/mailboxes/${encodeURIComponent(connectionId)}/sync`, {
      method: 'POST', tenantId, body: initiatorId ? { initiator_id: initiatorId } : {}
    });
  }

  async createMailboxDraft(
    tenantId: string,
    connectionId: string,
    request: MailboxDraftRequest,
    idempotencyKey: string
  ): Promise<Record<string, unknown>> {
    this.requireTenant(tenantId);
    return this.rawRequest(`/v1/mailboxes/${encodeURIComponent(connectionId)}/drafts`, {
      method: 'POST', tenantId, body: request, idempotencyKey
    });
  }

  async getMailboxDraft(tenantId: string, connectionId: string, draftId: string): Promise<Record<string, unknown>> {
    this.requireTenant(tenantId);
    return this.rawRequest(`/v1/mailboxes/${encodeURIComponent(connectionId)}/drafts/${encodeURIComponent(draftId)}`, {
      method: 'GET', tenantId
    });
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
    options: { method: 'GET' | 'POST' | 'PATCH'; body?: unknown; idempotencyKey?: string; tenantId?: string }
  ): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
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
      connectionId: result?.provider_connection_id || result?.connection_id,
      content: result?.content,
      summary: result?.summary,
      subject: result?.email?.subject || result?.subject,
      sender: Array.isArray(result?.email?.from_addresses)
        ? result.email.from_addresses.map((item: any) => String(item?.formatted || item?.address || item)).join(', ')
        : result?.sender,
      recipients: Array.isArray(result?.email?.to_addresses)
        ? result.email.to_addresses.map((item: any) => String(item?.formatted || item?.address || item))
        : result?.recipients,
      providerThreadId: typeof result?.email?.provider_conversation_id === 'string' ? result.email.provider_conversation_id : undefined,
      messageId: typeof result?.email?.message_id === 'string' ? result.email.message_id : undefined,
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
