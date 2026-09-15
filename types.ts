
export enum SubtaskStatus {
  COMPLETE = 'Completed',
  NOT_COMPLETE = 'Not Complete',
  NOT_STARTED = 'Not started',
  NEEDS_PREPARATION = 'Needs preparation',
  READY = 'Ready',
  STARTED = 'Started',
  SUBMITTED = 'Submitted',
  HELD = 'Held',
  ABANDONED = 'Abandoned'
}

export enum ProjectType {
  SUBDIVISION = 'Subdivision',
  GREENFIELD = 'Greenfield Development',
  OTHER = 'Other'
}

export interface TeamMemberDetails {
  email?: string;
  phone?: string;
}

export interface CommunicationsSettings {
  fromNumber?: string;
  defaultEmailIdentity?: string;
  replyServiceIdentity?: string;
  connectionId?: string;
  timezone?: string;
  triagePolicy?: 'all_inbound' | 'human_only' | 'correlated_only';
  sendPolicy?: 'draft_only' | 'allow_approved_send' | 'automatic';
  allowedAutomaticActions?: Array<'classify' | 'link_workflow' | 'progress_ask' | 'create_draft' | 'send_reply'>;
  mailboxConnectionId?: string;
}

export type ConnectionState = 'connected' | 'degraded' | 'expired' | 'revoked' | 'pending';
export type MailboxProvider = 'gmail' | 'outlook' | 'resend';

export interface MailboxConnectionRef {
  id: string;
  provider: MailboxProvider;
  mailboxAddress: string;
  state: ConnectionState;
  scopes?: string[];
  lastSuccessfulSyncAt?: number;
  updatedAt: number;
}

export interface WorkspaceConnectionRef {
  id: string;
  provider: 'google';
  accountEmail: string;
  state: ConnectionState;
  scopes?: string[];
  updatedAt: number;
}

export type WorkspaceResourcePermission = 'read' | 'append' | 'upsert';

export interface WorkspaceNamedResource {
  name: string;
  type: 'google_doc' | 'google_sheet_range';
  documentId?: string;
  spreadsheetId?: string;
  range?: string;
  permissions?: WorkspaceResourcePermission[];
}

export interface WorkspaceResourceGrant {
  projectId: string;
  connectionId: string;
  /** Legacy/default resources retained for backwards compatibility. */
  documentId?: string;
  spreadsheetId?: string;
  sheetRange?: string;
  /** Human-named resources selected by action templates via resource_name. */
  resources?: WorkspaceNamedResource[];
  updatedAt: number;
}

export type ServiceProjectTemplate = 'email_triage' | 'daily_coaching';

export interface ServiceSetupDraft {
  id: string;
  orgId: string;
  uid: string;
  template: ServiceProjectTemplate;
  data: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
  expiresAt: number;
}

export interface ServiceValidationCheck {
  key: string;
  label: string;
  ok: boolean;
  message: string;
}

export interface ServiceSetupValidation {
  ready: boolean;
  checks: ServiceValidationCheck[];
  validatedAt: number;
}

export interface SchedulerHealth {
  lastTickAt?: number;
  lastSuccessfulTickAt?: number;
  lastError?: string;
  updatedAt: number;
}

export interface ExternalActionReceipt {
  id: string;
  orgId: string;
  projectId: string;
  kind: 'google_sheet_append' | 'google_sheet_upsert' | 'mailbox_draft' | string;
  idempotencyKey: string;
  requestHash: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  completedAt?: number;
  response?: Record<string, unknown>;
  error?: string;
}

export interface CoachingSession {
  id: string;
  orgId: string;
  projectId: string;
  scheduleId?: string;
  scheduleRunId?: string;
  scheduledFor?: number;
  communicationId?: string;
  documentId?: string;
  documentRevision?: string;
  documentReadAt?: string;
  spreadsheetId?: string;
  sheetRange?: string;
  sheetReadAt?: string;
  disposition?: string;
  transcriptId?: string;
  status: 'scheduled' | 'calling' | 'review_required' | 'completed' | 'failed';
  summary?: string;
  progress?: string;
  blockers?: string;
  commitments?: string;
  nextActions?: string;
  confidence?: number;
  sheetWrite?: Record<string, unknown>;
  failureReason?: string;
  attemptCount?: number;
  nextRetryAt?: number;
  retryStatus?: 'pending' | 'processing' | 'exhausted';
  retryClaimedAt?: number;
  retryLeaseExpiresAt?: number;
  createdAt: number;
  updatedAt: number;
}

export type CapabilityPolicyMode = 'automatic' | 'approval' | 'denied';

