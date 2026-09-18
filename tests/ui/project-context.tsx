// Real application shell with local sample data and no live provider requests.
import React from 'react';
import { createRoot } from 'react-dom/client';
localStorage.setItem('hyperflow_manual_disconnect', 'true');
const fixtureSettings = { people: ['Reviewer'] };
const projects = ['alpha', 'beta'].map(id => ({
  id, name: id === 'alpha' ? 'Alpha reporting' : 'Beta delivery', company: 'Acceptance',
  type: 'Standard', startDate: Date.now(), updatedAt: Date.now(), timeUnit: 'days',
  timeBuffer: 0, milestones: [{ id: `m-${id}`, name: `${id} milestone`, dependsOn: [],
    subtasks: [{ id: `t-${id}`, name: `${id} review task`, status: 'Submitted', dueDate: Date.now(), accountable: 'Reviewer', assignedTo: 'Reviewer' }] }]
}));
localStorage.setItem('hyperflow_data_v1', JSON.stringify({ projects, settings: fixtureSettings, scratchTasks: [], activityLogs: [] }));
const { firebaseService } = await import('../../services/firebaseService');
const requests: string[] = [];
Object.assign(window, { contextRequests: requests });
firebaseService.authorizedFetch = async (input, options = {}) => {
  if (options.method && options.method !== 'GET') throw new Error('Read-only acceptance fixture');
  const url = new URL(String(input), location.origin);
  requests.push(url.pathname + url.search);
  const projectId = url.searchParams.get('projectId');
  if (url.pathname === '/api/calendar') return new Response(JSON.stringify({ error: 'Calendar is not connected in this acceptance fixture.' }), { status: 503 });
  if (url.pathname === '/api/cockpit') return new Response(JSON.stringify({
    owner: 'hyperflow', asOf: new Date().toISOString(), viewerUid: 'fixture', timezone: 'Australia/Brisbane',
    items: [], contacts: [], flows: [], incomplete: false, notices: [], projects,
    configuration: { primaryPersonId: '', receptionistEnabled: false, receptionistProjectId: '',
      contactWindow: { startHour: 9, endHour: 17, maxPerDay: 20, maxPerContact: 2 } }
  }));
  if (url.pathname === '/api/commitments') return new Response(JSON.stringify({data: [], viewerUid: 'fixture', next: null, projectId}));
  return new Response(JSON.stringify({ data: [], digests: [], agentJobs: [], coachingSessions: [], externalActions: [], schedules: [] }));
};
const { App } = await import('../../App');
createRoot(document.getElementById('root')!).render(<App />);
