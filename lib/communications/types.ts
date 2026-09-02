export interface CommunicationCorrelation {
  tenant_id: string;
  external_project_id?: string;
  /** @deprecated transition alias accepted by Communications Service */
  project_id?: string;
  run_id: string;
  task_id: string;
  /** HyperFlow person/directory correlation; not a Communications contacts.id UUID. */
  person_id?: string;
}

export interface CommunicationPurpose {
  type: 'human_ask' | 'workflow_notification' | 'workflow_action' | 'triage' | string;
  ask_id?: string;
  token?: string;
}

export interface SendSmsRequest {
  to: string;
  from: string;
  body: string;
  correlation: CommunicationCorrelation;
  purpose?: CommunicationPurpose;
  callback_url?: string;
}

/** The only Communications voice overrides HyperFlow is allowed to send. */
export interface HyperFlowCallOverrides {
  systemMessage: string;
  greetingText: string;
  aiSpeaksFirst: true;
  liveTranscript: true;
}

export interface StartCallRequest {
  to: string;
  from: string;
  overrides: HyperFlowCallOverrides;
  correlation: CommunicationCorrelation;
  purpose?: CommunicationPurpose;
  callback_url?: string;
}

export interface SendEmailRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  from?: string;
  service_identity_id?: string;
  provider_connection_id?: string;
  reply_to?: string[];
  subject: string;
  text?: string;
  html?: string;
  /** Optional tenant-owned Communications contacts.id UUID. */
  person_id?: string;
  thread_id?: string;
  correlation: CommunicationCorrelation;
  purpose?: CommunicationPurpose;
  callback_url?: string;
}

export type CommunicationStatus =
  | 'accepted'
  | 'queued'
  | 'ready'
  | 'running'
  | 'in_progress'
  | 'waiting'
  | 'completed'
  | 'failed';

export interface CommunicationResult {
  id: string;
  status: CommunicationStatus;
  channel?: 'email' | 'sms' | 'voice';
  tenantId?: string;
  threadId?: string;
  direction?: 'inbound' | 'outbound';
  occurredAt?: string;
  personId?: string;
  connectionId?: string;
  content?: string;
  summary?: string;
  subject?: string;
  sender?: string;
  recipients?: string[];
  providerThreadId?: string;
  messageId?: string;
  correlation?: Partial<CommunicationCorrelation>;
  purpose?: CommunicationPurpose;
  outcome?: Record<string, unknown>;
  output?: Record<string, unknown>;
  error?: string;
}

export interface CommunicationListOptions {
  cursor?: string;
  limit?: number;
  channel?: 'email' | 'sms' | 'voice';
  threadId?: string;
  askId?: string;
  personId?: string;
  direction?: 'inbound' | 'outbound';
  memoryEligible?: boolean;
  connectionId?: string;
}

export interface CommunicationListResult {
  data: CommunicationResult[];
  count?: number;
  limit: number;
  nextCursor?: string;
}

export interface CommunicationThreadResult {
  threadId: string;
  communications: CommunicationResult[];
  [key: string]: unknown;
}

export interface CommunicationsTriageItem {
  id: string;
  communicationId: string;
  threadId?: string;
  disposition?: string;
  classification?: string;
  communication?: CommunicationResult;
  [key: string]: unknown;
}

export interface ResolveAskResult {
  ask_id: string;
  status: 'resolved' | 'already_resolved';
  communication_id: string;
}

export interface CommunicationsMailboxRef {
  id: string;
  provider: 'gmail' | 'outlook';
  mailboxAddress: string;
  state: 'connected' | 'pending' | 'healthy' | 'syncing' | 'degraded' | 'expired' | 'revoked';
  scopes: string[];
  lastSuccessfulSyncAt?: string;
  watchExpiration?: string;
  lastError?: string;
  canCreateDrafts: boolean;
}

export interface CommunicationsPersonRef {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface MailboxDraftRequest {
  to: string[];
  cc?: string[];
  bcc?: string[];
  reply_to?: string[];
  subject: string;
  text?: string;
  html?: string;
  communication_id?: string;
  provider_thread_id?: string;
  in_reply_to?: string;
  references?: string;
  initiator_id?: string;
}

export interface CommunicationsClient {
  sendSms(request: SendSmsRequest): Promise<CommunicationResult>;
  startCall(request: StartCallRequest): Promise<CommunicationResult>;
  sendEmail(request: SendEmailRequest): Promise<CommunicationResult>;
  listCommunications(tenantId: string, options?: CommunicationListOptions): Promise<CommunicationListResult>;
  getCommunication(tenantId: string, id: string): Promise<CommunicationResult>;
  getThread(tenantId: string, threadId: string): Promise<CommunicationThreadResult>;
  listTriageItems(tenantId: string, options?: CommunicationListOptions): Promise<CommunicationsTriageItem[]>;
  setTriageDisposition(tenantId: string, itemId: string, disposition: string): Promise<CommunicationsTriageItem>;
  resolveAsk(tenantId: string, askId: string, communicationId: string): Promise<ResolveAskResult>;
  listMailboxes(tenantId: string): Promise<CommunicationsMailboxRef[]>;
  listPeople(tenantId: string): Promise<CommunicationsPersonRef[]>;
  startMailboxOAuth(tenantId: string, initiatorId: string, returnUrl: string, provider: 'gmail' | 'outlook', setupDraftId?: string): Promise<string>;
  startGmailOAuth(tenantId: string, initiatorId: string, returnUrl: string): Promise<string>;
  syncMailbox(tenantId: string, connectionId: string, initiatorId?: string): Promise<Record<string, unknown>>;
  createMailboxDraft(tenantId: string, connectionId: string, request: MailboxDraftRequest, idempotencyKey: string): Promise<Record<string, unknown>>;
  getMailboxDraft(tenantId: string, connectionId: string, draftId: string): Promise<Record<string, unknown>>;
}
