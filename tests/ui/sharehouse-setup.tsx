import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { NodeConfigModal } from '../../components/modals/NodeConfigModal';
import { WorkspaceResourcesEditor } from '../../components/WorkspaceResourcesEditor';
import { firebaseService } from '../../services/firebaseService';
import { fullWorkflow, setup, knownGaps } from '../fixtures/sharehouse/fullWorkflow';
const key = 'sharehouse-isolated-setup-v1';
const saved = JSON.parse(localStorage.getItem(key) || 'null');
const state = saved || { project: fullWorkflow(), resources: [], grant: {}, calls: [] };
const persist = () => localStorage.setItem(key, JSON.stringify(state));
firebaseService.authorizedFetch = async (url, init) => {
  const path = String(url), method = init?.method || 'GET';
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  state.calls.push({ path, method });
  if (path.includes('scope=workspace_resources')) {
    if (method === 'PATCH') state.resources = body.resources;
    persist(); return Response.json({ resources: state.resources });
  }
  if (path.includes('/integrations/google/grant')) {
    if (method === 'PUT') state.grant = body;
    persist(); return Response.json({ grant: state.grant });
  }
  throw new Error(`Unexpected API call blocked by fixture: ${method} ${path}`);
};
const connection = { id: 'google-fixture', provider: 'google' as const, accountEmail: 'operator@example.invalid', state: 'connected' as const, updatedAt: 0 };
function Fixture() {
  const [project, setProject] = useState(state.project);
  const [selected, setSelected] = useState('morning_answers');
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState('');
  const node = project.milestones.find((n: any) => n.id === selected);
  return <main>
    <h1>Sharehouse full-workflow setup — isolated fixture</h1>
    <p>18-node candidate graph. Mock APIs only. No provider dispatch or scheduler is available.</p>
    <p><strong>Acceptance: BLOCKED</strong> — graph persistence and editor round trips are supporting checks.</p>
    <button onClick={() => { localStorage.removeItem(key); location.reload(); }}>Reset isolated fixture</button>
    <button onClick={() => {
      const next = fullWorkflow();
      const human = next.milestones.find((n: any) => n.id === 'incident_answers').holdConfig.human;
      human.kind = 'question';
      human.fields[0].options = ['At the property', 'On the way'];
      human.fields.push({ name: 'arrival_minutes', label: 'Minutes until arrival', type: 'number', required: true });
      human.responsePolicy = 'quorum'; human.quorum = 2;
      human.assignees = ['team-primary', 'team-fallback'];
      human.escalation = undefined;
      human.channels = ['web', 'sms'];
      state.project = next; persist(); setProject(next); setSelected('incident_answers'); setEditing(false); setMessage('Preservation regression loaded.');
    }}>Load preservation regression</button>
    <section><h2>Graph editor round trip</h2>
      <label>Workflow node <select aria-label="Workflow node" value={selected} onChange={e => { setSelected(e.target.value); setMessage(''); }}>{project.milestones.map((n: any) => <option key={n.id} value={n.id}>{n.name}</option>)}</select></label>
      <button onClick={() => setEditing(true)}>Edit selected node</button>
      <p role="status">{message}</p>
      <pre aria-label="Saved selected node">{JSON.stringify(node, null, 2)}</pre>
    </section>
    <WorkspaceResourcesEditor projects={[project]} connections={[connection]} />
    <section><h2>Required setup</h2><p>Spreadsheet fixture ID: {setup.spreadsheet}</p><pre>{JSON.stringify(setup, null, 2)}</pre><h2>Remaining gaps</h2><ul>{knownGaps.map(gap => <li key={gap}>{gap}</li>)}</ul></section>
    {editing && <NodeConfigModal milestone={node} milestones={project.milestones} onSave={updates => {
      const next = { ...project, milestones: project.milestones.map((n: any) => n.id === selected ? { ...n, ...updates } : n) };
      state.project = next; persist(); setProject(next); setMessage('Node saved locally; reload to verify persistence.');
    }} onRun={() => { throw new Error('Provider execution disabled in isolated fixture'); }} isRunning={false} onClose={() => setEditing(false)} />}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
