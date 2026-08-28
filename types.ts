
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
  audit: Array<{ at: number; action: string; actor: string; detail?: string }>;
  createdAt: number;
  updatedAt: number;
}

export interface TenantSchedule {
  id: string;
  orgId: string;
  name: string;
  activity: 'communications_triage';
  enabled: boolean;
  intervalMinutes: number;
  timezone: string;
  connectionId?: string;
  policy: 'draft_only' | 'allow_approved_send' | 'automatic';
  nextRunAt: number;
  createdAt: number;
  updatedAt: number;
}

export interface ScheduleRun {
  id: string;
  orgId: string;
  scheduleId: string;
  scheduledFor: number;
  status: 'running' | 'completed' | 'failed';
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
  REPORT = 'report'
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
