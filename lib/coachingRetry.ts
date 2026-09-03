import { NodeType, type ActionRun, type Milestone, type Project, type ProjectData } from '../types.js';

export const COACHING_MAX_ATTEMPTS = 2;
export const COACHING_RETRY_DELAY_MINUTES = 10;
export const COACHING_RETRY_WINDOW_MINUTES = 180;
export const COACHING_RETRY_POLICY_VERSION = 2;

const boundedNumber = (value: unknown, fallback: number, min: number, max: number) => {
  const number = value === undefined || value === null || value === '' ? fallback : Number(value);
  return Number.isFinite(number) ? Math.min(Math.max(Math.floor(number), min), max) : fallback;
};

export const coachingRetryPolicy = (data: ProjectData = {}) => {
  // Upgrade the old generated default without changing separately customised
  // projects. Newly saved policies carry a version, so an explicit 30 is kept.
  const legacyDefault = !data.coaching_retry_policy_version
    && Number(data.coaching_max_attempts ?? 2) === 2
    && Number(data.coaching_retry_delay_minutes) === 30
    && Number(data.coaching_retry_window_minutes ?? 180) === 180;
  return {
    // This field counts the initial call as well as any retries.
    maxAttempts: boundedNumber(data.coaching_max_attempts, COACHING_MAX_ATTEMPTS, 1, 5),
    delayMinutes: legacyDefault ? COACHING_RETRY_DELAY_MINUTES : boundedNumber(data.coaching_retry_delay_minutes, COACHING_RETRY_DELAY_MINUTES, 5, 1440),
    windowMinutes: boundedNumber(data.coaching_retry_window_minutes, COACHING_RETRY_WINDOW_MINUTES, 5, 1440)
  };
};

export const coachingCallNode = (project: Project): Milestone | undefined => {
  if (project.projectData?.project_template !== 'daily_coaching') return undefined;
  return project.milestones.find(node => node.id === 'COACH_CALL') ||
    project.milestones.find(node => node.nodeType === NodeType.PHONE_CALL && node.actionConfig?.template?.includes('coaching_session'));
};

export const coachingCallDisposition = (run?: ActionRun): string | undefined => {
  const value = run?.communicationOutcome?.disposition ?? run?.output?.disposition;
  return typeof value === 'string' ? value.trim().toLowerCase() : undefined;
};

export const coachingRetryMatchesProject = (project: Project, occurrenceId: string): boolean =>
  Boolean(occurrenceId) && !project.isArchived && Boolean(coachingCallNode(project))
    && project.projectData?.schedule_occurrence_id === occurrenceId;

// Communications uses no_meaningful_response for a greeting followed by hangup.
// Keep explicit hangup aliases for callbacks from other supported providers.
const RETRYABLE_DISPOSITIONS = new Set([
  'voicemail', 'no_meaningful_response', 'hangup', 'hang_up', 'hung_up',
  'no_answer', 'busy', 'provider_failed', 'provider_failure', 'failed'
]);

export interface CoachingRetryState {
  attempts: number;
  nextRetryAt?: number;
  retryStatus?: 'pending' | 'exhausted';
  due: boolean;
}

export const coachingRetryState = (project: Project, now = Date.now()): CoachingRetryState => {
  const data = project.projectData || {};
  const node = coachingCallNode(project);
  const run = node?.actionConfig?.lastRun;
  const occurrenceId = typeof data.schedule_occurrence_id === 'string' ? data.schedule_occurrence_id : '';
  const scheduledFor = typeof data.scheduled_for === 'string' ? Date.parse(data.scheduled_for) : NaN;
  const runs = [run, ...(node?.actionConfig?.runHistory || [])].filter((candidate): candidate is ActionRun => {
    if (!candidate) return false;
    if (candidate.scheduleOccurrenceId) return candidate.scheduleOccurrenceId === occurrenceId;
    // Legacy history has no occurrence tag. Count only this occurrence's runs,
    // never yesterday's calls; the last run belongs to the current reset flow.
    return candidate === run || (Number.isFinite(scheduledFor) && candidate.at >= scheduledFor);
  });
  const attempts = new Set(runs.map(candidate => candidate.id || `legacy:${candidate.at}`)).size;
  const state: CoachingRetryState = { attempts, due: false };
  if (!node || run?.status !== 'error' || !RETRYABLE_DISPOSITIONS.has(coachingCallDisposition(run) || '')) return state;
  const policy = coachingRetryPolicy(data);
  if (attempts >= policy.maxAttempts) return { ...state, retryStatus: 'exhausted' };
  if (!occurrenceId || !Number.isFinite(scheduledFor)) return state;
  if (run.scheduleOccurrenceId && run.scheduleOccurrenceId !== occurrenceId) return state;

  const failedAt = Number(run.resolvedAt ?? run.at);
  if (!Number.isFinite(failedAt)) return state;
  const nextRetryAt = failedAt + policy.delayMinutes * 60_000;
  const windowEnd = scheduledFor + policy.windowMinutes * 60_000;
  if (now > windowEnd || nextRetryAt > windowEnd) return { ...state, retryStatus: 'exhausted' };
  return { attempts, nextRetryAt, retryStatus: 'pending', due: now >= nextRetryAt };
};
