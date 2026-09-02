import React, { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react';
import { Activity, AlertCircle, Archive, BrainCircuit, ChevronRight, Clock3, FileText, Filter, Inbox, Mail, MessageSquareReply, RefreshCw, Search, ShieldAlert } from 'lucide-react';
import type { AgentInboxJob, CoachingSession, ExternalActionReceipt, TenantSchedule, TriageDigest, TriageDisposition, TriageItem } from '../types';
import { firebaseService } from '../services/firebaseService';
import { TriageDetailDrawer, type TriageSelection } from './triage/TriageDetailDrawer';
import { triageRecommendedAction, triageResponsePresentation, triageResponseToneClass } from './triage/triagePresentation';
import { coachingPresentation, coachingToneClass } from './triage/coachingPresentation';

type ViewTab = 'emails' | 'responses' | 'coaching' | 'runs' | 'digests';
type StatusFilter = 'all' | 'active' | 'closed';
type PriorityFilter = 'all' | 'urgent' | 'high' | 'normal' | 'low';
type CoachingStatusFilter = 'all' | 'active' | 'review' | 'completed' | 'failed';
type OperationActivity = {
  kind: 'job' | 'coaching' | 'external' | 'schedule';
  id: string;
  at: number;
  title: string;
  detail: string;
  status: string;
  selection: TriageSelection;
};

const activeDispositions = new Set<TriageDisposition>([
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared', 'needs_review', 'delivery_failure'
]);

const formatDate = (value?: string | number | null) => value ? new Date(value).toLocaleString() : 'Not recorded';
const formatLabel = (value?: string) => value ? value.replaceAll('_', ' ') : 'Not recorded';

const responseError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return body?.error || `Request failed (${response.status})`;
};

const statusTone = (status: string) => {
  if (['completed', 'resolved', 'sent', 'enabled'].includes(status)) return 'bg-emerald-50 text-emerald-700';
  if (['failed', 'delivery_failure'].includes(status)) return 'bg-red-50 text-red-700';
  if (['needs_review', 'review_required', 'running', 'processing', 'calling'].includes(status)) return 'bg-amber-50 text-amber-700';
  return 'bg-slate-100 text-slate-600';
};

const updateLocationSelection = (selection: TriageSelection | null) => {
  const url = new URL(window.location.href);
  url.searchParams.delete('triage');
  url.searchParams.delete('digest');
  url.searchParams.delete('coaching');
  if (selection?.kind === 'email') url.searchParams.set('triage', selection.item.id);
  if (selection?.kind === 'digest') url.searchParams.set('digest', selection.digest.id);
  if (selection?.kind === 'coaching') url.searchParams.set('coaching', selection.session.id);
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
};

const initialViewTab = (): ViewTab => new URLSearchParams(window.location.search).get('activity') === 'coaching' ? 'coaching' : 'emails';

