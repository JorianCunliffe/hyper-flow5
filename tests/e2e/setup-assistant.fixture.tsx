/** Browser-only fixture: real UI, isolated transport, no model/provider calls or production writes. */
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import SetupAssistantPanel from '../../components/SetupAssistantPanel';
import { CreateProjectModal } from '../../components/modals/CreateProjectModal';
import { NodeConfigModal } from '../../components/modals/NodeConfigModal';
import type { SetupSession } from '../../lib/setupAssistant/types';
let saved: SetupSession | undefined;
const transport = async (_url: string, init?: RequestInit) => {
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  if (!init?.method) return _url.includes('?id=') ? { session: saved } : { items: saved ? [saved] : [] };
  if (!body.id) saved = { id: 'fixture_session', orgId: 'fixture', actor: 'fixture', scope: body.scope.kind === 'new' ? { kind: 'new', projectId: 'fixture_workflow' } : body.scope, revision: 0, createdAt: Date.now(), updatedAt: Date.now(), messages: [{ role: 'assistant', text: 'What should this workflow accomplish?' }], requests: {} };
  else {
    saved = structuredClone(saved!); saved.revision++;
    if (body.operation === 'turn') {
      saved.messages.push({ role: 'user', text: body.message }, { role: 'assistant', text: 'I prepared a room enquiry workflow with a call that asks one question at a time. Review the changes before saving.' });
      saved.proposal = { id: 'fixture_proposal', expectedRevision: 0, changes: [{ resource: 'project', operation: 'create', value: { id: 'fixture_workflow', name: 'Sharehouse setup fixture' } }], extras: { schedules: [{ name: 'Morning run', enabled: false, timezone: 'Australia/Brisbane', recurrence: { kind: 'daily', localTime: '09:00' } }] }, planHash: 'fixture_plan', reviewHash: 'fixture_review', valid: true, diff: [], effects: [], preflight: { ready: true, checks: [] }, before: null, pauseSchedules: [], preview: { name: 'Sharehouse setup fixture', milestones: [{ id: 'call', name: 'Confirm inspection availability', nodeType: 'phone_call', dependsOn: [], actionConfig: { resultVariable: 'availability', template: '{"to":"JORIAN TEST CONTACT","prompt":"Ask one question at a time. Inspections take 15 minutes; allow 5 minutes travel. Prefer Martyn Street at 4 pm Brisbane time."}' } }] }, operations: {}, fixtures: {}, assertions: [] };
      if (saved.scope.kind === 'element') { saved.proposal.changes = [{ resource: 'node', operation: 'update', projectId: saved.scope.projectId, id: saved.scope.nodeId, value: { actionConfig: saved.proposal.preview.milestones[0].actionConfig } }]; saved.proposal.before = { milestones: [{ id: 'call', actionConfig: { template: '{"prompt":"Old prompt"}' } }] }; saved.proposal.extras = {}; }
    }
    if (body.operation === 'apply') { saved.proposal!.applied = true; saved.messages.push({ role: 'assistant', text: 'Fixture configuration saved. No production changes were made.' }); }
    if (body.operation === 'simulate') saved.simulation = { item: { result: { status: 'passed', providerCalls: 0, assertions: [{ passed: true }] } } };
    if (body.operation === 'review_live') saved.liveReview = { hash: 'fixture_live', revision: 1, effects: [{ type: 'phone_call', recipient: 'JORIAN TEST CONTACT', note: 'Fixture only; no call will be placed.' }] };
    if (body.operation === 'review_activation') saved.activationReview = { hash: 'fixture_activation', schedules: saved.proposal!.extras.schedules, effects: [{ note: 'Fixture only; no schedules will be enabled.' }] };
  }
  return { session: structuredClone(saved) };
};
function Fixture() {
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<any>({ kind: 'new', projectId: '' });
  const [creation, setCreation] = useState(false);
  const [element, setElement] = useState(false);
  const fixtureNode: any = { id: 'call', name: 'Confirm inspection availability', nodeType: 'phone_call', status: 'pending', subtasks: [], dependsOn: [], actionConfig: { template: '{"prompt":"Old prompt"}' } };
  return <><main className="p-8 max-w-lg"><h1 className="text-2xl font-bold">Workflow setup browser fixture</h1><p className="mt-4">This uses the real setup panel with an isolated test transport. No model calls, provider effects or production writes.</p><button className="mt-4 border rounded p-2" onClick={() => setOpen(true)}>Open setup assistant</button><button className="ml-2 border rounded p-2" onClick={() => setCreation(true)}>New workflow</button><button className="mt-2 border rounded p-2" onClick={() => { setScope({ kind: 'workflow', projectId: 'fixture_workflow' }); setOpen(true); }}>Configure with AI</button><button className="ml-2 border rounded p-2" onClick={() => setElement(true)}>Edit call element</button></main>
    <CreateProjectModal isOpen={creation} onClose={() => setCreation(false)} settings={{ people: [], companies: [], projectTypes: [] } as any} isGenerating={false} onCreate={() => {}} archivedProjects={[]} activeProjects={[]} onReinstate={() => {}} onSetupAssistant={() => { setCreation(false); setScope({ kind: 'new', projectId: '' }); setOpen(true); }} />
    {element && <NodeConfigModal milestone={fixtureNode} milestones={[fixtureNode]} onClose={() => setElement(false)} onSave={() => {}} onRun={() => {}} isRunning={false} onSetupAssistant={() => { setElement(false); setScope({ kind: 'element', projectId: 'fixture_workflow', nodeId: 'call' }); setOpen(true); }} />}
    {open && <div key={`${scope.kind}:${scope.nodeId || ''}`}><SetupAssistantPanel scope={scope} transport={transport} onClose={() => setOpen(false)} onApplied={() => {}} /></div>}</>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
