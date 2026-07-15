
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

export interface AppSettings {
  projectTypes: string[];
  companies: string[];
  people: string[];
  roles: string[];
  teamMemberDetails?: Record<string, TeamMemberDetails>; // name -> details
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

export interface ActionRun {
  at: number;
  status: 'success' | 'error';
  output?: any;
  logs?: string[];
  error?: string;
}

export interface ActionConfig {
  template: string; // JSON or text, supports {{variable}} substitution from projectData
  autoExecute?: boolean; // run automatically when the node becomes ready during Advance Flow
  lastRun?: ActionRun;
  runHistory?: ActionRun[];
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