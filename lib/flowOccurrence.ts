import type { Project } from '../types.js';
import type { RuntimeMilestone } from './flowRuntimeTypes.js';

const activeOccurrence = (project: Project): string | undefined => {
  const generic = project.projectData?.flow_occurrence_id;
  if (typeof generic === 'string' && generic) return generic;
  const scheduled = project.projectData?.schedule_occurrence_id;
  return typeof scheduled === 'string' && scheduled ? scheduled : undefined;
};

const RUNTIME_TRIGGER_KEYS = [
  'flow_run_id', 'flow_occurrence_id', 'flow_started_at', 'flow_dispatch_version',
  'flow_trigger_event_id', 'flow_trigger_event_type', 'flow_triggered_at',
  'flow_trigger_channel', 'flow_trigger_direction', 'flow_trigger_person_id', 'flow_trigger_communication_id',
  'schedule_id', 'schedule_run_id', 'schedule_occurrence_id', 'scheduled_for'
];

/**
 * Resets mutable execution state for a new occurrence while retaining audit
 * history and project configuration. Schedules, events and manual FlowRuns all
 * use this exact primitive.
 */
export const resetProjectForOccurrence = (
  project: Project,
  occurrenceId: string,
  clearProjectDataKeys: string[] = []
): Project => {
  const currentOccurrence = activeOccurrence(project);
  if (currentOccurrence === occurrenceId) return project;

  const projectData = { ...(project.projectData || {}) };
  for (const key of [...RUNTIME_TRIGGER_KEYS, ...clearProjectDataKeys]) delete projectData[key];

  return {
    ...project,
    projectData,
    milestones: project.milestones.map(node => {
      const runtime = node as RuntimeMilestone;
      return {
        ...node,
        completedAt: node.nodeType === 'end' ? undefined : node.completedAt,
        ...(node.actionConfig ? {
          actionConfig: {
            ...node.actionConfig,
            lastRun: undefined,
            revision: undefined,
            runHistory: node.actionConfig.lastRun
              ? [...(node.actionConfig.runHistory || []), {
                  ...node.actionConfig.lastRun,
                  scheduleOccurrenceId: node.actionConfig.lastRun.scheduleOccurrenceId || currentOccurrence
                }]
              : node.actionConfig.runHistory
          }
        } : {}),
        ...(node.decisionConfig ? {
          decisionConfig: { ...node.decisionConfig, selectedTargetId: undefined, decidedAt: undefined }
        } : {}),
        ...(node.loopConfig ? {
          loopConfig: { ...node.loopConfig, currentIteration: 0, exited: false }
        } : {}),
        ...(node.waitConfig ? {
          waitConfig: {
            ...node.waitConfig,
            resumeAt: undefined,
            armedAt: undefined,
            resolvedAt: undefined,
            holdId: undefined,
            occurrenceId: undefined
          }
        } : {}),
        ...(runtime.holdConfig ? {
          holdConfig: {
            ...runtime.holdConfig,
            availableAt: undefined,
            armedAt: undefined,
            resolvedAt: undefined,
            holdId: undefined,
            occurrenceId: undefined,
            resolution: undefined,
            resolvedBy: undefined,
            signalId: undefined
          }
        } : {}),
        ...(node.eventTriggerConfig ? {
          eventTriggerConfig: {
            ...node.eventTriggerConfig,
            lastEventId: undefined,
            triggeredAt: undefined,
            occurrenceId: undefined
          }
        } : {}),
        ...(node.asks ? {
          asks: node.asks.map(ask => ask.status === 'open' ? { ...ask, status: 'cancelled' as const } : ask)
        } : {})
      } as RuntimeMilestone;
    })
  };
};