export interface TenantAgentProfile {
  agentId: string;
  displayName: string;
  timezone: string;
  primaryPersonId?: string;
  primaryUserId?: string;
  conversation?: {
    historyEnabled?: boolean;
    prompt?: string;
    smsPrompt?: string;
    voicePrompt?: string;
  };
  receptionistEnabled?: boolean;
  receptionistProjectId?: string;
  contactWindow?: {startHour:number;endHour:number;maxPerDay:number;maxPerContact:number};
  defaultProjectId?: string;
  allowedProjectIds?: string[];
  personProjectAccess?: Array<{
    personId: string;
    projectIds: string[];
  }>;
  serviceIdentities?: {
    phone?: string;
    sms?: string;
    email?: string;
  };
  clarificationPolicy?: 'always' | 'when_ambiguous';
  /** Legacy policy retained while existing settings migrate. */
  automaticActions?: Array<'draft' | 'send' | 'call' | 'sheet_write'>;
  /** Provider-neutral authority keyed by capability, e.g. phone.call or sheet.append. */
  capabilityPolicy?: Record<string, CapabilityPolicyMode>;
}

export interface CommunicationsPersonRef {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
}

export interface ConversationContext {
  id: string;
  orgId: string;
  threadId: string;
  personId?: string;
  channel: 'email' | 'sms' | 'voice' | string;
  activeProjectId?: string;
  topic?: string;
  selectionConfidence?: number;
  clarificationState?: 'none' | 'awaiting_project';
  replyWindowStartedAt?: number;
  automaticReplyCount?: number;
  lastAutomaticReplyAt?: number;
  updatedAt: number;
  expiresAt: number;
}

export interface ProjectRoutingDecision {
  kind: 'routed' | 'clarification' | 'unavailable';
  projectId?: string;
  reason: 'trusted_correlation' | 'explicit_reference' | 'active_context' | 'default_project' | 'single_project' | 'ambiguous' | 'no_projects';
  confidence: number;
  candidateProjectIds: string[];
  decidedAt: number;
}

export interface AgentInboxJob {
  id: string;
  orgId: string;
  communicationId: string;
  eventId: string;
  channel: 'email' | 'sms' | 'voice' | string;
  threadId?: string;
  personId?: string;
  trustedProjectId?: string;
  status: 'pending' | 'processing' | 'completed' | 'needs_review' | 'failed';
  attemptCount: number;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  leaseExpiresAt?: number;
  routing?: ProjectRoutingDecision;
  responseCommunicationId?: string;
  responseDraftId?: string;
  error?: string;
}

export interface AgentActionProposal {
  kind: 'coaching_commitment' | 'coaching_next_action' | 'request_coaching_call';
  projectId: string;
  summary: string;
  value?: string;
  confidence: number;
  status: 'pending' | 'processing' | 'applied' | 'rejected' | 'failed';
  requestedAt: number;
  reviewedBy?: string;
  reviewedAt?: number;
  error?: string;
}

export type TriageDisposition =
  | 'new'
  | 'linked_workflow'
  | 'awaiting_interpretation'
  | 'draft_prepared'
  | 'needs_review'
  | 'ignored'
  | 'resolved'
  | 'spam_automatic'
  | 'delivery_failure';

export interface TriageInterpretation {
  intent?: string;
  decision?: AskDecision;
  values?: Record<string, unknown>;
  confidence?: number;
  evidence?: string;
  modelVersion?: string;
  interpretedAt?: number;
  acceptedAt?: number;
  correctedBy?: string;
}

export interface TriageItem {
  id: string;
  orgId: string;
  communicationId: string;
  connectionId?: string;
  threadId?: string;
  channel: 'email' | 'sms' | 'voice' | 'web' | string;
  direction: 'inbound' | 'outbound';
  occurredAt: string;
  sender?: string;
  recipients?: string[];
  subject?: string;
  preview?: string;
  personId?: string;
  projectId?: string;
  askId?: string;
  askKind?: AskKind;
  askFields?: AskField[];
  runId?: string;
  taskId?: string;
  classification?: string;
  automated?: boolean;
  bounce?: boolean;
  spam?: boolean;
  memoryEligible?: boolean;
  disposition: TriageDisposition;
  proposedAction?: string;
  interpretation?: TriageInterpretation;
  priority?: 'low' | 'normal' | 'high' | 'urgent';
  intent?: string;
  requestedAction?: string;
  deadline?: string;
  risk?: 'low' | 'medium' | 'high';
  summary?: string;
  evidence?: string[];
  recommendation?: string;
  providerDraftId?: string;
  agentProposal?: AgentActionProposal;
  audit: Array<{ at: number; action: string; actor: string; detail?: string }>;
  createdAt: number;
  updatedAt: number;
}

