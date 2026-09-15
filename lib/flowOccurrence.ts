import type { Project } from '../types.js';

const activeOccurrence = (project: Project): string | undefined => {
  const generic = project.projectData?.flow_occurrence_id;
  if (typeof generic === 'string' && generic) return generic;
  const scheduled = project.projectData?.schedule_occurrence_id;
  return typeof scheduled === 'string' && scheduled ? scheduled : undefined;
};

/**
 * Resets mutable execution state for a new occurrence while retaining audit
 * history. Schedules and external events both use this exact primitive.
 */
export const resetProjectForOccurrence = (
  project: Project,
  occurrenceId: string,
  clearProjectDataKeys: string[] = []
): Project => {
  const currentOccurrence = activeOccurrence(project);
  if (currentOccurrence === occurrenceId) return project;

  const projectData = { ...(project.projectData || {}) };
  for (const key of clearProjectDataKeys) delete projectData[key];

  return {
    ...project,
    projectData,
    milestones: project.milestones.map(node => ({
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
    }))
  };
};
