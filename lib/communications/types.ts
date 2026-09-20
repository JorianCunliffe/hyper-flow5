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
  thread_id?: string;
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
  providerId?: string;
  deliveryStatus?: string;
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
  external_project_id?: string | null;
  correlation?: Partial<CommunicationCorrelation>;
  threadId: string;
  communications: CommunicationResult[];
  [key: string]: unknown;
}

export type ThreadStatus = 'open' | 'resolved' | 'closed';
export type ThreadCorrectionReason = 'wrong_person' | 'wrong_project' | 'wrong_topic' | 'time_gap' | 'channel_boundary' | 'duplicate_thread' | 'other';

export interface ThreadScoreSignal {
  name: string;
  value: number;
  detail?: string;
}

export interface ThreadCandidate {
  thread_id: string;
  score: number;
  confidence: number;
  excluded: boolean;
  signals: ThreadScoreSignal[];
  thread: {
    thread_id: string;
    title?: string | null;
    status?: ThreadStatus;
    person_id?: string | null;
    external_project_id?: string | null;
    project_id?: string | null;
    primary_channel?: string | null;
    last_subject?: string | null;
    last_activity_at?: string | null;
  };
}

export interface ThreadRegisterCommunication {
  communication_id: string;
  thread_id: string;
  channel: string;
  direction?: string;
  person_id?: string | null;
  occurred_at?: string;
  subject?: string | null;
  summary?: string | null;
  body?: string | null;
  resolution?: { confidence?: number; method?: string; candidates?: unknown[] };
}

export interface ThreadRegisterEntry {
  thread_id: string;
  title?: string | null;
  summary?: string | null;
  status: ThreadStatus;
  person_id?: string | null;
  participant_identity?: string | null;
  external_project_id?: string | null;
  project_id?: string | null;
  primary_channel?: string | null;
  last_channel?: string | null;
  last_subject?: string | null;
  last_activity_at?: string | null;
  purpose?: CommunicationPurpose;
  resolution_confidence?: number | null;
  resolution_method?: string | null;
  participants: Array<{ person_id?: string | null; identity_value: string; channel: string; role?: string }>;
  communications: ThreadRegisterCommunication[];
  communications_count?: number;
  decisions: Array<{ resolution_id: string; action: string; method: string; confidence?: number; created_at?: string }>;
  corrections: Array<{ feedback_id: string; reason_code: ThreadCorrectionReason; reason_detail?: string | null; from_thread_id?: string; to_thread_id?: string; active: boolean; created_at?: string }>;
}

export interface ThreadRegisterOptions {
  status?: ThreadStatus | 'all';
  personId?: string;
  externalProjectId?: string;
  limit?: number;
  offset?: number;
  threadId?: string;
  communicationOffset?: number;
}

export interface ThreadCorrectionRequest {
  thread_id?: string;
  create_new?: boolean;
  reason_code: ThreadCorrectionReason;
  reason_detail?: string;
  person_id?: string;
  update_identity?: boolean;
  external_project_id?: string | null;
  initiator_id?: string;
}

export interface ThreadRegisterPatch {
  title?: string | null;
  summary?: string | null;
  status?: ThreadStatus;
  external_project_id?: string | null;
  initiator_id?: string;
}

export interface ThreadCorrectionResult {
  communication_id: string;
  from_thread_id: string | null;
  thread_id: string;
  resolution_id: string;
  corrected: boolean;
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
  listThreadRegister(tenantId: string, options?: ThreadRegisterOptions): Promise<{ data: ThreadRegisterEntry[]; count: number; has_more?: boolean }>;
  getThreadCandidates(tenantId: string, communicationId: string): Promise<{ communication_id: string; current_thread_id: string | null; candidates: ThreadCandidate[] }>;
  correctThread(tenantId: string, communicationId: string, request: ThreadCorrectionRequest): Promise<ThreadCorrectionResult>;
  updateThread(tenantId: string, threadId: string, patch: ThreadRegisterPatch): Promise<Record<string, unknown>>;
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
