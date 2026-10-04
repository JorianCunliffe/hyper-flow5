import React, { useEffect, useRef, useState } from 'react';
import { X, Sparkles, Loader2 } from 'lucide-react';
import { firebaseService } from '../services/firebaseService';
import type { SetupScope, SetupSession } from '../lib/setupAssistant/types';

type Transport = (url: string, init?: RequestInit) => Promise<any>;
const request: Transport = async (url, init) => {
  const response = await firebaseService.authorizedFetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...init?.headers } });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || 'Setup request failed');
  return body;
};
const endpoint = '/api/setup-assistant/sessions';
const token = () => `setup_ui_${crypto.randomUUID().replace(/-/g, '')}`;

export default function SetupAssistantPanel({ scope, onClose, onApplied, onOpenIntegrations, transport = request }: {
  scope: SetupScope; onClose: () => void; onApplied: (projectId: string, nodeIds: string[]) => void; onOpenIntegrations?: () => void; transport?: Transport;
}) {
  const [session, setSession] = useState<SetupSession>();
  const [sessions, setSessions] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reviewed, setReviewed] = useState('');
  const [resources, setResources] = useState<any[]>([]);
  const [calendarConnections, setCalendarConnections] = useState<any[]>([]);
  const [approved, setApproved] = useState(false);
  const [reviewKind, setReviewKind] = useState<'live' | 'activation'>('live');
  const panel = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    const previous = document.activeElement as HTMLElement;
    panel.current?.focus();
    const controller = new AbortController();
    setBusy(true);
    transport(endpoint, { signal: controller.signal }).then(body => {
      if (mounted.current) setSessions(body.items.filter((s: any) => scope.kind === 'new' ? s.scope.kind === 'new' : s.scope.projectId === scope.projectId && (scope.kind !== 'element' || s.scope.nodeId === scope.nodeId)));
    }).catch(e => { if (mounted.current && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; controller.abort(); previous?.focus(); };
  }, [scope.kind, scope.projectId, scope.nodeId, transport]);
  useEffect(() => {
    if (!session?.question?.resourceKind) { setResources([]); return; }
    const controller = new AbortController();
    const kind = session.question.resourceKind;
    const url = kind === 'diaries' ? '/api/calendar' : kind === 'resources' ? `/api/workspace/resources?projectId=${encodeURIComponent(session.scope.projectId)}` : kind === 'schedules' ? '/api/schedules' : '/api/integrations';
    transport(url, { signal: controller.signal }).then(body => {
      if (!mounted.current || controller.signal.aborted) return;
      if (kind === 'calendars') { setCalendarConnections(body.workspaces || []); setResources([]); }
      else setResources((body[kind] || (kind === 'diaries' ? (body.items || []).map((r: any) => ({ id: r.id, calendarId: r.calendarId, connectionId: r.connectionId, name: r.calendarId })) : body.data) || []).filter((r: any) => kind !== 'schedules' || r.projectId === session.scope.projectId));
    }).catch(e => { if (mounted.current && e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [session?.question?.resourceKind, session?.scope.projectId, transport]);
  const run = async (operation: string, extra: any = {}) => {
    if (!session || busy) return;
    setBusy(true); setError(''); setApproved(false);
    try {
      const body = await transport(endpoint, { method: 'POST', body: JSON.stringify({ id: session.id, operation, requestId: token(), expectedSessionRevision: session.revision, ...extra }) });
      if (!mounted.current) return;
      setSession(body.session);
      if (operation === 'prepare') setReviewed(body.session.proposal?.reviewHash || '');
      if (operation === 'review_live') setReviewKind('live');
      if (operation === 'review_activation') setReviewKind('activation');
      if (operation === 'turn' || operation === 'expand_scope') setReviewed('');
      if (operation === 'apply') onApplied(body.session.scope.projectId, body.session.proposal.changes.filter((c: any) => c.resource === 'node').map((c: any) => c.id || c.value?.id));
    } catch (e: any) {
      if (!mounted.current) return;
      setError(e.message);
      // Recover the saved conversation/operation receipts after an uncertain response.
      try { const body = await transport(`${endpoint}?id=${encodeURIComponent(session.id)}`); if (mounted.current) setSession(body.session); } catch { /* Keep the original error. */ }
    } finally { if (mounted.current) setBusy(false); }
  };
  const open = async (id?: string) => {
    setBusy(true); setError(''); setReviewed(''); setApproved(false);
    try {
      const body = id ? await transport(`${endpoint}?id=${encodeURIComponent(id)}`) : await transport(endpoint, { method: 'POST', body: JSON.stringify({ scope }) });
      if (mounted.current) setSession(body.session);
    } catch (e: any) { if (mounted.current) setError(e.message); }
    finally { if (mounted.current) setBusy(false); }
  };
  const send = (text = message) => { if (text.trim()) { setMessage(''); void run('turn', { message: text }); } };
  const proposal = session?.proposal;
  const review = reviewKind === 'live' ? (session?.liveReview && !session.liveReview.dispatch ? session.liveReview : undefined) : (session?.activationReview?.status !== 'active' ? session?.activationReview : undefined);
  const isLiveReview = review && review === session?.liveReview;
  const label = session?.scope.kind || scope.kind;
  return <><div aria-hidden="true" className="fixed inset-0 z-[149] bg-slate-900/10" onClick={onClose} /><aside ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-label="AI workflow setup" className="fixed inset-y-0 right-0 z-[150] w-full sm:max-w-xl bg-white shadow-2xl border-l border-slate-200 flex flex-col" onKeyDown={e => {
    if (e.key === 'Escape' && !busy) onClose();
    if (e.key === 'Tab') {
      const items: HTMLElement[] = Array.from(panel.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary,[tabindex="0"]') || []);
      if (e.shiftKey && (document.activeElement === items[0] || document.activeElement === panel.current)) { e.preventDefault(); items.at(-1)?.focus(); }
      else if (!e.shiftKey && document.activeElement === items.at(-1)) { e.preventDefault(); items[0]?.focus(); }
    }
  }}>
    <header className="p-5 border-b flex items-center justify-between">
      <div><h2 className="font-bold text-lg flex gap-2 items-center"><Sparkles size={20} /> Workflow setup</h2><p className="text-sm text-slate-500">{label === 'new' ? 'New workflow' : `${label === 'element' ? 'Element' : 'Workflow'}: ${session?.scope.projectId || scope.projectId}${label === 'element' ? ` / ${session?.scope.nodeId || scope.nodeId}` : ''}`}</p></div>
      <button aria-label="Close setup assistant" onClick={onClose} className="p-2"><X /></button>
    </header>
    <div className="flex-1 overflow-y-auto p-5 space-y-4">
      {onOpenIntegrations && <button className="text-sm underline text-indigo-700" disabled={busy} onClick={onOpenIntegrations}>Manage connections in Settings</button>}
      {!session && <><p>Describe what you want to accomplish. I’ll prepare changes for you to review before saving.</p><button disabled={busy} onClick={() => void open()} className="rounded-lg bg-indigo-600 text-white px-4 py-2">Start setup</button>
        {sessions.length > 0 && <section><h3 className="font-semibold mt-4">Resume a setup</h3>{sessions.map(s => <button className="block p-2 text-indigo-700 underline" key={s.id} disabled={busy} onClick={() => void open(s.id)}>{s.scope.nodeId || s.scope.projectId} — {new Date(s.updatedAt).toLocaleString()}</button>)}</section>}</>}
      <div aria-live="polite" className="space-y-3">{session?.messages.map((m, i) => <p key={i} className={`whitespace-pre-wrap rounded-xl p-3 text-sm ${m.role === 'user' ? 'bg-indigo-50' : 'bg-slate-50'}`}><strong>{m.role === 'user' ? 'You' : 'Assistant'}: </strong>{m.text}</p>)}</div>
      {session?.question && <section className="border rounded-xl p-3"><h3 className="font-semibold">{session.question.text}</h3><div className="flex flex-wrap gap-2 mt-2">{session.question.options?.map(o => <button key={o} disabled={busy} className="border rounded-lg p-2 text-sm" onClick={() => send(o)}>{o}</button>)}</div>
        {session.question.resourceKind === 'calendars' && <label className="block mt-2 text-sm">Workspace connection<select aria-label="Calendar connection" className="w-full border rounded p-2" defaultValue="" disabled={busy} onChange={e => {
          const connectionId = e.target.value;
          void transport(`/api/calendar?operation=calendars&connectionId=${encodeURIComponent(connectionId)}`).then(body => { if (mounted.current) setResources((body.calendars || []).map((r: any) => ({ id: r.id, name: r.summary, connectionId }))); }).catch(e => { if (mounted.current) setError(e.message); });
        }}><option value="">Select…</option>{calendarConnections.map(r => <option key={r.id || r.connectionId} value={r.id || r.connectionId}>{r.accountEmail || r.name || r.id}</option>)}</select></label>}
        {session.question.resourceKind && <label className="block mt-2 text-sm">Choose an existing resource<select aria-label="Existing resource" className="w-full border rounded p-2" value="" disabled={busy} onChange={e => send(`Use this resource: ${e.target.value}`)}><option value="">Select…</option>{resources.map((r, i) => { const id = r.personId || r.connectionId || r.id || r.name; const ref = { id, name: r.name || r.displayName || r.summary, connectionId: r.connectionId, calendarId: r.calendarId, mailboxAddress: r.mailboxAddress, phone: r.phone, email: r.email, documentId: r.documentId, spreadsheetId: r.spreadsheetId, range: r.range }; return <option key={`${id}-${i}`} value={JSON.stringify(ref)}>{r.name || r.displayName || r.email || r.mailboxAddress || r.accountEmail || id}</option>; })}</select></label>}
      </section>}
      {session?.scope.kind === 'element' && <button disabled={busy} className="text-sm underline text-indigo-700" onClick={() => void run('expand_scope', { projectId: session.scope.projectId })}>Expand to configure this whole workflow</button>}
      {proposal && <section className="border rounded-xl p-4 space-y-3"><h3 className="font-bold">Proposed configuration</h3>
        <p className="text-sm">Configuration: {proposal.valid ? 'valid' : 'needs correction'} · Prerequisites: {proposal.preflight?.ready ? 'ready' : 'needs attention'} · Provider availability: not checked</p>
        <ol className="space-y-2 text-sm">{proposal.preview?.milestones?.map((n: any) => <li key={n.id} className="rounded bg-slate-50 p-2"><strong>{n.name}</strong> ({n.nodeType || 'task'})<p>After: {(n.dependsOn || []).join(', ') || 'Start'}</p><p>Output: {n.actionConfig?.resultVariable || '—'}</p><details><summary>Prompts and configuration</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ action: n.actionConfig, hold: n.holdConfig, decision: n.decisionConfig, inputs: n.readyConditions }, null, 2)}</pre></details></li>)}</ol>
        {proposal.preflight?.bindingIssues?.map((issue: string) => <p className="text-sm text-amber-800" key={issue}>{issue}</p>)}
        <details><summary>Before and after · resources · schedules</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify({ before: proposal.before, after: proposal.preview, resources: proposal.extras.resources, schedules: proposal.extras.schedules, schedulesToPause: proposal.pauseSchedules, outstanding: proposal.preflight }, null, 2)}</pre></details>
        <div className="flex flex-wrap gap-2"><button disabled={busy || proposal.applied} className="border rounded px-3 py-2" onClick={() => { if (Object.keys(proposal.operations).length) setReviewed(proposal.reviewHash); else void run('prepare'); }}>Review changes</button><button disabled={busy || !proposal.valid || proposal.applied || reviewed !== proposal.reviewHash} className="bg-indigo-600 text-white rounded px-3 py-2 disabled:opacity-40" onClick={() => void run('apply', { reviewHash: proposal.reviewHash })}>Apply configuration</button><button disabled={busy || !proposal.valid} className="border rounded px-3 py-2" onClick={() => void run('simulate')}>Run simulation</button></div>
        {proposal.applied && <p className="text-sm text-green-700">Configuration saved. Activation is a separate action.</p>}
        {Object.keys(proposal.operations).length > 0 && <details><summary>Saved operation receipts</summary><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(proposal.operations, null, 2)}</pre></details>}
      </section>}
      {session?.simulation && <section className="border rounded p-3 text-sm"><h3 className="font-semibold">Simulation: {session.simulation.item?.result?.status}</h3><p>Provider calls: {session.simulation.item?.result?.providerCalls}. This does not verify live availability.</p><details><summary>Assertions and results</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(session.simulation.item?.result, null, 2)}</pre></details></section>}
      {proposal?.applied && <div className="flex flex-wrap gap-2"><button disabled={busy} className="border rounded px-3 py-2" onClick={() => void run('review_live')}>Review live test</button><button disabled={busy} className="border rounded px-3 py-2" onClick={() => void run('review_activation')}>Review activation</button><button disabled={busy} className="border rounded px-3 py-2" onClick={() => void run('inspect')}>Inspect test status</button></div>}
      {review && <section className="rounded-xl border-2 border-amber-400 p-3 space-y-3"><h3 className="font-bold">{isLiveReview ? 'Live test review' : 'Activation review'}</h3><p className="text-sm">These actions can cause real calls, messages or bookings. Review the recipients, inputs, permissions and schedule below.</p><pre className="text-xs whitespace-pre-wrap break-all">{JSON.stringify(review, null, 2)}</pre><label className="flex gap-2 text-sm"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve these exact effects and recipients.</label><button disabled={busy || !approved} className="bg-amber-600 text-white rounded px-3 py-2 disabled:opacity-40" onClick={() => void run(isLiveReview ? 'approve_live' : 'approve_activation', { reviewHash: review.hash })}>{isLiveReview ? 'Run approved live test' : 'Activate approved schedules'}</button></section>}
      {session?.liveReview?.dispatch && <p className="text-sm">Live test: {session.liveReview.completion}. Inspect the owning run to verify completion.</p>}
      {session?.activationReview?.status === 'active' && <p className="text-green-700">Approved schedules are active.</p>}
      {(error || session?.error) && <p role="alert" className="rounded bg-red-50 text-red-700 p-3 text-sm">{error || session?.error}</p>}
      {busy && <p role="status" className="flex gap-2 items-center text-sm"><Loader2 size={16} className="animate-spin" />Checking setup…</p>}
    </div>
    {session && <form className="p-4 border-t flex gap-2" onSubmit={e => { e.preventDefault(); send(); }}><label className="sr-only" htmlFor="setup-message">Message to setup assistant</label><textarea id="setup-message" rows={2} maxLength={8000} value={message} onChange={e => setMessage(e.target.value)} placeholder="Describe a change or answer the question…" className="flex-1 border rounded-lg p-2 text-sm" disabled={busy} /><button className="bg-indigo-600 text-white rounded-lg px-4 disabled:opacity-40" disabled={busy || !message.trim()}>Send</button></form>}
  </aside></>;
}
