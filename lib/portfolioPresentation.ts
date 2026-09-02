import type { Project, Subtask } from '../types.js';
import { isTaskComplete } from './taskStatus.js';

export type PortfolioHealth = 'at_risk' | 'attention' | 'on_track' | 'complete';

export interface PortfolioSummary {
  projects: number;
  tasks: number;
  completed: number;
  overdue: number;
  dueToday: number;
  unassigned: number;
}

const dayBounds = (now: number) => {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { start: start.getTime(), end: end.getTime() };
};

export const isTaskDueToday = (task: Subtask, now = Date.now()): boolean => {
  if (isTaskComplete(task)) return false;
  if (task.isToday) return true;
  if (!task.dueDate) return false;
  const { start, end } = dayBounds(now);
  return task.dueDate >= start && task.dueDate < end;
};

export const isTaskOverdue = (task: Subtask, now = Date.now()): boolean => {
  if (isTaskComplete(task) || !task.dueDate) return false;
  return task.dueDate < dayBounds(now).start;
};

const attentionRank = (task: Subtask, now: number): number => {
  if (isTaskOverdue(task, now)) return 0;
  if (isTaskDueToday(task, now)) return 1;
  if (task.isImportant) return 2;
  if (task.status === 'Started') return 3;
  if (!task.assignedTo) return 4;
  return 5;
};

export const pickNextTask = (tasks: Subtask[], now = Date.now()): Subtask | undefined => tasks
  .filter(task => !isTaskComplete(task))
  .map((task, index) => ({ task, index, rank: attentionRank(task, now) }))
  .sort((a, b) => a.rank - b.rank || (a.task.dueDate || Number.MAX_SAFE_INTEGER) - (b.task.dueDate || Number.MAX_SAFE_INTEGER) || a.index - b.index)[0]?.task;

export const portfolioSummary = (projects: Project[], now = Date.now()): PortfolioSummary => {
  const tasks = projects.flatMap(project => project.milestones.flatMap(milestone => milestone.subtasks || []));
  return {
    projects: projects.length,
    tasks: tasks.length,
    completed: tasks.filter(isTaskComplete).length,
    overdue: tasks.filter(task => isTaskOverdue(task, now)).length,
    dueToday: tasks.filter(task => isTaskDueToday(task, now)).length,
    unassigned: tasks.filter(task => !isTaskComplete(task) && !task.assignedTo).length
  };
};

export const projectHealth = (project: Project, now = Date.now()): { kind: PortfolioHealth; label: string; count: number } => {
  const tasks = project.milestones.flatMap(milestone => milestone.subtasks || []);
  const incomplete = tasks.filter(task => !isTaskComplete(task));
  const overdue = incomplete.filter(task => isTaskOverdue(task, now)).length;
  if (overdue) return { kind: 'at_risk', label: `${overdue} overdue`, count: overdue };
  const attention = incomplete.filter(task => isTaskDueToday(task, now) || task.isImportant || !task.assignedTo).length;
  if (attention) return { kind: 'attention', label: `${attention} need attention`, count: attention };
  if (tasks.length > 0 && incomplete.length === 0) return { kind: 'complete', label: 'Complete', count: 0 };
  return { kind: 'on_track', label: 'On track', count: 0 };
};
