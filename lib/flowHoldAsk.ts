import type { HumanAsk, Milestone, Project } from '../types.js';
import { createAsk } from './asks/createAsk.js';
import { getHoldConfig } from './flowEngine.js';

/** Creates the channel-independent ask owned by an explicit human WAIT node. */
export const createHumanHoldAsk = (project: Project, node: Milestone): HumanAsk => {
  const cfg = getHoldConfig(node);
  if (cfg?.kind !== 'human') throw new Error('Human hold ask requires a human WAIT node');
  const human = cfg.human || {};
  const firstAssignee = human.assignees?.[0];
  return createAsk({
    taskId: node.id,
    projectId: project.id,
    runId: typeof project.projectData?.flow_run_id === 'string' ? project.projectData.flow_run_id : undefined,
    personId: firstAssignee,
    question: human.prompt || `Response required to continue “${node.name}”.`,
    responseType: human.kind || 'question',
    fields: human.fields,
    assignees: human.assignees,
    channels: human.channels,
    responsePolicy: human.responsePolicy,
    quorum: human.quorum
  });
};
