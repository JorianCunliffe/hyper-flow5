import type { AskChannel, AskField, AskKind, Milestone, ProjectData } from '../types.js';

export type FlowRunTrigger = 'manual' | 'schedule' | 'event';
export type FlowRunStatus = 'running' | 'waiting' | 'completed' | 'failed' | 'cancelled';
export type NodeRunStatus = 'pending' | 'running' | 'waiting' | 'completed' | 'failed' | 'skipped';
export type FlowHoldKind = 'timer' | 'event' | 'human' | 'provider';
export type FlowHoldResolution = 'timer' | 'signal' | 'timeout' | 'cancelled';

export interface FlowHoldMatch {
  eventTypes?: string[];
  channels?: string[];
  directions?: string[];
  personIds?: string[];
  askIds?: string[];
  providerServices?: string[];
  actionRunIds?: string[];
  externalIds?: string[];
}

/**
 * Human-configurable durable wait primitive. `timer` resolves when its duration
 * elapses. Other kinds wait for a matching signal and may optionally time out.
 */
export interface FlowHoldConfig {
  kind: FlowHoldKind;
  durationMinutes?: number;
  timeoutMinutes?: number;
  reason?: string;
  resultVariable?: string;
  payloadVariable?: string;
  match?: FlowHoldMatch;
  human?: {
    kind?: AskKind;
    prompt?: string;
    fields?: AskField[];
    /**
     * Optional dot path into projectData whose value is an array of field
     * definitions (or strings). The source is resolved once when the Ask is
     * raised, so later project-data edits cannot mutate an in-flight Ask schema.
     */
    fieldsSource?: string;
    assignees?: string[];
    channels?: AskChannel[];
    responsePolicy?: 'any' | 'all' | 'quorum';
    quorum?: number;
  };

  // Runtime fields. These are copied with the FlowRun, never shared between runs.
  holdId?: string;
  armedAt?: number;
  availableAt?: number;
  resolvedAt?: number;
  occurrenceId?: string;
  resolution?: FlowHoldResolution;
  resolvedBy?: string;
  signalId?: string;
}

export interface FlowSignal {
  id: string;
  kind: 'event' | 'human' | 'provider';
  occurredAt: number;
  eventType?: string;
  channel?: string;
  direction?: string;
  personId?: string;
  communicationId?: string;
  askId?: string;
  askToken?: string;
  providerService?: string;
  actionRunId?: string;
  externalId?: string;
  payload?: Record<string, unknown>;
}

export interface NodeRun {
  id: string;
  flowRunId: string;
  nodeId: string;
  nodeType: string;
  attempt: number;
  status: NodeRunStatus;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  actionRunId?: string;
  holdIds?: string[];
  askIds?: string[];
  error?: string;
}

export interface FlowRunState {
  milestones: Milestone[];
  projectData: ProjectData;
}

/**
 * Authoritative execution record for one occurrence of a project flow. Project
 * milestones remain the editable definition; mutable execution state lives here.
 */
export interface FlowRun {
  id: string;
  orgId: string;
  projectId: string;
  flowId?: string;
  occurrenceId: string;
  trigger: FlowRunTrigger;
  triggerId?: string;
  status: FlowRunStatus;
  state: FlowRunState;
  nodeRuns: Record<string, NodeRun[]>;
  revision: number;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  cancelledAt?: number;
  error?: string;
}

export interface FlowHold {
  id: string;
  orgId: string;
  projectId: string;
  flowRunId: string;
  nodeId: string;
  source: 'wait' | 'action' | 'review';
  kind: FlowHoldKind;
  status: 'waiting' | 'processing' | 'resolved' | 'cancelled';
  occurrenceId: string;
  reason?: string;
  resultVariable?: string;
  payloadVariable?: string;
  match?: FlowHoldMatch;
  askId?: string;
  askToken?: string;
  actionRunId?: string;
  externalId?: string;
  providerService?: string;
  availableAt?: number;
  resolution?: FlowHoldResolution;
  createdAt: number;
  updatedAt: number;
  claimedAt?: number;
  leaseExpiresAt?: number;
  attemptCount?: number;
  error?: string;
}

export type RuntimeMilestone = Milestone & { holdConfig?: FlowHoldConfig };