export const TriageInbox: React.FC = () => {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [digests, setDigests] = useState<TriageDigest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [selection, setSelection] = useState<TriageSelection | null>(null);
  const [tab, setTab] = useState<ViewTab>(initialViewTab);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [coachingStatusFilter, setCoachingStatusFilter] = useState<CoachingStatusFilter>('all');
  const [projectFilter, setProjectFilter] = useState('all');
  const [operations, setOperations] = useState<{
    agentJobs: AgentInboxJob[];
    coachingSessions: CoachingSession[];
    externalActions: ExternalActionReceipt[];
    schedules: TenantSchedule[];
  }>({ agentJobs: [], coachingSessions: [], externalActions: [], schedules: [] });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [triageResponse, operationsResponse] = await Promise.all([
        firebaseService.authorizedFetch('/api/triage?limit=500'),
        firebaseService.authorizedFetch('/api/operations')
      ]);
      if (!triageResponse.ok) throw new Error(await responseError(triageResponse));
      const body = await triageResponse.json();
      const nextItems = Array.isArray(body.data) ? body.data : [];
      const nextDigests = Array.isArray(body.digests) ? body.digests : [];
      setItems(nextItems);
      setDigests(nextDigests);
      setSelection(current => {
        if (current?.kind === 'email') {
          const refreshed = nextItems.find((entry: TriageItem) => entry.id === current.item.id);
          return refreshed ? { kind: 'email', item: refreshed } : null;
        }
        if (current?.kind === 'digest') {
          const refreshed = nextDigests.find((entry: TriageDigest) => entry.id === current.digest.id);
          return refreshed ? { kind: 'digest', digest: refreshed } : null;
        }
        return current;
      });
      if (operationsResponse.ok) {
        const snapshot = await operationsResponse.json();
        const nextOperations = {
          agentJobs: Array.isArray(snapshot.agentJobs) ? snapshot.agentJobs : [],
          coachingSessions: Array.isArray(snapshot.coachingSessions) ? snapshot.coachingSessions : [],
          externalActions: Array.isArray(snapshot.externalActions) ? snapshot.externalActions : [],
          schedules: Array.isArray(snapshot.schedules) ? snapshot.schedules : []
        };
        setOperations(nextOperations);
        setSelection(current => {
          if (current?.kind !== 'coaching') return current;
          const refreshed = nextOperations.coachingSessions.find((entry: CoachingSession) => entry.id === current.session.id && entry.projectId === current.session.projectId);
          return refreshed ? { kind: 'coaching', session: refreshed } : null;
        });
      }
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  useEffect(() => {
    if (selection || loading) return;
    const params = new URLSearchParams(window.location.search);
    const triageId = params.get('triage');
    const digestId = params.get('digest');
    const coachingId = params.get('coaching');
    const item = triageId ? items.find(entry => entry.id === triageId) : undefined;
    const digest = digestId ? digests.find(entry => entry.id === digestId) : undefined;
    const coachingSession = coachingId ? operations.coachingSessions.find(entry => entry.id === coachingId) : undefined;
    if (item) setSelection({ kind: 'email', item });
    else if (digest) setSelection({ kind: 'digest', digest });
    else if (coachingSession) { setTab('coaching'); setSelection({ kind: 'coaching', session: coachingSession }); }
  }, [digests, items, loading, operations.coachingSessions, selection]);

  const selectTab = useCallback((nextTab: ViewTab) => {
    setTab(nextTab);
    setProjectFilter('all');
    const url = new URL(window.location.href);
    if (nextTab === 'coaching') url.searchParams.set('activity', 'coaching');
    else url.searchParams.delete('activity');
    window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const openSelection = useCallback((nextSelection: TriageSelection) => {
    setSelection(nextSelection);
    updateLocationSelection(nextSelection);
  }, []);

  const closeSelection = useCallback(() => {
    setSelection(null);
    updateLocationSelection(null);
  }, []);

  const update = useCallback(async (item: TriageItem, payload: Record<string, unknown>) => {
    setUpdatingId(item.id);
    setError(null);
    try {
      const response = await firebaseService.authorizedFetch('/api/triage', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: item.id, ...payload })
      });
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      if (body.item) {
        setItems(current => current.map(entry => entry.id === item.id ? body.item : entry));
        setSelection(current => current?.kind === 'email' && current.item.id === item.id ? { kind: 'email', item: body.item } : current);
      }
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    } finally {
      setUpdatingId(null);
    }
  }, []);

  const replayAgentJob = useCallback(async (jobId: string) => {
    setReplayingId(jobId);
    setError(null);
    try {
      const response = await firebaseService.authorizedFetch('/api/operations/agent-jobs/replay', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId })
      });
      if (!response.ok) throw new Error(await responseError(response));
      await load();
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    } finally {
      setReplayingId(null);
    }
  }, [load]);

  const jobsByCommunication = useMemo(() => {
    const map = new Map<string, AgentInboxJob>();
    for (const job of operations.agentJobs) {
      const current = map.get(job.communicationId);
      if (!current || current.updatedAt < job.updatedAt) map.set(job.communicationId, job);
    }
    return map;
  }, [operations.agentJobs]);

  const projects = useMemo(() => Array.from(new Set(items.map(item => item.projectId).filter(Boolean) as string[])).sort(), [items]);
  const coachingProjects = useMemo(() => Array.from(new Set(operations.coachingSessions.map(session => session.projectId))).sort(), [operations.coachingSessions]);

  const filteredItems = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return items.filter(item => {
      if (statusFilter === 'active' && !activeDispositions.has(item.disposition)) return false;
      if (statusFilter === 'closed' && activeDispositions.has(item.disposition)) return false;
      if (priorityFilter !== 'all' && (item.priority || 'normal') !== priorityFilter) return false;
      if (projectFilter !== 'all' && item.projectId !== projectFilter) return false;
      if (tab === 'responses') {
        const response = triageResponsePresentation(item, jobsByCommunication.get(item.communicationId));
        if (response.kind === 'none') return false;
      }
      if (!needle) return true;
      return [item.subject, item.sender, item.preview, item.summary, item.projectId, item.connectionId, item.communicationId]
        .some(value => String(value || '').toLowerCase().includes(needle));
    });
  }, [deferredQuery, items, jobsByCommunication, priorityFilter, projectFilter, statusFilter, tab]);

  const filteredCoachingSessions = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return operations.coachingSessions.filter(session => {
      if (coachingStatusFilter === 'active' && !['scheduled', 'calling', 'review_required'].includes(session.status)) return false;
      if (coachingStatusFilter === 'review' && session.status !== 'review_required') return false;
      if (coachingStatusFilter === 'completed' && session.status !== 'completed') return false;
      if (coachingStatusFilter === 'failed' && session.status !== 'failed') return false;
      if (projectFilter !== 'all' && session.projectId !== projectFilter) return false;
      if (!needle) return true;
      return [session.summary, session.progress, session.blockers, session.commitments, session.nextActions, session.failureReason, session.projectId, session.id]
        .some(value => String(value || '').toLowerCase().includes(needle));
    });
  }, [coachingStatusFilter, deferredQuery, operations.coachingSessions, projectFilter]);

  const activity = useMemo<OperationActivity[]>(() => {
    const records: OperationActivity[] = [];
    for (const job of operations.agentJobs) records.push({ kind: 'job', id: job.id, at: job.updatedAt, title: `${job.channel} agent job`, detail: job.error || job.routing?.reason || job.communicationId, status: job.status, selection: { kind: 'job', job } });
    for (const session of operations.coachingSessions) records.push({ kind: 'coaching', id: `${session.projectId}:${session.id}`, at: session.updatedAt, title: 'Coaching call', detail: session.failureReason || session.summary || session.projectId, status: session.status, selection: { kind: 'coaching', session } });
    for (const action of operations.externalActions) records.push({ kind: 'external', id: action.idempotencyKey, at: action.completedAt || action.startedAt, title: formatLabel(action.kind), detail: action.error || action.projectId, status: action.status, selection: { kind: 'external', action } });
    for (const schedule of operations.schedules) records.push({ kind: 'schedule', id: schedule.id, at: schedule.updatedAt, title: schedule.name, detail: `Next ${formatDate(schedule.nextRunAt)}`, status: schedule.enabled ? 'enabled' : 'disabled', selection: { kind: 'schedule', schedule } });
    return records.sort((a, b) => b.at - a.at);
  }, [operations]);

  const filteredActivity = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return needle ? activity.filter(entry => [entry.title, entry.detail, entry.status, entry.id].some(value => value.toLowerCase().includes(needle))) : activity;
  }, [activity, deferredQuery]);

  const filteredDigests = useMemo(() => {
    const needle = deferredQuery.trim().toLowerCase();
    return needle ? digests.filter(digest => [digest.summary, digest.deliveryStatus, digest.deliveryChannel, digest.projectId, digest.id].some(value => String(value || '').toLowerCase().includes(needle))) : digests;
  }, [deferredQuery, digests]);

  const activeCount = items.filter(item => activeDispositions.has(item.disposition)).length;
  const draftCount = items.filter(item => triageResponsePresentation(item, jobsByCommunication.get(item.communicationId)).kind === 'draft_prepared').length;
  const responseCount = items.filter(item => triageResponsePresentation(item, jobsByCommunication.get(item.communicationId)).kind === 'response_created').length;
  const errorCount = operations.agentJobs.filter(job => job.status === 'failed').length + operations.externalActions.filter(action => action.status === 'failed').length + operations.coachingSessions.filter(session => session.status === 'failed').length;
  const coachingCompletedCount = operations.coachingSessions.filter(session => session.status === 'completed').length;
  const coachingReviewCount = operations.coachingSessions.filter(session => session.status === 'review_required').length;
  const coachingFailedCount = operations.coachingSessions.filter(session => session.status === 'failed').length;

  const tabs: Array<{ id: ViewTab; label: string; count: number; icon: React.ReactNode }> = [
    { id: 'emails', label: 'Emails', count: items.length, icon: <Mail size={16} /> },
    { id: 'responses', label: 'Responses', count: draftCount + responseCount, icon: <MessageSquareReply size={16} /> },
    { id: 'coaching', label: 'Coaching', count: operations.coachingSessions.length, icon: <BrainCircuit size={16} /> },
    { id: 'runs', label: 'Runs & logs', count: activity.length, icon: <Activity size={16} /> },
    { id: 'digests', label: 'Digests', count: digests.length, icon: <FileText size={16} /> }
  ];

  return (
    <section className="h-full overflow-y-auto bg-slate-50 p-4 md:p-8" aria-labelledby="triage-heading">
      <div className="mx-auto max-w-7xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><h2 id="triage-heading" className="flex items-center gap-2 text-2xl font-black text-slate-900"><Inbox className="text-indigo-600" /> Communications activity</h2><p className="mt-1 text-sm text-slate-500">Inspect email triage, coaching outcomes, responses, and operational history.</p></div>
          <div className="flex items-center gap-3"><span className="text-xs font-medium text-slate-400">{items.length} emails · {operations.coachingSessions.length} coaching sessions</span><button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-indigo-300 disabled:opacity-50"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh</button></div>
        </div>

        {error && <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle size={18} />{error}</div>}

        {tab === 'coaching' ? <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" onClick={() => setCoachingStatusFilter('all')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-violet-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Sessions</span><BrainCircuit size={17} className="text-violet-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{operations.coachingSessions.length}</div></button>
          <button type="button" onClick={() => setCoachingStatusFilter('completed')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-emerald-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Completed</span><MessageSquareReply size={17} className="text-emerald-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{coachingCompletedCount}</div></button>
          <button type="button" onClick={() => setCoachingStatusFilter('review')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-amber-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Needs review</span><Clock3 size={17} className="text-amber-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{coachingReviewCount}</div></button>
          <button type="button" onClick={() => setCoachingStatusFilter('failed')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-red-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Failed</span><ShieldAlert size={17} className="text-red-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{coachingFailedCount}</div></button>
        </div> : <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <button type="button" onClick={() => { selectTab('emails'); setStatusFilter('active'); }} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Needs attention</span><Clock3 size={17} className="text-amber-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{activeCount}</div></button>
          <button type="button" onClick={() => selectTab('responses')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Drafts</span><FileText size={17} className="text-indigo-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{draftCount}</div></button>
          <button type="button" onClick={() => selectTab('responses')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Responses</span><MessageSquareReply size={17} className="text-emerald-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{responseCount}</div></button>
          <button type="button" onClick={() => selectTab('runs')} className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm hover:border-indigo-300"><div className="flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wide text-slate-400">Errors</span><ShieldAlert size={17} className="text-red-500" /></div><div className="mt-2 text-2xl font-black text-slate-900">{errorCount}</div></button>
        </div>}

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <nav className="flex overflow-x-auto border-b border-slate-200 px-2" aria-label="Communications activity views">
            {tabs.map(entry => <button key={entry.id} type="button" onClick={() => selectTab(entry.id)} className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-4 text-sm font-bold ${tab === entry.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>{entry.icon}{entry.label}<span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">{entry.count}</span></button>)}
          </nav>

          <div className="flex flex-col gap-3 border-b border-slate-100 bg-slate-50/60 p-4 lg:flex-row lg:items-center">
            <label className="relative min-w-0 flex-1"><span className="sr-only">Search activity</span><Search size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder={tab === 'runs' ? 'Search jobs, schedules and errors…' : tab === 'digests' ? 'Search digest history…' : tab === 'coaching' ? 'Search outcomes, blockers, commitments or project…' : 'Search sender, subject, content or ID…'} className="w-full rounded-xl border border-slate-200 bg-white py-2.5 pl-10 pr-3 text-sm outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100" /></label>
            {(tab === 'emails' || tab === 'responses') && <div className="flex flex-wrap items-center gap-2"><Filter size={16} className="text-slate-400" /><label><span className="sr-only">Status</span><select value={statusFilter} onChange={event => setStatusFilter(event.target.value as StatusFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><option value="all">All statuses</option><option value="active">Needs attention</option><option value="closed">Closed</option></select></label><label><span className="sr-only">Priority</span><select value={priorityFilter} onChange={event => setPriorityFilter(event.target.value as PriorityFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><option value="all">All priorities</option><option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option><option value="low">Low</option></select></label>{projects.length > 0 && <label><span className="sr-only">Project</span><select value={projectFilter} onChange={event => setProjectFilter(event.target.value)} className="max-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><option value="all">All projects</option>{projects.map(project => <option key={project} value={project}>{project}</option>)}</select></label>}</div>}
            {tab === 'coaching' && <div className="flex flex-wrap items-center gap-2"><Filter size={16} className="text-slate-400" /><label><span className="sr-only">Coaching status</span><select value={coachingStatusFilter} onChange={event => setCoachingStatusFilter(event.target.value as CoachingStatusFilter)} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><option value="all">All outcomes</option><option value="active">Active / review</option><option value="review">Needs review</option><option value="completed">Completed</option><option value="failed">Failed</option></select></label>{coachingProjects.length > 0 && <label><span className="sr-only">Coaching project</span><select value={projectFilter} onChange={event => setProjectFilter(event.target.value)} className="max-w-48 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600"><option value="all">All projects</option>{coachingProjects.map(project => <option key={project} value={project}>{project}</option>)}</select></label>}</div>}
          </div>

          {(tab === 'emails' || tab === 'responses') && <div className="overflow-x-auto"><table className="w-full min-w-[1050px] border-collapse text-left"><thead><tr className="border-b border-slate-100 text-[11px] font-black uppercase tracking-wide text-slate-400"><th className="px-5 py-3">Message</th><th className="px-4 py-3">Received</th><th className="px-4 py-3">Priority</th><th className="px-4 py-3">Triage result</th><th className="px-4 py-3">Recommended action</th><th className="px-4 py-3">Draft / response</th><th className="w-12 px-4 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody>{filteredItems.map(item => { const job = jobsByCommunication.get(item.communicationId); const response = triageResponsePresentation(item, job); const recommendedAction = triageRecommendedAction(item); return <tr key={item.id} className="border-b border-slate-100 last:border-0 hover:bg-indigo-50/30"><td className="max-w-md px-5 py-4"><button type="button" onClick={() => openSelection({ kind: 'email', item })} className="block w-full text-left"><span className="block truncate text-sm font-black text-slate-900">{item.subject || 'Inbound communication'}</span><span className="mt-1 block truncate text-xs text-slate-500">{item.sender || 'Unknown sender'}{item.summary ? ` · ${item.summary}` : ''}</span></button></td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDate(item.occurredAt)}</td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${item.priority === 'urgent' || item.priority === 'high' ? 'bg-amber-50 text-amber-700' : 'bg-slate-100 text-slate-600'}`}>{item.priority || 'normal'}</span></td><td className="px-4 py-4"><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusTone(item.disposition)}`}>{formatLabel(item.disposition)}</span></td><td className="max-w-xs px-4 py-4 text-xs leading-5 text-slate-600">{recommendedAction || 'No action recorded'}</td><td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${triageResponseToneClass(response.tone)}`}>{response.label}</span></td><td className="px-4 py-4"><button type="button" onClick={() => openSelection({ kind: 'email', item })} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-indigo-600" aria-label={`Open ${item.subject || 'communication'}`}><ChevronRight size={17} /></button></td></tr>; })}</tbody></table>{!loading && filteredItems.length === 0 && <div className="p-12 text-center text-sm text-slate-500">No communications match these filters.</div>}</div>}

          {tab === 'coaching' && <div className="overflow-x-auto"><table className="w-full min-w-[1120px] border-collapse text-left"><thead><tr className="border-b border-slate-100 text-[11px] font-black uppercase tracking-wide text-slate-400"><th className="px-5 py-3">Coaching session</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Outcome</th><th className="px-4 py-3">Commitments</th><th className="px-4 py-3">Next step</th><th className="px-4 py-3">Confidence</th><th className="w-12 px-4 py-3"><span className="sr-only">Open</span></th></tr></thead><tbody>{filteredCoachingSessions.map(session => { const presentation = coachingPresentation(session); return <tr key={`${session.projectId}:${session.id}`} className="border-b border-slate-100 last:border-0 hover:bg-violet-50/30"><td className="max-w-sm px-5 py-4"><button type="button" onClick={() => openSelection({ kind: 'coaching', session })} className="block w-full text-left"><span className="block truncate text-sm font-black text-slate-900">{session.summary || 'Coaching session'}</span><span className="mt-1 block truncate text-xs text-slate-500">Project {session.projectId}{session.progress ? ` · ${session.progress}` : ''}</span></button></td><td className="whitespace-nowrap px-4 py-4 text-xs text-slate-500">{formatDate(session.scheduledFor || session.updatedAt)}</td><td className="px-4 py-4"><span className={`whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-bold ${coachingToneClass(presentation.tone)}`}>{presentation.label}</span>{session.sheetWrite && <span className="mt-2 block text-[11px] font-bold text-emerald-700">Tracker updated</span>}</td><td className="max-w-xs px-4 py-4 text-xs leading-5 text-slate-600">{session.commitments || 'No commitments recorded'}</td><td className="max-w-xs px-4 py-4 text-xs leading-5 text-slate-600">{presentation.nextStep}</td><td className="px-4 py-4 text-xs font-bold text-slate-600">{typeof session.confidence === 'number' ? `${Math.round(session.confidence * 100)}%` : 'Not recorded'}</td><td className="px-4 py-4"><button type="button" onClick={() => openSelection({ kind: 'coaching', session })} className="rounded-lg p-2 text-slate-400 hover:bg-white hover:text-violet-600" aria-label="Open coaching session"><ChevronRight size={17} /></button></td></tr>; })}</tbody></table>{!loading && filteredCoachingSessions.length === 0 && <div className="p-12 text-center text-sm text-slate-500">No coaching sessions match these filters.</div>}</div>}

          {tab === 'runs' && <div className="divide-y divide-slate-100">{filteredActivity.map(entry => <button key={`${entry.kind}:${entry.id}`} type="button" onClick={() => openSelection(entry.selection)} className="flex w-full items-center gap-4 px-5 py-4 text-left hover:bg-indigo-50/30"><span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${entry.kind === 'job' ? 'bg-indigo-50 text-indigo-600' : entry.kind === 'schedule' ? 'bg-sky-50 text-sky-600' : entry.kind === 'coaching' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600'}`}>{entry.kind === 'schedule' ? <Clock3 size={17} /> : entry.kind === 'external' ? <Archive size={17} /> : <Activity size={17} />}</span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-black capitalize text-slate-900">{entry.title}</span><span className="mt-1 block truncate text-xs text-slate-500">{entry.detail}</span></span><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusTone(entry.status)}`}>{formatLabel(entry.status)}</span><span className="hidden whitespace-nowrap text-xs text-slate-400 md:block">{formatDate(entry.at)}</span><ChevronRight size={17} className="shrink-0 text-slate-400" /></button>)}{!loading && filteredActivity.length === 0 && <div className="p-12 text-center text-sm text-slate-500">No operational activity matches this search.</div>}</div>}

          {tab === 'digests' && <div className="grid gap-4 p-4 md:grid-cols-2">{filteredDigests.map(digest => <button key={digest.id} type="button" onClick={() => openSelection({ kind: 'digest', digest })} className="rounded-xl border border-slate-200 p-4 text-left hover:border-indigo-300 hover:bg-indigo-50/30"><div className="flex items-start justify-between gap-3"><span><span className="block text-sm font-black text-slate-900">Daily digest</span><span className="mt-1 block text-xs text-slate-500">{formatDate(digest.scheduledFor)} · {digest.deliveryChannel}</span></span><span className={`rounded-full px-2.5 py-1 text-xs font-bold capitalize ${statusTone(digest.deliveryStatus)}`}>{formatLabel(digest.deliveryStatus)}</span></div><p className="mt-4 line-clamp-3 whitespace-pre-wrap text-sm leading-6 text-slate-600">{digest.summary}</p><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{digest.counts.total} new</span><span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{digest.counts.outstanding} outstanding</span><span className="rounded-full bg-indigo-50 px-2.5 py-1 text-indigo-700">{digest.counts.draftsPrepared} drafts</span></div></button>)}{!loading && filteredDigests.length === 0 && <div className="col-span-full p-12 text-center text-sm text-slate-500">No digest history matches this search.</div>}</div>}

          {loading && !items.length && !operations.coachingSessions.length && <div className="flex items-center justify-center gap-2 p-12 text-sm font-semibold text-slate-500"><RefreshCw size={18} className="animate-spin" /> Loading activity…</div>}
        </div>
      </div>

      <TriageDetailDrawer selection={selection} items={items} agentJobs={operations.agentJobs} updatingId={updatingId} replayingId={replayingId} onClose={closeSelection} onSelectEmail={item => openSelection({ kind: 'email', item })} onUpdate={update} onReplayAgentJob={replayAgentJob} />
    </section>
  );
};
