import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { isTaskDueToday, isTaskOverdue, pickNextTask, portfolioSummary, projectHealth } from '../lib/portfolioPresentation';
import { displayTaskStatus, isTaskComplete } from '../lib/taskStatus';
import type { Project, Subtask } from '../types';

const now = new Date(2026, 8, 2, 12).getTime();
const task = (overrides: Partial<Subtask> = {}): Subtask => ({
  id: 'task', name: 'Task', assignedTo: 'Alex', description: '', status: 'Not started', ...overrides
});
const project = (tasks: Subtask[]): Project => ({
  id: 'project', name: 'Project', company: 'Company', type: 'Build', startDate: now,
  milestones: [{ id: 'milestone', name: 'Milestone', subtasks: tasks, dependsOn: [], estimatedDuration: 1 }],
  createdAt: now, updatedAt: now
});

describe('shared task status semantics', () => {
  test('accepts both canonical and legacy completion labels', () => {
    assert.equal(isTaskComplete('Completed'), true);
    assert.equal(isTaskComplete('Complete'), true);
    assert.equal(displayTaskStatus('Complete'), 'Completed');
  });
});

describe('portfolio presentation', () => {
  test('separates prior-day overdue work from work due today', () => {
    const yesterday = task({ dueDate: new Date(2026, 8, 1, 17).getTime() });
    const today = task({ dueDate: new Date(2026, 8, 2, 9).getTime() });
    assert.equal(isTaskOverdue(yesterday, now), true);
    assert.equal(isTaskDueToday(today, now), true);
    assert.equal(isTaskOverdue(today, now), false);
  });

  test('prioritizes overdue and due-today work over arbitrary task order', () => {
    const ordinary = task({ id: 'ordinary' });
    const dueToday = task({ id: 'today', dueDate: new Date(2026, 8, 2, 17).getTime() });
    const overdue = task({ id: 'overdue', dueDate: new Date(2026, 8, 1, 17).getTime() });
    assert.equal(pickNextTask([ordinary, dueToday, overdue], now)?.id, 'overdue');
  });

  test('summarizes portfolio attention without counting completed work', () => {
    const result = portfolioSummary([project([
      task({ id: 'done', status: 'Completed', assignedTo: '' }),
      task({ id: 'late', dueDate: new Date(2026, 8, 1).getTime() }),
      task({ id: 'unassigned', assignedTo: '' })
    ])], now);
    assert.deepEqual(result, { projects: 1, tasks: 3, completed: 1, overdue: 1, dueToday: 0, unassigned: 1 });
    assert.equal(projectHealth(project([task({ dueDate: new Date(2026, 8, 1).getTime() })]), now).kind, 'at_risk');
  });
});
