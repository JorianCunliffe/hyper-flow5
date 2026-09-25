import { readFlowPath } from './flowData.js';
import { Project, Subtask, SubtaskStatus, ReadyCondition } from '../types.js';

/** Extracts variables from a template string (e.g. {{project_name}}). */
export const extractTemplateVariables = (template: string): string[] => {
  const matches = template.match(/\{\{([^}]+)\}\}/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map(m => m.replace(/[{}]/g, '').trim())));
};

/**
 * Generic scalar condition evaluator used by task readiness and flow Decisions.
 * Keep it intentionally small and deterministic so humans can reason about a
 * configured graph without hidden model behaviour.
 */
export const checkReadyCondition = (condition: ReadyCondition, projectData: Record<string, any>): boolean => {
  let value: unknown;
  try { value = readFlowPath(projectData, condition.variable); } catch { value = undefined; }

  if (condition.exists !== undefined) {
    const exists = value !== undefined && value !== null;
    return condition.exists ? exists : !exists;
  }

  if (Array.isArray(condition.oneOf)) {
    return condition.oneOf.some(candidate => value === candidate);
  }

  if (condition.notEquals !== undefined) {
    return value !== condition.notEquals;
  }

  if (condition.equals !== undefined) {
    return value === condition.equals;
  }

  return false;
};

export const evaluateTaskReadiness = (task: Subtask, project: Project): Subtask => {
  if (task.status === SubtaskStatus.STARTED ||
      task.status === 'In Progress' ||
      task.status === SubtaskStatus.SUBMITTED ||
      task.status === SubtaskStatus.COMPLETE ||
      task.status === 'Completed' ||
      task.status === SubtaskStatus.ABANDONED) {
    return task;
  }

  const projectData = project.projectData || {};
  const missingVariables: string[] = [];
  const failedConditions: ReadyCondition[] = [];

  if (task.templateFile) {
    const requiredVars = extractTemplateVariables(task.templateFile);
    for (const v of requiredVars) {
      let value: unknown;
      try { value = readFlowPath(projectData, v); } catch { value = undefined; }
      if (value === undefined || value === null) {
        missingVariables.push(v);
      }
    }
  }

  let allDependenciesMet = true;
  if (task.dependsOn && task.dependsOn.length > 0) {
    for (const depId of task.dependsOn) {
      let isDepComplete = false;
      for (const m of project.milestones) {
        const depTask = m.subtasks.find(t => t.id === depId);
        if (depTask && depTask.status === SubtaskStatus.COMPLETE) {
          isDepComplete = true;
          break;
        }
      }
      if (!isDepComplete) {
        allDependenciesMet = false;
        break;
      }
    }
  }

  if (task.readyConditions && task.readyConditions.length > 0) {
    for (const condition of task.readyConditions) {
      if (!checkReadyCondition(condition, projectData)) {
        failedConditions.push(condition);
      }
    }
  }

  const isReady = missingVariables.length === 0 && failedConditions.length === 0 && allDependenciesMet;

  return {
    ...task,
    status: isReady ? SubtaskStatus.READY : SubtaskStatus.NEEDS_PREPARATION,
    missingVariables,
    failedConditions
  };
};

export const runProjectReadinessCheck = (project: Project): Project => {
  const updatedMilestones = project.milestones.map(milestone => ({
    ...milestone,
    subtasks: milestone.subtasks.map(task => evaluateTaskReadiness(task, project))
  }));

  return {
    ...project,
    milestones: updatedMilestones
  };
};

export const applyTaskApprovalWriteBack = (task: Subtask, project: Project): Project => {
  if (!task.outputVariables || task.outputVariables.length === 0) {
    return project;
  }

  const updatedData = { ...project.projectData };

  task.outputVariables.forEach(v => {
    if (v.write_on === 'approval' || v.write_on === 'completion') {
      if (v.value_source === 'static') {
        updatedData[v.name] = v.value;
      } else if (v.value_source === 'system_date') {
        updatedData[v.name] = new Date().toISOString().split('T')[0];
      } else if (v.value_source === 'task_output') {
        if (task.taskOutput && task.taskOutput[v.name] !== undefined) {
          updatedData[v.name] = task.taskOutput[v.name];
        }
      }
    }
  });

  return {
    ...project,
    projectData: updatedData
  };
};
