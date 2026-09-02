
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
  /** Public E.164 service number used as the sender for SMS and voice. */
  fromNumber?: string;
  /** Non-secret Communications Service identity selected for outbound email. */
  defaultEmailIdentity?: string;
  /** Optional reply-to address override; omit to use a service-generated reply route. */
  replyServiceIdentity?: string;
  /** Provider connection selected for this organization. Never a credential. */
  connectionId?: string;
  timezone?: string;
  triagePolicy?: 'all_inbound' | 'human_only' | 'correlated_only';
  sendPolicy?: 'draft_only' | 'allow_approved_send' | 'automatic';
  allowedAutomaticActions?: Array<'classify' | 'link_workflow' | 'progress_ask' | 'create_draft' | 'send_reply'>;
  /** Tenant-selected mailbox connection. The credential remains in Communications Service. */
  mailboxConnectionId?: string;
}

export type ConnectionState = 'connected' | 'degraded' | 'expired' | 'revoked' | 'pending';
export type MailboxProvider = 'gmail' | 'outlook' | 'resend';

/** Non-secret reference to a mailbox connection owned by Communications Service. */
export interface MailboxConnectionRef {
  id: string;
  provider: MailboxProvider;
  mailboxAddress: string;
  state: ConnectionState;
  scopes?: string[];
  lastSuccessfulSyncAt?: number;
  updatedAt: number;
}

/** Non-secret reference to Google credentials held by the server-side integration backend. */
export interface WorkspaceConnectionRef {
  id: string;
  provider: 'google';
  accountEmail: string;
  state: ConnectionState;
  scopes?: string[];
  updatedAt: number;
}

export interface WorkspaceResourceGrant {
  projectId: string;
  connectionId: string;
  documentId?: string;
  spreadsheetId?: string;
  sheetRange?: string;
  updatedAt: number;
}

export type ServiceProjectTemplate = 'email_triage' | 'daily_coaching';

/** Temporary, non-secret setup state. It is scoped to one tenant and user and expires after 24 hours. */
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

export interface TenantAgentProfile {
  agentId: string;
  displayName: string;
  timezone: string;
  primaryPersonId?: string;
  defaultProjectId?: string;
  allowedProjectIds?: string[];
  /** Optional person-specific grants keyed by the stable Communications person UUID. */
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
  automaticActions?: Array<'draft' | 'send' | 'call' | 'sheet_write'>;
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
  /** Mailbox connection that produced this item. Used to isolate service projects. */
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
  /** Retained for backward compatibility; recurrence is authoritative when present. */
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
  /** Required for new schedules; omitted only on legacy tenant-wide records. */
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
  teamMemberDetails?: Record<string, TeamMemberDetails>; // name -> details
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
  equals?: boolean;
  exists?: boolean;
}

export enum NodeType {
  MILESTONE = 'milestone',
  DECISION = 'decision',
  LOOP = 'loop',
  EMAIL = 'email',
  SMS = 'sms',
  PHONE_CALL = 'phone_call',
  WEBHOOK = 'webhook',
  REPORT = 'report',
  GOOGLE_DOC = 'google_doc',
  GOOGLE_SHEET_READ = 'google_sheet_read',
  GOOGLE_SHEET_APPEND = 'google_sheet_append',
  COACHING_EXTRACT = 'coaching_extract',
  EMAIL_TRIAGE = 'email_triage'
}

export interface DecisionBranch {
  targetId: string; // direct child milestone id this branch leads to
  label: string;    // e.g. 'Yes' / 'No'
  conditions?: ReadyCondition[]; // all must pass; no conditions = default (else) branch
}

export interface DecisionConfig {
  branches: DecisionBranch[];
  selectedTargetId?: string;
  decidedAt?: number;
}

export interface LoopConfig {
  loopStartId?: string; // node the loop jumps back to; body = nodes between it and the loop node
  exitConditions: ReadyCondition[]; // loop exits when all pass (checked against projectData)
  maxIterations: number;
  currentIteration: number;
  exited?: boolean;
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
  id?: string;       // correlates async provider callbacks back to this exact run
  at: number;
  /**
   * 'pending' means the action was dispatched but its result arrives later via an
   * inbound webhook (e.g. a phone call). A pending run does not complete the node
   * and its output is not merged into projectData until it resolves.
   */
  status: 'success' | 'error' | 'pending';
  /** Provider-neutral execute-until-held lifecycle. Kept alongside status for UI compatibility. */
  executionState?: 'ready' | 'running' | 'waiting' | 'completed' | 'failed';
  output?: any;
  logs?: string[];
  error?: string;
  externalId?: string;   // legacy alias for externalExecutionId
  externalExecutionId?: string;
  externalService?: 'communications' | string;
  startedAt?: number;
  resolvedAt?: number;   // when an async run reached a terminal status
  resolvedBy?: string;   // e.g. 'event:communications'
  /** Provider-independent business outcome for asynchronous communications. */
  communicationOutcome?: CommunicationOutcome;
}

export interface ActionConfig {
  template: string; // JSON or text, supports {{variable}} substitution from projectData
  autoExecute?: boolean; // run automatically when the node becomes ready during Advance Flow
  lastRun?: ActionRun;
  runHistory?: ActionRun[];
  /**
   * Human feedback carried into the next run after a reviewer sent the work
   * back. This is what turns "return for revision" into an actual redo.
   */
  revision?: {
    feedback: string;
    priorOutput?: any;
    at: number;
    count: number;
  };
}

