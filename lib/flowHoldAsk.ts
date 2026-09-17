import type { HumanAsk, Milestone, Project } from '../types.js';
import { createAsk } from './asks/createAsk.js';
import { resolveAskFields } from './asks/askFieldSource.js';
import { getHoldConfig } from './flowEngine.js';
import { renderFlowText } from './flowData.js';

/** Creates the channel-independent ask owned by an explicit human WAIT node. */
export const createHumanHoldAsk = (project: Project, node: Milestone): HumanAsk => {
  const cfg = getHoldConfig(node);
  if (cfg?.kind !== 'human') throw new Error('Human hold ask requires a human WAIT node');
  const human = cfg.human || {};
  const assignees = human.escalation ? [human.escalation.primaryPersonId, human.escalation.fallbackPersonId] : human.assignees;
  const firstAssignee = assignees?.[0];
  const fields = resolveAskFields(project.projectData, human.fields, human.fieldsSource);
  return createAsk({
    taskId: node.id,
    projectId: project.id,
    runId: typeof project.projectData?.flow_run_id === 'string' ? project.projectData.flow_run_id : undefined,
    personId: firstAssignee,
    question: renderFlowText(human.prompt || `Response required to continue “${node.name}”.`, project.projectData || {}),
    responseType: human.kind || 'question',
    fields,
    assignees,
    channels: human.escalation ? ['web', 'voice', 'sms'] : human.channels,
    responsePolicy: human.responsePolicy,
    quorum: human.quorum
  });
};
