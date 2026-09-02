import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Copy, FileText, Link2, MessageSquareReply, RotateCcw, ShieldAlert, X } from 'lucide-react';
import type {
  AgentInboxJob,
  AskDecision,
  CoachingSession,
  ExternalActionReceipt,
  TenantSchedule,
  TriageDigest,
  TriageItem
} from '../../types';

export type TriageSelection =
  | { kind: 'email'; item: TriageItem }
  | { kind: 'digest'; digest: TriageDigest }
  | { kind: 'job'; job: AgentInboxJob }
  | { kind: 'coaching'; session: CoachingSession }
  | { kind: 'external'; action: ExternalActionReceipt }
  | { kind: 'schedule'; schedule: TenantSchedule };

interface TriageDetailDrawerProps {
  selection: TriageSelection | null;
  items: TriageItem[];
  agentJobs: AgentInboxJob[];
  updatingId: string | null;
  replayingId: string | null;
  onClose: () => void;
  onSelectEmail: (item: TriageItem) => void;
  onUpdate: (item: TriageItem, payload: Record<string, unknown>) => Promise<void>;
  onReplayAgentJob: (jobId: string) => Promise<void>;
}

type EmailDetailTab = 'overview' | 'message' | 'response' | 'timeline' | 'technical';

const activeDispositions = new Set([
  'new', 'linked_workflow', 'awaiting_interpretation', 'draft_prepared', 'needs_review', 'delivery_failure'
]);

const formatDate = (value?: string | number | null) => value
  ? new Date(value).toLocaleString()
  : 'Not recorded';

const formatLabel = (value?: string) => value ? value.replaceAll('_', ' ') : 'Not recorded';

const copyText = async (value: string) => {
  await navigator.clipboard?.writeText(value);
};

const DetailRow: React.FC<{ label: string; value?: React.ReactNode; mono?: boolean }> = ({ label, value, mono = false }) => (
  <div className="border-b border-slate-100 py-3 last:border-0">
    <dt className="text-xs font-bold uppercase tracking-wide text-slate-400">{label}</dt>
    <dd className={`mt-1 break-words text-sm text-slate-700 ${mono ? 'font-mono text-xs' : ''}`}>{value || 'Not recorded'}</dd>
  </div>
);

const Identifier: React.FC<{ label: string; value?: string }> = ({ label, value }) => value ? (
  <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</div>
        <div className="mt-1 break-all font-mono text-xs text-slate-700">{value}</div>
      </div>
      <button type="button" onClick={() => void copyText(value)} className="rounded-md p-1.5 text-slate-400 hover:bg-white hover:text-indigo-600" aria-label={`Copy ${label}`}>
        <Copy size={14} />
      </button>
    </div>
  </div>
) : null;