export interface OutputVariable {
  name: string;
  type: string; // 'boolean' | 'string' | 'date'
  write_on: string; // 'approval'
  value_source: string; // 'static' | 'task_output' | 'system_date'
  value?: any;
}

export interface ProjectData {
  [key: string]: any;
}

// ===== Human-in-the-loop: asks, answers, review gates =====

/** What we need from a person. */
export type AskKind =
  | 'approval'  // sign off (or reject / send back) a piece of work
  | 'question'  // supply missing facts the flow needs to continue
  | 'choice'    // pick one of a fixed set of options
  | 'upload';   // provide a file

export type AskChannel = 'web' | 'email' | 'sms' | 'voice';
export type AskStatus = 'open' | 'answered' | 'cancelled' | 'expired';
export type AskDecision = 'approved' | 'rejected' | 'revise';

/** One field of a structured answer. Drives both the web form and inbound parsing. */
export interface AskField {
  name: string;
  label?: string;
  type: 'string' | 'boolean' | 'number' | 'date' | 'file';
  required?: boolean;
  options?: string[]; // for 'choice'
}

export interface Attachment {
  id: string;
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
  /** Resolved identity — never the identity the sender merely claimed. */
  actor: string;
  decision?: AskDecision;
  text?: string;
  values?: Record<string, any>;
  attachments?: Attachment[];
  /** Set when `values` were inferred from prose rather than entered directly. */
  confidence?: number;
  needsInterpretation?: boolean;
  /** Provider-neutral delivery identifiers retained for end-to-end audit. */
  communicationId?: string;
  transcriptId?: string;
  intent?: string;
  evidenceExcerpt?: string;
  modelVersion?: string;
  interpretedAt?: number;
  /** Original provider payload, kept for audit. */
  raw?: any;
}

/** What the reviewable artifact actually is, so the UI can render it properly. */
export interface AskArtifact {
  kind: 'markdown' | 'text' | 'json' | 'link' | 'file';
  title?: string;
  content?: string;
  url?: string;
  mime?: string;
  /** Prior revision, so a re-review can show what changed. */
  previousContent?: string;
  /** The agent's own critique of its work, if it produced one. */
  evaluation?: any;
}

export interface ReviewPolicy {
  required: boolean;
  /** Optional project-data predicate. When it is false, this run needs no review. */
  when?: ReadyCondition[];
  reviewers?: string[];
  channels?: AskChannel[];
  slaHours?: number;
  /**
   * What happens when an unanswered ask passes its due date.
   * Defaults to 'block' — silently auto-approving on a timeout turns a review
   * gate into a rubber stamp.
   */
  onExpiry?: 'block' | 'escalate' | 'auto_approve';
  /** Max times a node may be sent back for revision before the gate gives up. */
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
  /** Capability to answer this one ask. Never authenticates a session. */
  token: string;
  kind: AskKind;
  status: AskStatus;
  prompt: string;

  nodeId: string;
  /** Durable routing identity. `nodeId` remains the task id for compatibility. */
  projectId?: string;
  personId?: string;
  responseType?: AskKind;
  /** Binds an approval to one specific action run, so a stale approval cannot
   *  satisfy a later run of the same node. */
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
  /** When the accepted answer was written into project data. */
  appliedAt?: number;

  responses: HumanResponse[];
  writeBack?: OutputVariable[];
  responseContract?: AskResponseContract;

  /** Which revision cycle produced this ask (0 = first attempt). */
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
  link?: string; // optional external resource link
  completedAt?: number; // timestamp when status became 'Complete'
  
  // RACI & Approvals
  accountable?: string;
  consulted?: string[];
  informed?: string[];
  requiresApproval?: boolean;
  approvalStatus?: 'pending' | 'approved' | 'rejected';
  
  // Output and Readiness (Hybrid Human/AI Task System)
  taskType?: string; // 'send_email', 'outgoing_call', etc
  templateFile?: string; // Optional path/content of template
  dependsOn?: string[]; // Array of task IDs this task depends on
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
  
  // Extended Metadata
  estimatedTime?: number;
  actualTime?: number;
  timeUnit?: 'hours' | 'days' | 'weeks';
  dueDate?: number; // timestamp
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
  estimatedDuration: number; // in days
  completedAt?: number; // timestamp when all subtasks are complete
  x?: number;
  y?: number;

  // Flow node system — defaults to MILESTONE when absent
  nodeType?: NodeType;
  decisionConfig?: DecisionConfig; // DECISION nodes
  loopConfig?: LoopConfig;         // LOOP nodes
  actionConfig?: ActionConfig;     // EMAIL / SMS / PHONE_CALL / WEBHOOK / REPORT nodes

  /** Human review gate. Any node type can carry one. */
  reviewPolicy?: ReviewPolicy;
  /** Open and historical asks raised against this node. */
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
  startDate: number; // timestamp
  timeUnit?: 'hours' | 'days' | 'weeks';
  timeBuffer?: number; // total allocated buffer in project timeUnit
  milestones: Milestone[];
  markers?: TimelineMarker[];
  createdAt: number;
  updatedAt: number; // tracks any modification to the project
  revision?: number;
  isArchived?: boolean;
  
  // Project Data File
  projectData?: ProjectData;
  
  // Financial Fields (in Thousands $K)
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
  // To allow filtering by RACI
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
