import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { enterFocusMode } from './focusMode';
import './AssistantOverlay.css';
import { X, Sparkles, Loader2, ArrowUp } from 'lucide-react';
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
  const dialog = useRef<HTMLDialogElement>(null);
  const mounted = useRef(true);
  // Focus mode: a native modal dialog makes the app inert; ::backdrop blurs and dims it.
  useEffect(() => {
    const element = dialog.current;
    const previous = document.activeElement as HTMLElement | null;
    if (element && !element.open) element.showModal();
    const release = enterFocusMode();
    return () => { release(); if (element?.open) element.close(); previous?.focus?.(); };
  }, []);
  useEffect(() => {
    mounted.current = true;
    panel.current?.focus();
    const controller = new AbortController();
    setBusy(true);
    transport(endpoint, { signal: controller.signal }).then(body => {
      if (mounted.current) setSessions(body.items.filter((s: any) => scope.kind === 'new' ? s.scope.kind === 'new' : s.scope.projectId === scope.projectId && (scope.kind !== 'element' || s.scope.nodeId === scope.nodeId)));
    }).catch(e => { if (mounted.current && e.name !== 'AbortError') setError(e.message); }).finally(() => { if (mounted.current) setBusy(false); });
    return () => { mounted.current = false; controller.abort(); };
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
      if (operation === 'turn' || operation === 'expand_scope' || operation === 'expand_contact_policy') setReviewed('');
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
  const requestClose = () => { if (!busy) onClose(); };
  const json = (value: unknown) => <pre className="hf-code">{JSON.stringify(value, null, 2)}</pre>;
  return createPortal(<dialog ref={dialog} className="hf-assistant hf-assistant--side" aria-label="AI workflow setup"
    onCancel={e => { e.preventDefault(); requestClose(); }}
    onClick={e => { if (e.target === e.currentTarget) requestClose(); }}>
    <section ref={panel} tabIndex={-1} className="hf-assistant-panel hf-setup">
    <span className="hf-assistant-grabber" aria-hidden="true" />
    <header className="hf-assistant-head">
      <span className="hf-assistant-mark" aria-hidden="true"><Sparkles size={18} /></span>
      <div className="hf-assistant-title"><h2>Workflow setup</h2><p>{label === 'new' ? 'New workflow' : `${label === 'element' ? 'Element' : 'Workflow'}: ${session?.scope.projectId || scope.projectId}${label === 'element' ? ` / ${session?.scope.nodeId || scope.nodeId}` : ''}`}</p></div>
      <button type="button" aria-label="Close setup assistant" onClick={requestClose} disabled={busy}><X size={20} /></button>
    </header>
    <div className="hf-assistant-log hf-setup-body">
      {onOpenIntegrations && <button className="hf-link" disabled={busy} onClick={onOpenIntegrations}>Manage connections in Settings</button>}
      {!session && <div className="hf-assistant-empty"><p>Describe what you want to accomplish. I’ll prepare changes for you to review before saving.</p><button disabled={busy} onClick={() => void open()} className="hf-btn hf-btn-primary">Start setup</button>
        {sessions.length > 0 && <section className="hf-setup-resume"><h3 className="hf-setup-h3">Resume a setup</h3><div className="hf-list">{sessions.map(s => <button key={s.id} disabled={busy} onClick={() => void open(s.id)}><span>{s.scope.nodeId || s.scope.projectId}</span><small>{new Date(s.updatedAt).toLocaleString()}</small></button>)}</div></section>}</div>}
      <div aria-live="polite" className="hf-setup-messages">{session?.messages.map((m, i) => <p key={i} className={m.role === 'user' ? 'hf-assistant-q' : 'hf-assistant-a'}><span className="hf-sr-only">{m.role === 'user' ? 'You' : 'Assistant'}: </span>{m.text}</p>)}</div>
      {session?.question && <section className="hf-card"><h3 className="hf-setup-h3">{session.question.text}</h3>{!!session.question.options?.length && <div className="hf-assistant-suggestions">{session.question.options?.map(o => <button key={o} disabled={busy} onClick={() => send(o)}>{o}</button>)}</div>}
        {session.question.resourceKind === 'calendars' && <label className="hf-field">Workspace connection<select aria-label="Calendar connection" defaultValue="" disabled={busy} onChange={e => {
          const connectionId = e.target.value;
          void transport(`/api/calendar?operation=calendars&connectionId=${encodeURIComponent(connectionId)}`).then(body => { if (mounted.current) setResources((body.calendars || []).map((r: any) => ({ id: r.id, name: r.summary, connectionId }))); }).catch(e => { if (mounted.current) setError(e.message); });
        }}><option value="">Select…</option>{calendarConnections.map(r => <option key={r.id || r.connectionId} value={r.id || r.connectionId}>{r.accountEmail || r.name || r.id}</option>)}</select></label>}
        {session.question.resourceKind && <label className="hf-field">Choose an existing resource<select aria-label="Existing resource" value="" disabled={busy} onChange={e => send(`Use this resource: ${e.target.value}`)}><option value="">Select…</option>{resources.map((r, i) => { const id = r.personId || r.connectionId || r.id || r.name; const ref = { id, name: r.name || r.displayName || r.summary, connectionId: r.connectionId, calendarId: r.calendarId, mailboxAddress: r.mailboxAddress, phone: r.phone, email: r.email, documentId: r.documentId, spreadsheetId: r.spreadsheetId, range: r.range }; return <option key={`${id}-${i}`} value={JSON.stringify(ref)}>{r.name || r.displayName || r.email || r.mailboxAddress || r.accountEmail || id}</option>; })}</select></label>}
      </section>}
      {session?.scope.kind === 'element' && <button disabled={busy} className="hf-link" onClick={() => void run('expand_scope', { projectId: session.scope.projectId })}>Expand to configure this whole workflow</button>}
      {session&&!session.scope.workspaceContactPolicy&&<button disabled={busy} className="hf-link" onClick={()=>void run('expand_contact_policy')}>Include workspace contact policy (administrator)</button>}
      {proposal && <section className="hf-card"><h3 className="hf-setup-h3">Proposed configuration</h3>
        <div className="hf-chips"><span data-tone={proposal.valid ? 'good' : 'warn'}>Configuration {proposal.valid ? 'valid' : 'needs correction'}</span><span data-tone={proposal.preflight?.ready ? 'good' : 'warn'}>Prerequisites {proposal.preflight?.ready ? 'ready' : 'need attention'}</span><span>Provider availability not checked</span></div>
        <ol className="hf-steps">{proposal.preview?.milestones?.map((n: any) => <li key={n.id}><strong>{n.name}</strong> <small>{n.nodeType || 'task'}</small><p>After: {(n.dependsOn || []).join(', ') || 'Start'} · Output: {n.actionConfig?.resultVariable || '—'}</p><details><summary>Prompts and configuration</summary>{json({ action: n.actionConfig, hold: n.holdConfig, decision: n.decisionConfig, inputs: n.readyConditions })}</details></li>)}</ol>
        {proposal.preflight?.bindingIssues?.map((issue: string) => <p className="hf-warn-text" key={issue}>{issue}</p>)}
        <details><summary>Before and after · resources · schedules</summary>{json({ before: proposal.before, after: proposal.preview, contactPolicy:proposal.extras.contactPolicy,reception:proposal.extras.reception,resources: proposal.extras.resources, schedules: proposal.extras.schedules, schedulesToPause: proposal.pauseSchedules, outstanding: proposal.preflight })}</details>
        <div className="hf-actions"><button disabled={busy || proposal.applied} className="hf-btn" onClick={() => { if (Object.keys(proposal.operations).length) setReviewed(proposal.reviewHash); else void run('prepare'); }}>Review changes</button><button disabled={busy || !proposal.valid || proposal.applied || reviewed !== proposal.reviewHash} className="hf-btn hf-btn-primary" onClick={() => void run('apply', { reviewHash: proposal.reviewHash })}>Apply configuration</button><button disabled={busy || !proposal.valid} className="hf-btn" onClick={() => void run('simulate')}>Run simulation</button></div>
        {proposal.applied && <p className="hf-good-text">Configuration saved. Activation is a separate action.</p>}
        {Object.keys(proposal.operations).length > 0 && <details><summary>Saved operation receipts</summary>{json(proposal.operations)}</details>}
      </section>}
      {session?.simulation && <section className="hf-card"><h3 className="hf-setup-h3">Simulation: {session.simulation.item?.result?.status}</h3><p className="hf-muted">Provider calls: {session.simulation.item?.result?.providerCalls}. This does not verify live availability.</p><details><summary>Assertions and results</summary>{json(session.simulation.item?.result)}</details></section>}
      {proposal?.applied && <div className="hf-actions"><button disabled={busy} className="hf-btn" onClick={() => void run('review_live')}>Review live test</button><button disabled={busy} className="hf-btn" onClick={() => void run('review_activation')}>Review activation</button><button disabled={busy} className="hf-btn" onClick={() => void run('inspect')}>Inspect test status</button></div>}
      {review && <section className="hf-card hf-card-warn"><h3 className="hf-setup-h3">{isLiveReview ? 'Live test review' : 'Activation review'}</h3><p>These actions can cause real calls, messages or bookings. Review the recipients, inputs, permissions and schedule below.</p>{json(review)}<label className="hf-check"><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} />I approve these exact effects and recipients.</label><button disabled={busy || !approved} className="hf-btn hf-btn-warning" onClick={() => void run(isLiveReview ? 'approve_live' : 'approve_activation', { reviewHash: review.hash })}>{isLiveReview ? 'Run approved live test' : 'Activate approved schedules'}</button></section>}
      {session?.liveReview?.dispatch && <p className="hf-muted">Live test: {session.liveReview.completion}. Inspect the owning run to verify completion.</p>}
      {session?.activationReview?.status === 'active' && <p className="hf-good-text">Approved schedules are active.</p>}
      {(error || session?.error) && <p role="alert" className="hf-assistant-a hf-assistant-error">{error || session?.error}</p>}
      {busy && <p role="status" className="hf-status"><Loader2 size={16} className="animate-spin" />Checking setup…</p>}
    </div>
    {session && <form className="hf-assistant-composer" onSubmit={e => { e.preventDefault(); send(); }}><label className="hf-sr-only" htmlFor="setup-message">Message to setup assistant</label><textarea id="setup-message" rows={2} maxLength={8000} value={message} onChange={e => setMessage(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }} placeholder="Describe a change or answer the question…" disabled={busy} /><button aria-label="Send" disabled={busy || !message.trim()}><ArrowUp size={18} strokeWidth={2.5} /></button></form>}
    {session && <p className="hf-assistant-hint">Changes are proposed for review · nothing is saved until you apply · ⌘/Ctrl Enter to send</p>}
    </section>
  </dialog>, document.body);
}