const EmailDetail: React.FC<{
  item: TriageItem;
  matchingJob?: AgentInboxJob;
  busy: boolean;
  onUpdate: (item: TriageItem, payload: Record<string, unknown>) => Promise<void>;
}> = ({ item, matchingJob, busy, onUpdate }) => {
  const [tab, setTab] = useState<EmailDetailTab>('overview');
  const [decision, setDecision] = useState<AskDecision | ''>(item.interpretation?.decision || '');
  const [note, setNote] = useState('');
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(
    Object.entries(item.interpretation?.values || {}).map(([key, value]) => [key, String(value ?? '')])
  ));
  const askFields = item.askFields || [];
  const isApproval = item.askKind === 'approval' || (!item.askKind && Boolean(item.interpretation?.decision));
  const hasRequiredValues = askFields.length > 0
    ? askFields.filter(field => field.required).every(field => values[field.name] !== undefined && values[field.name] !== '')
    : Object.keys(values).length > 0;
  const canAcceptReview = isApproval ? Boolean(decision && (decision !== 'revise' || note.trim())) : hasRequiredValues;
  const responseCommunicationId = matchingJob?.responseCommunicationId;
  const responseDraftId = item.providerDraftId || matchingJob?.responseDraftId;

  const tabs: Array<{ id: EmailDetailTab; label: string }> = [
    { id: 'overview', label: 'Overview' },
    { id: 'message', label: 'Message' },
    { id: 'response', label: 'Response' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'technical', label: 'Technical' }
  ];

  return (
    <>
      <div className="border-b border-slate-200 px-5 pt-5">
        <div className="mb-4 flex flex-wrap gap-2">
          <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-bold text-indigo-700">{item.channel}</span>
          <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold capitalize text-slate-600">{formatLabel(item.disposition)}</span>
          {item.priority && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-bold capitalize text-amber-700">{item.priority} priority</span>}
        </div>
        <h2 id="triage-detail-title" className="pr-10 text-xl font-black leading-tight text-slate-900">{item.subject || 'Inbound communication'}</h2>
        <p className="mt-2 text-sm text-slate-500">{item.sender || 'Unknown sender'} · {formatDate(item.occurredAt)}</p>
        <div className="mt-5 flex gap-1 overflow-x-auto" role="tablist" aria-label="Email detail sections">
          {tabs.map(entry => (
            <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} onClick={() => setTab(entry.id)} className={`whitespace-nowrap border-b-2 px-3 py-2 text-xs font-bold ${tab === entry.id ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-800'}`}>
              {entry.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-5">
        {tab === 'overview' && (
          <div className="space-y-5">
            <section>
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">Triage result</h3>
              <p className="mt-2 text-sm leading-6 text-slate-700">{item.summary || item.preview || 'No summary was recorded.'}</p>
            </section>
            <dl className="rounded-xl border border-slate-200 px-4">
              <DetailRow label="Intent" value={item.intent || item.interpretation?.intent} />
              <DetailRow label="Requested action" value={item.requestedAction || item.proposedAction} />
              <DetailRow label="Recommendation" value={item.recommendation} />
              <DetailRow label="Risk" value={item.risk ? <span className="capitalize">{item.risk}</span> : undefined} />
              <DetailRow label="Deadline" value={item.deadline} />
              <DetailRow label="Confidence" value={item.interpretation?.confidence !== undefined ? `${Math.round(item.interpretation.confidence * 100)}%` : undefined} />
            </dl>
            {item.evidence?.length ? (
              <section>
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">Evidence</h3>
                <ul className="mt-2 space-y-2 text-sm text-slate-700">
                  {item.evidence.map((entry, index) => <li key={`${entry}:${index}`} className="rounded-lg bg-slate-50 p-3">{entry}</li>)}
                </ul>
              </section>
            ) : item.interpretation?.evidence ? (
              <blockquote className="border-l-2 border-indigo-200 pl-3 text-sm italic text-slate-600">{item.interpretation.evidence}</blockquote>
            ) : null}
            {!item.memoryEligible && <div className="flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><ShieldAlert className="mt-0.5 shrink-0" size={16} /> This communication is excluded from agent memory.</div>}
            {item.agentProposal && <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-slate-700"><p className="font-bold text-violet-800">Coaching action · {formatLabel(item.agentProposal.status)}</p><p className="mt-1">{item.agentProposal.summary}</p>{item.agentProposal.value && <p className="mt-2 rounded bg-white p-2 font-mono text-xs">{item.agentProposal.value}</p>}{item.agentProposal.error && <p className="mt-2 text-xs font-semibold text-red-700">{item.agentProposal.error}</p>}</div>}
          </div>
        )}

        {tab === 'message' && (
          <div className="space-y-5">
            <dl className="rounded-xl border border-slate-200 px-4">
              <DetailRow label="From" value={item.sender} />
              <DetailRow label="To" value={item.recipients?.join(', ')} />
              <DetailRow label="Received" value={formatDate(item.occurredAt)} />
              <DetailRow label="Direction" value={<span className="capitalize">{item.direction}</span>} />
            </dl>
            <section>
              <h3 className="text-xs font-black uppercase tracking-wide text-slate-400">Stored message preview</h3>
              <div className="mt-2 whitespace-pre-wrap rounded-xl border border-slate-200 bg-white p-4 text-sm leading-6 text-slate-700">{item.preview || 'No message preview was stored.'}</div>
              <p className="mt-2 text-xs text-slate-400">The triage record currently stores a bounded preview rather than the complete mailbox message.</p>
            </section>
          </div>
        )}

        {tab === 'response' && (
          <div className="space-y-5">
            {responseCommunicationId ? (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex items-center gap-2 font-bold text-emerald-800"><MessageSquareReply size={18} /> Response communication created</div>
                <p className="mt-2 font-mono text-xs text-emerald-700">{responseCommunicationId}</p>
              </div>
            ) : responseDraftId ? (
              <div className="rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                <div className="flex items-center gap-2 font-bold text-indigo-800"><FileText size={18} /> Draft prepared</div>
                <p className="mt-2 font-mono text-xs text-indigo-700">{responseDraftId}</p>
                <p className="mt-2 text-xs text-indigo-600">A provider draft identifier is recorded. A direct Gmail or Outlook link is not available yet.</p>
              </div>
            ) : (
              <div className="rounded-xl border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">No response or draft is linked to this communication.</div>
            )}
            {matchingJob && <dl className="rounded-xl border border-slate-200 px-4"><DetailRow label="Agent job status" value={<span className="capitalize">{formatLabel(matchingJob.status)}</span>} /><DetailRow label="Attempts" value={matchingJob.attemptCount} /><DetailRow label="Last updated" value={formatDate(matchingJob.updatedAt)} />{matchingJob.error && <DetailRow label="Error" value={<span className="text-red-700">{matchingJob.error}</span>} />}</dl>}
            {item.disposition === 'needs_review' && item.askId && (
              <section className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-4">
                <h3 className="text-sm font-black text-indigo-900">Reviewer response</h3>
                <div className="mt-3 grid gap-3">
                  {isApproval ? (
                    <label className="text-xs font-bold text-slate-600">Decision<select value={decision} onChange={event => setDecision(event.target.value as AskDecision | '')} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"><option value="">Select a decision</option><option value="approved">Approve</option><option value="rejected">Reject</option><option value="revise">Request revision</option></select></label>
                  ) : askFields.map(field => (
                    <label key={field.name} className="text-xs font-bold text-slate-600">{field.label || field.name}{field.required ? ' (required)' : ''}{field.options?.length ? <select value={values[field.name] || ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800"><option value="">Select an option</option>{field.options.map(option => <option key={option} value={option}>{option}</option>)}</select> : <input type={field.type === 'number' || field.type === 'date' ? field.type : 'text'} value={values[field.name] || ''} onChange={event => setValues(current => ({ ...current, [field.name]: event.target.value }))} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800" />}</label>
                  ))}
                  <label className="text-xs font-bold text-slate-600">Reviewer note{decision === 'revise' ? ' (required)' : ''}<input value={note} onChange={event => setNote(event.target.value)} placeholder={item.interpretation?.evidence || 'Optional review note'} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800" /></label>
                  <button type="button" disabled={busy || !canAcceptReview} onClick={() => void onUpdate(item, { action: 'accept_interpretation', ...(decision ? { decision } : {}), ...(note.trim() ? { text: note.trim() } : {}), ...(Object.keys(values).length ? { values } : {}) })} className="flex items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"><Check size={14} /> Accept interpretation</button>
                </div>
              </section>
            )}
          </div>
        )}

        {tab === 'timeline' && (
          <ol className="relative ml-2 border-l border-slate-200 pl-5">
            {[...(item.audit || [])].sort((a, b) => b.at - a.at).map((entry, index) => (
              <li key={`${entry.at}:${entry.action}:${index}`} className="relative pb-6 last:pb-0">
                <span className="absolute -left-[25px] top-1 h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500 ring-1 ring-slate-200" />
                <p className="text-sm font-bold capitalize text-slate-800">{formatLabel(entry.action)}</p>
                <p className="mt-1 text-xs text-slate-500">{formatDate(entry.at)} · {entry.actor}</p>
                {entry.detail && <p className="mt-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">{entry.detail}</p>}
              </li>
            ))}
            {!item.audit?.length && <li className="text-sm text-slate-500">No audit events were recorded.</li>}
          </ol>
        )}

        {tab === 'technical' && (
          <div className="space-y-3">
            <Identifier label="Triage item" value={item.id} />
            <Identifier label="Communication" value={item.communicationId} />
            <Identifier label="Thread" value={item.threadId} />
            <Identifier label="Connection" value={item.connectionId} />
            <Identifier label="Project" value={item.projectId} />
            <Identifier label="Ask" value={item.askId} />
            <Identifier label="Run" value={item.runId} />
            <Identifier label="Task" value={item.taskId} />
            <Identifier label="Model version" value={item.interpretation?.modelVersion} />
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-t border-slate-200 bg-slate-50 p-4">
        {item.agentProposal && ['pending', 'failed'].includes(item.agentProposal.status) && <button type="button" disabled={busy} onClick={() => void onUpdate(item, { action: 'approve_agent_proposal' })} className="rounded-lg bg-violet-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50">Approve action</button>}
        {item.agentProposal && ['pending', 'failed'].includes(item.agentProposal.status) && <button type="button" disabled={busy} onClick={() => void onUpdate(item, { action: 'reject_agent_proposal' })} className="rounded-lg border border-red-200 bg-white px-3 py-2 text-xs font-bold text-red-700 disabled:opacity-50">Reject action</button>}
        {activeDispositions.has(item.disposition) && <button type="button" disabled={busy} onClick={() => void onUpdate(item, { disposition: 'resolved', action: 'resolve' })} className="flex items-center gap-1 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-700 disabled:opacity-50"><Check size={14} /> Resolve</button>}
        {activeDispositions.has(item.disposition) && <button type="button" disabled={busy} onClick={() => void onUpdate(item, { disposition: 'ignored', action: 'ignore' })} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-50">Ignore</button>}
      </div>
    </>
  );
};

const GenericDetail: React.FC<{ selection: Exclude<TriageSelection, { kind: 'email' } | { kind: 'digest' }>; replayingId: string | null; onReplay: (jobId: string) => Promise<void> }> = ({ selection, replayingId, onReplay }) => {
  if (selection.kind === 'job') {
    const { job } = selection;
    return <><div className="border-b border-slate-200 p-5"><h2 id="triage-detail-title" className="pr-10 text-xl font-black text-slate-900">Agent inbox job</h2><p className="mt-2 text-sm capitalize text-slate-500">{job.channel} · {formatLabel(job.status)}</p></div><div className="flex-1 overflow-y-auto p-5"><dl className="rounded-xl border border-slate-200 px-4"><DetailRow label="Status" value={formatLabel(job.status)} /><DetailRow label="Attempts" value={job.attemptCount} /><DetailRow label="Created" value={formatDate(job.createdAt)} /><DetailRow label="Updated" value={formatDate(job.updatedAt)} /><DetailRow label="Routing" value={job.routing ? `${formatLabel(job.routing.kind)} · ${formatLabel(job.routing.reason)} · ${Math.round(job.routing.confidence * 100)}%` : undefined} />{job.error && <DetailRow label="Error" value={<span className="text-red-700">{job.error}</span>} />}</dl><div className="mt-4 space-y-3"><Identifier label="Job" value={job.id} /><Identifier label="Communication" value={job.communicationId} /><Identifier label="Event" value={job.eventId} /><Identifier label="Thread" value={job.threadId} /><Identifier label="Response communication" value={job.responseCommunicationId} /><Identifier label="Response draft" value={job.responseDraftId} /></div></div>{['failed', 'needs_review'].includes(job.status) && <div className="border-t border-slate-200 bg-slate-50 p-4"><button type="button" onClick={() => void onReplay(job.id)} disabled={replayingId === job.id} className="flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"><RotateCcw size={14} /> Replay job</button></div>}</>;
  }
  if (selection.kind === 'coaching') {
    const { session } = selection;
    return <><div className="border-b border-slate-200 p-5"><h2 id="triage-detail-title" className="pr-10 text-xl font-black text-slate-900">Coaching call</h2><p className="mt-2 text-sm capitalize text-slate-500">{formatLabel(session.status)} · {session.disposition || 'No disposition'}</p></div><div className="flex-1 overflow-y-auto p-5"><dl className="rounded-xl border border-slate-200 px-4"><DetailRow label="Summary" value={session.summary} /><DetailRow label="Progress" value={session.progress} /><DetailRow label="Blockers" value={session.blockers} /><DetailRow label="Commitments" value={session.commitments} /><DetailRow label="Next actions" value={session.nextActions} /><DetailRow label="Attempts" value={session.attemptCount} /><DetailRow label="Updated" value={formatDate(session.updatedAt)} />{session.failureReason && <DetailRow label="Failure" value={<span className="text-red-700">{session.failureReason}</span>} />}</dl><div className="mt-4 space-y-3"><Identifier label="Session" value={session.id} /><Identifier label="Project" value={session.projectId} /><Identifier label="Schedule run" value={session.scheduleRunId} /><Identifier label="Communication" value={session.communicationId} /><Identifier label="Transcript" value={session.transcriptId} /></div></div></>;
  }
  if (selection.kind === 'external') {
    const { action } = selection;
    return <><div className="border-b border-slate-200 p-5"><h2 id="triage-detail-title" className="pr-10 text-xl font-black capitalize text-slate-900">{formatLabel(action.kind)}</h2><p className="mt-2 text-sm capitalize text-slate-500">{action.status}</p></div><div className="flex-1 overflow-y-auto p-5"><dl className="rounded-xl border border-slate-200 px-4"><DetailRow label="Started" value={formatDate(action.startedAt)} /><DetailRow label="Completed" value={formatDate(action.completedAt)} />{action.error && <DetailRow label="Error" value={<span className="text-red-700">{action.error}</span>} />}{action.response && <DetailRow label="Provider response" value={<pre className="overflow-x-auto whitespace-pre-wrap text-xs">{JSON.stringify(action.response, null, 2)}</pre>} />}</dl><div className="mt-4 space-y-3"><Identifier label="Receipt" value={action.id} /><Identifier label="Project" value={action.projectId} /><Identifier label="Idempotency key" value={action.idempotencyKey} /><Identifier label="Request hash" value={action.requestHash} /></div></div></>;
  }
  const { schedule } = selection;
  return <><div className="border-b border-slate-200 p-5"><h2 id="triage-detail-title" className="pr-10 text-xl font-black text-slate-900">{schedule.name}</h2><p className="mt-2 text-sm capitalize text-slate-500">{schedule.enabled ? 'Enabled' : 'Disabled'} · {formatLabel(schedule.activity)}</p></div><div className="flex-1 overflow-y-auto p-5"><dl className="rounded-xl border border-slate-200 px-4"><DetailRow label="Next run" value={formatDate(schedule.nextRunAt)} /><DetailRow label="Timezone" value={schedule.timezone} /><DetailRow label="Recurrence" value={schedule.recurrence.kind === 'daily' ? `Daily at ${schedule.recurrence.localTime}` : `Every ${schedule.recurrence.intervalMinutes} minutes`} /><DetailRow label="Misfire policy" value={formatLabel(schedule.misfirePolicy)} /><DetailRow label="Updated" value={formatDate(schedule.updatedAt)} /></dl><div className="mt-4 space-y-3"><Identifier label="Schedule" value={schedule.id} /><Identifier label="Project" value={schedule.projectId} />{'connectionId' in schedule && <Identifier label="Connection" value={schedule.connectionId} />}</div><div className="mt-4 flex gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 shrink-0" size={16} /> Detailed per-run records are not exposed by the current UI API yet.</div></div></>;
};

export const TriageDetailDrawer: React.FC<TriageDetailDrawerProps> = ({ selection, items, agentJobs, updatingId, replayingId, onClose, onSelectEmail, onUpdate, onReplayAgentJob }) => {
  useEffect(() => {
    if (!selection) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selection, onClose]);

  if (!selection) return null;
  const matchingJob = selection.kind === 'email'
    ? agentJobs.find(job => job.communicationId === selection.item.communicationId)
    : undefined;

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-labelledby="triage-detail-title">
      <button type="button" aria-label="Close details" onClick={onClose} className="absolute inset-0 bg-slate-950/30 backdrop-blur-[1px]" />
      <aside className="relative flex h-full w-full max-w-2xl flex-col bg-white shadow-2xl">
        <button type="button" onClick={onClose} className="absolute right-4 top-4 z-10 rounded-lg border border-slate-200 bg-white p-2 text-slate-500 shadow-sm hover:text-slate-900" aria-label="Close details"><X size={18} /></button>
        {selection.kind === 'email' && <EmailDetail key={selection.item.id} item={selection.item} matchingJob={matchingJob} busy={updatingId === selection.item.id} onUpdate={onUpdate} />}
        {selection.kind === 'digest' && <><div className="border-b border-slate-200 p-5"><h2 id="triage-detail-title" className="pr-10 text-xl font-black text-slate-900">Daily digest</h2><p className="mt-2 text-sm text-slate-500">{formatDate(selection.digest.scheduledFor)} · {formatLabel(selection.digest.deliveryStatus)}</p></div><div className="flex-1 overflow-y-auto p-5"><div className="grid grid-cols-3 gap-2"><div className="rounded-xl bg-slate-50 p-3 text-center"><div className="text-xl font-black text-slate-900">{selection.digest.counts.total}</div><div className="text-xs text-slate-500">New</div></div><div className="rounded-xl bg-amber-50 p-3 text-center"><div className="text-xl font-black text-amber-800">{selection.digest.counts.outstanding}</div><div className="text-xs text-amber-700">Outstanding</div></div><div className="rounded-xl bg-indigo-50 p-3 text-center"><div className="text-xl font-black text-indigo-800">{selection.digest.counts.draftsPrepared}</div><div className="text-xs text-indigo-700">Drafts</div></div></div><p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selection.digest.summary}</p>{selection.digest.deliveryError && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{selection.digest.deliveryError}</p>}<h3 className="mb-2 mt-6 text-xs font-black uppercase tracking-wide text-slate-400">Included communications</h3><div className="space-y-2">{selection.digest.itemIds.map(id => { const item = items.find(candidate => candidate.id === id); return item ? <button key={id} type="button" onClick={() => onSelectEmail(item)} className="flex w-full items-center justify-between gap-3 rounded-xl border border-slate-200 p-3 text-left hover:border-indigo-300 hover:bg-indigo-50/30"><span className="min-w-0"><span className="block truncate text-sm font-bold text-slate-800">{item.subject || item.sender || 'Communication'}</span><span className="mt-1 block text-xs text-slate-500">{item.sender} · {formatDate(item.occurredAt)}</span></span><Link2 className="shrink-0 text-slate-400" size={15} /></button> : <div key={id} className="rounded-xl border border-slate-200 p-3 font-mono text-xs text-slate-500">{id}</div>; })}{!selection.digest.itemIds.length && <p className="rounded-xl border border-dashed border-slate-300 p-5 text-center text-sm text-slate-500">No individual communications were included.</p>}</div></div></>}
        {!['email', 'digest'].includes(selection.kind) && <GenericDetail selection={selection as Exclude<TriageSelection, { kind: 'email' } | { kind: 'digest' }>} replayingId={replayingId} onReplay={onReplayAgentJob} />}
      </aside>
    </div>
  );
};
