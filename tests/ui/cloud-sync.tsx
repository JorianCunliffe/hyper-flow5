// Synthetic cloud only: exercise the real App subscriber, save lifecycle and modal.
import React from 'react';
import { createRoot } from 'react-dom/client';
import { mergeCloudEdits } from '../../lib/cloudMerge';
history.replaceState(null, '', `${location.pathname}?view=projects`);
localStorage.setItem('hyperflow_manual_disconnect', 'true');
const { firebaseService } = await import('../../services/firebaseService');
const node = { id: 'n', name: 'Initial name', dependsOn: [], subtasks: [] };
const base = { projects: [{ id: 'fixture', displayId: 'P-1', name: 'Sync acceptance', company: 'Test', type: 'Standard',
  startDate: 1790300000000, updatedAt: 1, revision: 1, milestones: [node], markers: [], projectData: {} }],
  settings: { people: ['Reviewer'], nextProjectId: 2, nextTaskId: 1 }, scratchTasks: [], activityLogs: [] };
let remote: any = JSON.parse(sessionStorage.getItem('cloud-sync-fixture-remote') || 'null');
if (!remote) {
  remote = structuredClone(base);
  remote.projects[0].milestones[0].name = 'Cloud name';
  remote.projects[0].projectData = { server_result: 'Preserve this result' };
  remote.dataRevision = 2;
  const draft = structuredClone(base);
  draft.projects[0].milestones[0].name = 'Local name';
  localStorage.setItem('hyperflow_pending_v1:fixture-user:fixture-org', JSON.stringify({ version: 1, base, draft }));
}
let subscriber: any;
const evidence = () => { document.getElementById('cloud-evidence')!.textContent = `Cloud: ${remote.projects[0].milestones[0].name}; ${remote.projects[0].projectData.server_result}; revision ${remote.dataRevision}`; };
firebaseService.isConfigured = () => true;
firebaseService.getCurrentUser = () => ({ uid: 'fixture-user', email: 'reviewer@example.test' }) as any;
firebaseService.getCurrentOrgId = () => 'fixture-org';
firebaseService.subscribe = callback => { subscriber = callback; queueMicrotask(() => callback(structuredClone(remote))); return () => { subscriber = null; }; };
firebaseService.save = async (draft, _revision, ancestor) => {
  await new Promise(resolve => setTimeout(resolve, 150));
  const projected = { projects: remote.projects, settings: remote.settings, scratchTasks: remote.scratchTasks, activityLogs: remote.activityLogs };
  const merged = mergeCloudEdits(ancestor!, draft, projected);
  remote = { ...merged, dataRevision: remote.dataRevision + 1 };
  sessionStorage.setItem('cloud-sync-fixture-remote', JSON.stringify(remote));
  subscriber?.(structuredClone(remote)); // echo before the promise completes
  evidence();
  return structuredClone(remote);
};
firebaseService.authorizedFetch = async () => Response.json({ items: [], projects: [], obligations: [], asks: [], schedules: [], summary: {} });
const { App } = await import('../../App');
evidence();
createRoot(document.getElementById('root')!).render(<App />);
