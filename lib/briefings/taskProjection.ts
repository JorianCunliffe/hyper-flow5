import type { Project } from '../../types.js';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

/** A pinned run may project runtime fields, but cannot erase a later confirmed task edit. */
export function preserveBriefingTaskEdits(current: Project, incoming: Project, includeNewStructure = true): Project {
  const runId = String(incoming.projectData?.flow_run_id || '');
  if (!runId || current.projectData?.flow_run_id !== runId) return incoming;
  const next = clone(incoming);
  for (const sourceNode of current.milestones || []) {
    for (const sourceTask of sourceNode.subtasks || []) {
      const edit = sourceTask.briefingEdit;
      if (!edit || edit.flowRunId !== runId) continue;
      const node = next.milestones.find(n => n.id === sourceNode.id);
      if (!node) {
        if (includeNewStructure) next.milestones.push(clone(sourceNode));
        continue;
      }
      const task = node.subtasks.find(t => t.id === sourceTask.id);
      if (!task) {
        if (includeNewStructure) node.subtasks.push(clone(sourceTask));
        continue;
      }
      if (task.briefingEdit?.id === edit.id || (task.briefingEdit?.at || 0) > edit.at) continue;
      if (edit.status !== undefined) {
        task.status = edit.status;
        if (edit.completedAt != null) task.completedAt = edit.completedAt;
        else delete task.completedAt;
      }
      if (edit.approvalStatus !== undefined) task.approvalStatus = edit.approvalStatus;
      for (const comment of sourceTask.commentHistory || []) {
        if (!task.commentHistory?.some(c => c.timestamp === comment.timestamp && c.text === comment.text)) {
          task.commentHistory = [...(task.commentHistory || []), clone(comment)];
        }
      }
      task.briefingEdit = clone(edit);
    }
  }
  return next;
}
