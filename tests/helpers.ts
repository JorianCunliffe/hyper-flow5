import { Milestone, NodeType, Project, Subtask } from '../types';

let seq = 0;
export const resetSeq = () => { seq = 0; };

export const subtask = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: `s-${++seq}`,
  name: `Task ${seq}`,
  assignedTo: '',
  description: '',
  status: 'Not started',
  ...overrides
});

export const node = (id: string, overrides: Partial<Milestone> = {}): Milestone => ({
  id,
  name: id,
  subtasks: [],
  dependsOn: [],
  estimatedDuration: 1,
  ...overrides
});

/** A milestone node that reports as complete (has subtasks, all complete). */
export const doneMilestone = (id: string, overrides: Partial<Milestone> = {}): Milestone =>
  node(id, { subtasks: [subtask({ status: 'Completed' })], ...overrides });

/** A milestone node that is not complete. */
export const openMilestone = (id: string, overrides: Partial<Milestone> = {}): Milestone =>
  node(id, { subtasks: [subtask({ status: 'Not started' })], ...overrides });

export const decision = (
  id: string,
  branches: { targetId: string; label: string; conditions?: any[] }[],
  overrides: Partial<Milestone> = {}
): Milestone =>
  node(id, {
    nodeType: NodeType.DECISION,
    decisionConfig: { branches },
    ...overrides
  });

export const loop = (
  id: string,
  cfg: Partial<Milestone['loopConfig']> = {},
  overrides: Partial<Milestone> = {}
): Milestone =>
  node(id, {
    nodeType: NodeType.LOOP,
    loopConfig: {
      loopStartId: undefined,
      exitConditions: [],
      maxIterations: 3,
      currentIteration: 0,
      ...cfg
    } as any,
    ...overrides
  });

export const action = (
  id: string,
  type: NodeType = NodeType.EMAIL,
  overrides: Partial<Milestone> = {}
): Milestone =>
  node(id, {
    nodeType: type,
    actionConfig: { template: '' },
    ...overrides
  });

export const project = (milestones: Milestone[], projectData: Record<string, any> = {}): Project => ({
  id: 'p1',
  name: 'Test Project',
  company: 'Acme',
  type: 'Other',
  startDate: 0,
  milestones,
  createdAt: 0,
  updatedAt: 0,
  projectData
});