export type ScheduleRecurrence =
  | { kind: 'interval'; intervalMinutes: number }
  | { kind: 'daily'; localTime: string };

export type ScheduleMisfirePolicy = 'run_once' | 'catch_up' | 'skip';

export interface TenantScheduleBase {
  id: string;
  orgId: string;
  name: string;
  enabled: boolean;
  intervalMinutes: number;
  recurrence: ScheduleRecurrence;
  misfirePolicy: ScheduleMisfirePolicy;
  timezone: string;
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface TriageDigest {
  id: string;
  orgId: string;
  scheduleId: string;
  projectId?: string;
  scheduledFor: number;
  timezone: string;
  itemIds: string[];
  counts: {
    total: number;
    outstanding: number;
    urgent: number;
    high: number;
    needsReview: number;
    draftsPrepared: number;
  };
  summary: string;
  deliveryChannel: 'web' | 'email' | 'sms';
  deliveryStatus: 'available' | 'drafted' | 'sent' | 'needs_review' | 'failed';
  deliveryId?: string;
  deliveryError?: string;
  createdAt: number;
  updatedAt: number;
}

export interface CommunicationsTriageSchedule extends TenantScheduleBase {
  activity: 'communications_triage';
  projectId?: string;
  connectionId?: string;
  triagePolicy?: 'all_inbound' | 'human_only' | 'correlated_only';
  createDrafts?: boolean;
  policy: 'draft_only' | 'allow_approved_send' | 'automatic';
  digestChannel?: 'web' | 'email' | 'sms';
  digestRecipient?: string;
}

export interface FlowStartSchedule extends TenantScheduleBase {
  activity: 'flow_start';
  projectId: string;
  flowId?: string;
  input?: Record<string, unknown>;
  resetPolicy?: 'none' | 'flow';
  clearProjectDataKeys?: string[];
}

export type TenantSchedule = CommunicationsTriageSchedule | FlowStartSchedule;

export type TenantScheduleInput = Partial<Omit<TenantScheduleBase, 'id' | 'orgId' | 'createdAt' | 'updatedAt'>> & {
  id?: string;
  name?: string;
  activity?: TenantSchedule['activity'];
  connectionId?: string;
  policy?: CommunicationsTriageSchedule['policy'];
  digestChannel?: CommunicationsTriageSchedule['digestChannel'];
  digestRecipient?: string;
  triagePolicy?: CommunicationsTriageSchedule['triagePolicy'];
  createDrafts?: boolean;
  projectId?: string;
  flowId?: string;
  input?: Record<string, unknown>;
  resetPolicy?: FlowStartSchedule['resetPolicy'];
  clearProjectDataKeys?: string[];
};

export interface ScheduleRun {
  id: string;
  orgId: string;
  scheduleId: string;
  activity: TenantSchedule['activity'];
  projectId?: string;
  flowId?: string;
  scheduledFor: number;
  status: 'running' | 'partial' | 'completed' | 'failed';
  claimId: string;
  startedAt: number;
  attempt?: number;
  completedAt?: number | null;
  cursorBefore?: string;
  cursorAfter?: string;
  processedCount?: number;
  error?: string | null;
}

export interface AppSettings {
  projectTypes: string[];
  companies: string[];
  people: string[];
  roles: string[];
  teamMemberDetails?: Record<string, TeamMemberDetails>;
  communications?: CommunicationsSettings;
  agent?: TenantAgentProfile;
  mailboxConnections?: Record<string, MailboxConnectionRef>;
  workspaceConnections?: Record<string, WorkspaceConnectionRef>;
  activeWorkspaceConnectionId?: string;
  statuses: string[];
  dateFormat: 'DD/MM/YY' | 'MM/DD/YY';
  nextProjectId?: number;
  nextTaskId?: number;
}

export interface ReadyCondition {
  variable: string;
  equals?: string | number | boolean | null;
  notEquals?: string | number | boolean | null;
  oneOf?: Array<string | number | boolean | null>;
  exists?: boolean;
}

export enum NodeType {
  MILESTONE = 'milestone',
  DECISION = 'decision',
  LOOP = 'loop',
  WAIT = 'wait',
  END = 'end',
  EVENT_TRIGGER = 'event_trigger',
  EMAIL = 'email',
  SMS = 'sms',
  PHONE_CALL = 'phone_call',
  WEBHOOK = 'webhook',
  REPORT = 'report',
  GOOGLE_DOC = 'google_doc',
  GOOGLE_SHEET_READ = 'google_sheet_read',
  GOOGLE_SHEET_APPEND = 'google_sheet_append',
  GOOGLE_SHEET_UPSERT = 'google_sheet_upsert',
  COACHING_EXTRACT = 'coaching_extract',
  EMAIL_TRIAGE = 'email_triage'
}

export interface DecisionBranch {
  targetId: string;
  label: string;
  conditions?: ReadyCondition[];
}

export interface DecisionConfig {
  branches: DecisionBranch[];
  selectedTargetId?: string;
  decidedAt?: number;
}

export interface LoopConfig {
  loopStartId?: string;
  exitConditions: ReadyCondition[];
  maxIterations: number;
  currentIteration: number;
  exited?: boolean;
}

export interface WaitConfig {
  kind: 'timer';
  durationMinutes?: number;
  resumeAt?: number;
  reason?: string;
  maxResumes?: number;
  armedAt?: number;
  resolvedAt?: number;
  holdId?: string;
  occurrenceId?: string;
}

export interface FlowEvent {
  id: string;
  type: string;
  occurredAt: number;
  channel?: string;
  direction?: string;
  personId?: string;
  communicationId?: string;
  payload?: Record<string, unknown>;
}

export interface EventTriggerConfig {
  eventTypes: string[];
  channels?: string[];
  directions?: string[];
  personIds?: string[];
  payloadVariable?: string;
  lastEventId?: string;
  triggeredAt?: number;
  occurrenceId?: string;
}

export interface CommunicationOutcome {
  businessStatus?: 'pending' | 'success' | 'failed' | string;
  disposition?: string;
  successful?: boolean;
  memoryEligible?: boolean;
  failureCode?: string;
  failureReason?: string;
  providerStatus?: string;
  source?: string;
  confidence?: number;
}

export interface ActionRun {
  id?: string;
  scheduleOccurrenceId?: string;
  at: number;
  status: 'success' | 'error' | 'pending';
  executionState?: 'ready' | 'running' | 'waiting' | 'completed' | 'failed';
  output?: any;
  logs?: string[];
  error?: string;
  externalId?: string;
  externalExecutionId?: string;
  externalService?: 'communications' | string;
  startedAt?: number;
  resolvedAt?: number;
  resolvedBy?: string;
  communicationOutcome?: CommunicationOutcome;
}

export interface ActionConfig {
  template: string;
  autoExecute?: boolean;
  /** Errors block by default. Continue exposes them as graph results for Decisions. */
  failureMode?: 'block' | 'continue';
  /** Project-data prefix receiving status/success/output/error/outcome fields. */
  resultVariable?: string;
  lastRun?: ActionRun;
  runHistory?: ActionRun[];
  revision?: {
    feedback: string;
    priorOutput?: any;
    at: number;
    count: number;
  };
}

export interface OutputVariable {
  name: string;
  type: string;
  write_on: string;
  value_source: string;
  value?: any;
}

export interface ProjectData {
  [key: string]: any;
}

export type AskKind =
  | 'approval'
  | 'question'
  | 'choice'
  | 'upload';

export type AskChannel = 'web' | 'email' | 'sms' | 'voice';
export type AskStatus = 'open' | 'answered' | 'cancelled' | 'expired';
export type AskDecision = 'approved' | 'rejected' | 'revise';

export interface AskField {
  name: string;
  label?: string;
  type: 'string' | 'boolean' | 'number' | 'date' | 'file';
  required?: boolean;
  options?: string[];
}

export interface Attachment {
  id: string;
  field?: string;
  url: string;
  storagePath?: string;
  name?: string;
  mime?: string;
  bytes?: number;
  kind: 'image' | 'document' | 'video' | 'audio' | 'other';
  source: AskChannel;
  capturedAt: number;
}

export interface HumanResponse {
  id: string;
  at: number;
  via: AskChannel;
  actor: string;
  decision?: AskDecision;
  text?: string;
  values?: Record<string, any>;
  attachments?: Attachment[];
  confidence?: number;
  needsInterpretation?: boolean;
  communicationId?: string;
  transcriptId?: string;
  intent?: string;
  evidenceExcerpt?: string;
  modelVersion?: string;
  interpretedAt?: number;
  raw?: any;
}

export interface AskArtifact {
  kind: 'markdown' | 'text' | 'json' | 'link' | 'file';
  title?: string;
  content?: string;
  url?: string;
  mime?: string;
  previousContent?: string;
  evaluation?: any;
}

export interface ReviewPolicy {
  required: boolean;
  when?: ReadyCondition[];
  reviewers?: string[];
  channels?: AskChannel[];
  slaHours?: number;
  onExpiry?: 'block' | 'escalate' | 'auto_approve';
  maxRevisions?: number;
  responsePolicy?: 'any' | 'all' | 'quorum';
  quorum?: number;
}

export interface AskResponseContract {
  expectedIntents?: string[];
  allowedDecisions?: AskDecision[];
  confidenceThreshold?: number;
  automaticProgress?: 'never' | 'high_confidence' | 'validated';
  reviewRequired?: boolean;
  expiryPolicy?: 'block' | 'escalate' | 'close';
}

export interface HumanAsk {
  id: string;
  token: string;
  kind: AskKind;
  status: AskStatus;
  prompt: string;
  nodeId: string;
  projectId?: string;
  personId?: string;
  responseType?: AskKind;
  runId?: string;
  subtaskId?: string;
  fields?: AskField[];
  artifact?: AskArtifact;
  assignees: string[];
  channels: AskChannel[];
  responsePolicy?: 'any' | 'all' | 'quorum';
  quorum?: number;
  deliveries?: {
    channel: Exclude<AskChannel, 'web'>;
    personId: string;
    deliveryAskId?: string;
    deliveryToken?: string;
    communicationId?: string;
    status: 'accepted' | 'failed';
    at: number;
    error?: string;
  }[];
  createdAt: number;
  dueAt?: number;
  answeredAt?: number;
  appliedAt?: number;
  responses: HumanResponse[];
  writeBack?: OutputVariable[];
  responseContract?: AskResponseContract;
  revision?: number;
}

export interface Subtask {
  id: string;
  displayId?: string;
  name: string;
  assignedTo: string;
  role?: string;
  description: string;
  notes?: string;
  commentHistory?: { text: string; status: string; timestamp: number }[];
  status: string;
  link?: string;
  completedAt?: number;
  accountable?: string;
  consulted?: string[];
  informed?: string[];
  requiresApproval?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  taskType?: string;
  templateFile?: string;
  dependsOn?: string[];
  readyConditions?: ReadyCondition[];
  missingVariables?: string[];
  failedConditions?: ReadyCondition[];
  outputLocation?: string;
  outputVariables?: OutputVariable[];
  taskOutput?: any;
  evaluationResult?: string;
  externalRunId?: string;
  externalExecutionId?: string;
  externalService?: string;
  externalStartedAt?: number;
  estimatedTime?: number;
  actualTime?: number;
  timeUnit?: 'hours' | 'days' | 'weeks';
  dueDate?: number;
  isImportant?: boolean;
  isToday?: boolean;
  recordingUrl?: string;
  recordingType?: 'video' | 'audio';
}

export interface Milestone {
  id: string;
  name: string;
  subtasks: Subtask[];
  dependsOn: string[];
  estimatedDuration: number;
  completedAt?: number;
  x?: number;
  y?: number;
  nodeType?: NodeType;
  decisionConfig?: DecisionConfig;
  loopConfig?: LoopConfig;
  waitConfig?: WaitConfig;
  eventTriggerConfig?: EventTriggerConfig;
  actionConfig?: ActionConfig;
  reviewPolicy?: ReviewPolicy;
  asks?: HumanAsk[];
}

export interface TimelineMarker {
  id: string;
  name: string;
  x: number;
}

export interface Project {
  id: string;
  displayId?: string;
  name: string;
  company: string;
  type: string;
  startDate: number;
  timeUnit?: 'hours' | 'days' | 'weeks';
  timeBuffer?: number;
  milestones: Milestone[];
  markers?: TimelineMarker[];
  createdAt: number;
  updatedAt: number;
  revision?: number;
  isArchived?: boolean;
  projectData?: ProjectData;
  cashRequirement?: number;
  debtRequirement?: number;
  valueAtCompletion?: number;
  profit?: number;
}

export interface ActivityLog {
  id: string;
  projectId: string;
  taskId: string;
  taskName: string;
  action: 'created' | 'updated' | 'deleted';
  userId: string;
  timestamp: number;
  details?: string;
  raci?: {
    responsible?: string;
    accountable?: string;
    consulted?: string[];
    informed?: string[];
  };
}

export interface ScratchTask {
  id: string;
  name: string;
  projectId?: string;
  createdBy?: string;
  createdAt: number;
}

export interface AppState {
  projects: Project[];
  selectedProjectId: string | null;
  showSubtasks: boolean;
  settings: AppSettings;
  scratchTasks?: ScratchTask[];
}
