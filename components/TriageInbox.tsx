import React, { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Check, Inbox, Link2, RefreshCw, RotateCcw, ShieldAlert, Wrench, X } from 'lucide-react';
import type { AgentInboxJob, AskDecision, CoachingSession, ExternalActionReceipt, TenantSchedule, TriageDigest, TriageDisposition, TriageItem } from '../types';
import { firebaseService } from '../services/firebaseService';

const activeDispositions = new Set<TriageDisposition>([
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared', 'needs_review', 'delivery_failure'
]);

const responseError = async (response: Response): Promise<string> => {
  const body = await response.json().catch(() => ({}));
  return body?.error || `Request failed (${response.status})`;
};

export const TriageInbox: React.FC = () => {
  const [items, setItems] = useState<TriageItem[]>([]);
  const [digests, setDigests] = useState<TriageDigest[]>([]);
  const [showClosed, setShowClosed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingId, setUpdatingId] = useState<string | null>(null);
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, AskDecision | ''>>({});
  const [reviewNotes, setReviewNotes] = useState<Record<string, string>>({});
  const [reviewValues, setReviewValues] = useState<Record<string, Record<string, string>>>({});
  const [showOperations, setShowOperations] = useState(false);
  const [replayingId, setReplayingId] = useState<string | null>(null);
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
      const response = await firebaseService.authorizedFetch('/api/triage?limit=250');
      if (!response.ok) throw new Error(await responseError(response));
      const body = await response.json();
      setItems(Array.isArray(body.data) ? body.data : []);
      setDigests(Array.isArray(body.digests) ? body.digests : []);
      const operationsResponse = await firebaseService.authorizedFetch('/api/operations');
      if (operationsResponse.ok) {
        const snapshot = await operationsResponse.json();
        setOperations({
          agentJobs: Array.isArray(snapshot.agentJobs) ? snapshot.agentJobs : [],
          coachingSessions: Array.isArray(snapshot.coachingSessions) ? snapshot.coachingSessions : [],
          externalActions: Array.isArray(snapshot.externalActions) ? snapshot.externalActions : [],
          schedules: Array.isArray(snapshot.schedules) ? snapshot.schedules : []
        });
      }
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const update = async (item: TriageItem, payload: Record<string, unknown>) => {
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
      if (body.item) setItems(current => current.map(entry => entry.id === item.id ? body.item : entry));
    } catch (cause: any) {
      setError(cause?.message || String(cause));
    } finally {
      setUpdatingId(null);
    }
  };

  const replayAgentJob = async (jobId: string) => {
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
  };

  const visible = showClosed ? items : items.filter(item => activeDispositions.has(item.disposition));

  return (
    <section className="h-full overflow-y-auto bg-slate-50 p-4 md:p-8" aria-labelledby="triage-heading">
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 id="triage-heading" className="flex items-center gap-2 text-2xl font-black text-slate-900">
              <Inbox className="text-indigo-600" /> Communications triage
            </h2>
            <p className="mt-1 text-sm text-slate-500">Inbound messages, linked workflow responses, and delivery failures for this organization.</p>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-slate-600">
              <input type="checkbox" checked={showClosed} onChange={event => setShowClosed(event.target.checked)} />
              Show closed
            </label>
            <button type="button" onClick={() => void load()} disabled={loading} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-bold text-slate-700 hover:border-indigo-300 disabled:opacity-50">
              <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
        </div>

        {error && <div role="alert" className="mb-5 flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 p-4 text-sm font-semibold text-red-700"><AlertCircle size={18} />{error}</div>}
        {digests[0] && (
          <article className="mb-5 rounded-2xl border border-indigo-200 bg-indigo-50 p-5 shadow-sm" aria-labelledby="latest-triage-digest">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 id="latest-triage-digest" className="text-sm font-black uppercase tracking-wide text-indigo-900">Latest daily digest</h3>
                <p className="mt-1 text-xs text-indigo-700">{new Date(digests[0].scheduledFor).toLocaleString()} · {digests[0].deliveryChannel} · {digests[0].deliveryStatus.replaceAll('_', ' ')}</p>
              </div>
              <span className="rounded-full bg-white px-3 py-1 text-xs font-bold text-indigo-700">{digests[0].counts.total} new · {digests[0].counts.outstanding} outstanding</span>
            </div>
            <p className="mt-4 whitespace-pre-wrap text-sm leading-6 text-slate-700">{digests[0].summary}</p>
            {digests[0].deliveryError && <p className="mt-3 text-xs font-semibold text-amber-700">Delivery: {digests[0].deliveryError}</p>}
          </article>
        )}
        <section className="mb-5 rounded-2xl border border-slate-200 bg-white shadow-sm" aria-labelledby="operations-heading">
          <button type="button" onClick={() => setShowOperations(value => !value)} className="flex w-full items-center justify-between gap-3 p-5 text-left">
            <span><span id="operations-heading" className="flex items-center gap-2 text-sm font-black uppercase tracking-wide text-slate-800"><Wrench size={16} className="text-indigo-600" /> Operations &amp; recovery</span><span className="mt-1 block text-xs text-slate-500">Agent jobs, coaching calls, Google writes, and schedules for this tenant.</span></span>
            <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-bold text-slate-600">{operations.agentJobs.filter(job => ['failed', 'needs_review'].includes(job.status)).length} jobs need attention</span>
          </button>
          {showOperations && <div className="grid gap-5 border-t border-slate-100 p-5 lg:grid-cols-2">
            <div>
              <h3 className="mb-2 text-sm font-black text-slate-800">Agent inbox jobs</h3>
              <div className="space-y-2">{operations.agentJobs.slice(0, 10).map(job => <div key={job.id} className="rounded-lg border border-slate-200 p-3 text-xs"><div className="flex items-start justify-between gap-2"><div><span className="font-bold text-slate-800">{job.channel} · {job.status.replaceAll('_', ' ')}</span><div className="mt-1 font-mono text-slate-400">{job.id}</div>{job.error && <div className="mt-1 text-red-700">{job.error}</div>}</div>{['failed', 'needs_review'].includes(job.status) && <button type="button" onClick={() => void replayAgentJob(job.id)} disabled={replayingId === job.id} className="flex items-center gap-1 rounded border border-indigo-200 px-2 py-1 font-bold text-indigo-700 disabled:opacity-50"><RotateCcw size={12} /> Replay</button>}</div></div>)}{!operations.agentJobs.length && <p className="text-xs text-slate-500">No agent jobs recorded.</p>}</div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-black text-slate-800">Coaching call outcomes</h3>
              <div className="space-y-2">{operations.coachingSessions.slice(0, 10).map(session => <div key={`${session.projectId}:${session.id}`} className="rounded-lg border border-slate-200 p-3 text-xs"><span className="font-bold text-slate-800">{session.status.replaceAll('_', ' ')}</span><span className="ml-2 text-slate-500">{session.disposition || 'no disposition'}</span>{session.failureReason && <div className="mt-1 text-red-700">{session.failureReason}</div>}<div className="mt-1 font-mono text-slate-400">{session.projectId}</div></div>)}{!operations.coachingSessions.length && <p className="text-xs text-slate-500">No coaching sessions recorded.</p>}</div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-black text-slate-800">Google and external writes</h3>
              <div className="space-y-2">{operations.externalActions.slice(0, 10).map(action => <div key={action.idempotencyKey} className="rounded-lg border border-slate-200 p-3 text-xs"><span className="font-bold text-slate-800">{action.kind.replaceAll('_', ' ')} · {action.status}</span>{action.error && <div className="mt-1 text-red-700">{action.error}</div>}<div className="mt-1 font-mono text-slate-400">{action.projectId}</div></div>)}{!operations.externalActions.length && <p className="text-xs text-slate-500">No external action receipts recorded.</p>}</div>
            </div>
            <div>
              <h3 className="mb-2 text-sm font-black text-slate-800">Schedules</h3>
              <div className="space-y-2">{operations.schedules.slice(0, 10).map(schedule => <div key={schedule.id} className="rounded-lg border border-slate-200 p-3 text-xs"><span className="font-bold text-slate-800">{schedule.name} · {schedule.enabled ? 'enabled' : 'disabled'}</span><div className="mt-1 text-slate-500">Next {new Date(schedule.nextRunAt).toLocaleString()}</div>{schedule.lastError && <div className="mt-1 text-red-700">{schedule.lastError}</div>}</div>)}{!operations.schedules.length && <p className="text-xs text-slate-500">No schedules configured.</p>}</div>
            </div>
          </div>}
        </section>
        {!loading && visible.length === 0 && <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-12 text-center text-slate-500">No communications need attention.</div>}

        <div className="space-y-4">
          {visible.map(item => {
            const busy = updatingId === item.id;
            const selectedDecision = reviewDecisions[item.id] || item.interpretation?.decision || '';
            const reviewNote = reviewNotes[item.id] || '';
            const askFields = item.askFields || [];
            const values = { ...(item.interpretation?.values || {}), ...(reviewValues[item.id] || {}) };
            const isApproval = item.askKind === 'approval' || (!item.askKind && Boolean(item.interpretation?.decision));
            const hasRequiredValues = askFields.length > 0
              ? askFields.filter(field => field.required).every(field => values[field.name] !== undefined && values[field.name] !== '')
              : Object.keys(values).length > 0;
            const canAcceptReview = isApproval
              ? Boolean(selectedDecision && (selectedDecision !== 'revise' || reviewNote.trim()))
              : hasRequiredValues;
            return (
              <article key={item.id} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-bold uppercase tracking-wide">
                      <span className="rounded-full bg-indigo-50 px-2 py-1 text-indigo-700">{item.channel}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-1 text-slate-600">{item.disposition.replaceAll('_', ' ')}</span>
                      {!item.memoryEligible && <span className="flex items-center gap-1 rounded-full bg-amber-50 px-2 py-1 text-amber-700"><ShieldAlert size={12} /> excluded from memory</span>}
                    </div>
                    <h3 className="truncate text-lg font-black text-slate-900">{item.subject || item.sender || 'Inbound communication'}</h3>
                    <p className="mt-1 text-xs text-slate-500">{item.sender || 'Unknown sender'} · {new Date(item.occurredAt).toLocaleString()}</p>
                    {item.preview && <p className="mt-3 whitespace-pre-wrap text-sm leading-6 text-slate-700">{item.preview}</p>}
                    <dl className="mt-4 grid gap-2 text-xs text-slate-600 sm:grid-cols-2">
                      {item.askId && <div><dt className="font-bold text-slate-400">Ask</dt><dd className="font-mono">{item.askId}</dd></div>}
                      {item.askKind && <div><dt className="font-bold text-slate-400">Ask type</dt><dd>{item.askKind}</dd></div>}
                      {item.projectId && <div><dt className="font-bold text-slate-400">Project</dt><dd className="font-mono">{item.projectId}</dd></div>}
                      {item.interpretation?.intent && <div><dt className="font-bold text-slate-400">Intent</dt><dd>{item.interpretation.intent}</dd></div>}
                      {item.interpretation?.confidence !== undefined && <div><dt className="font-bold text-slate-400">Confidence</dt><dd>{Math.round(item.interpretation.confidence * 100)}%</dd></div>}
                    </dl>
                    {item.interpretation?.evidence && <blockquote className="mt-3 border-l-2 border-indigo-200 pl-3 text-sm italic text-slate-600">{item.interpretation.evidence}</blockquote>}
                    {item.proposedAction && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm font-semibold text-slate-700">Proposed: {item.proposedAction}</p>}
                    {item.agentProposal && <div className="mt-3 rounded-lg border border-violet-200 bg-violet-50 p-3 text-sm text-slate-700"><p className="font-bold text-violet-800">Coaching action · {item.agentProposal.status.replaceAll('_', ' ')}</p><p className="mt-1">{item.agentProposal.summary}</p>{item.agentProposal.value && <p className="mt-2 rounded bg-white p-2 font-mono text-xs">{item.agentProposal.value}</p>}{item.agentProposal.error && <p className="mt-2 text-xs font-semibold text-red-700">{item.agentProposal.error}</p>}</div>}
                    {item.threadId && <p className="mt-3 flex items-center gap-1 text-xs text-slate-400"><Link2 size={12} /> Thread {item.threadId}</p>}
                    {item.disposition === 'needs_review' && item.askId && (
                      <div className="mt-4 grid gap-3 rounded-xl border border-indigo-100 bg-indigo-50/50 p-4 sm:grid-cols-2">
                        {isApproval ? (
                          <label className="text-xs font-bold text-slate-600">
                            Reviewer decision
                            <select
                              value={selectedDecision}
                              onChange={event => setReviewDecisions(current => ({ ...current, [item.id]: event.target.value as AskDecision | '' }))}
                              className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                            >
                              <option value="">Select a decision</option>
                              <option value="approved">Approve</option>
                              <option value="rejected">Reject</option>
                              <option value="revise">Request revision</option>
                            </select>
                          </label>
                        ) : askFields.map(field => (
                          <label key={field.name} className="text-xs font-bold text-slate-600">
                            {field.label || field.name}{field.required ? ' (required)' : ''}
                            {field.options?.length ? (
                              <select
                                value={String(values[field.name] ?? '')}
                                onChange={event => setReviewValues(current => ({ ...current, [item.id]: { ...(current[item.id] || {}), [field.name]: event.target.value } }))}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                              >
                                <option value="">Select an option</option>
                                {field.options.map(option => <option key={option} value={option}>{option}</option>)}
                              </select>
                            ) : (
                              <input
                                type={field.type === 'number' || field.type === 'date' ? field.type : 'text'}
                                value={String(values[field.name] ?? '')}
                                onChange={event => setReviewValues(current => ({ ...current, [item.id]: { ...(current[item.id] || {}), [field.name]: event.target.value } }))}
                                className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                              />
                            )}
                          </label>
                        ))}
                        <label className="text-xs font-bold text-slate-600">
                          Reviewer note{selectedDecision === 'revise' ? ' (required)' : ''}
                          <input
                            type="text"
                            value={reviewNote}
                            onChange={event => setReviewNotes(current => ({ ...current, [item.id]: event.target.value }))}
                            placeholder={item.interpretation?.evidence || 'Optional review note'}
                            className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"
                          />
                        </label>
                      </div>
                    )}
                  </div>
                  <div className="flex shrink-0 flex-wrap gap-2 md:max-w-48 md:justify-end">
                    {item.agentProposal && ['pending', 'failed'].includes(item.agentProposal.status) && (
                      <button type="button" disabled={busy} onClick={() => void update(item, { action: 'approve_agent_proposal' })} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white hover:bg-violet-700 disabled:opacity-50"><Check size={14} /> Approve action</button>
                    )}
                    {item.agentProposal && ['pending', 'failed'].includes(item.agentProposal.status) && (
                      <button type="button" disabled={busy} onClick={() => void update(item, { action: 'reject_agent_proposal' })} className="flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 hover:bg-red-50 disabled:opacity-50"><X size={14} /> Reject action</button>
                    )}
                    {item.disposition === 'needs_review' && item.askId && (
                      <button
                        type="button"
                        disabled={busy || !canAcceptReview}
                        onClick={() => void update(item, {
                          action: 'accept_interpretation',
                          ...(selectedDecision ? { decision: selectedDecision } : {}),
                          ...(reviewNote.trim() ? { text: reviewNote.trim() } : {}),
                          ...(Object.keys(values).length ? { values } : {})
                        })}
                        className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                      ><Check size={14} /> Accept</button>
                    )}
                    {activeDispositions.has(item.disposition) && (
                      <button type="button" disabled={busy} onClick={() => void update(item, { disposition: 'resolved', action: 'resolve' })} className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50"><Check size={14} /> Resolve</button>
                    )}
                    {activeDispositions.has(item.disposition) && (
                      <button type="button" disabled={busy} onClick={() => void update(item, { disposition: 'ignored', action: 'ignore' })} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"><X size={14} /> Ignore</button>
                    )}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </section>
  );
};
