import { findProject } from './serverStore.js';
import { checkProjectHours } from './projectHours.js';

export async function checkProjectHoursTask(context: { orgId?: string; projectId?: string }, deps = { findProject, now: Date.now }) {
  if (!context.orgId || !context.projectId) throw Error('Project hours require trusted project and tenant correlation.');
  const located = await deps.findProject(context.orgId, context.projectId);
  if (!located) throw Error('Project not found.');
  return { ...checkProjectHours(located.project.operatingHours, deps.now()), hours_project_revision: located.project.revision || 0 };
}
