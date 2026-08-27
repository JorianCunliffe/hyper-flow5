import type { Milestone, Project } from '../types.js';

/**
 * Applies the configuration currently shown in the node modal to the snapshot
 * that will be executed. Run Now must not save that configuration separately:
 * doing so creates a second project revision while the asynchronous run still
 * holds the older snapshot.
 */
export const prepareProjectNodeForRun = (
  project: Project,
  nodeId: string,
  updates: Partial<Milestone>
): Project => ({
  ...project,
  milestones: project.milestones.map(milestone =>
    milestone.id === nodeId ? { ...milestone, ...updates } : milestone
  )
});
