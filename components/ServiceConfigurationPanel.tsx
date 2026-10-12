import React, { useEffect, useState } from 'react';
import { AlertTriangle, BrainCircuit, CheckCircle2, Inbox, Pause, Play, RefreshCw, Settings } from 'lucide-react';
import type { Project, TenantSchedule } from '../types';
import { firebaseService } from '../services/firebaseService';
import { ServiceStatusNotices } from './ServiceStatusNotices';
import { ScheduleRecoveryPanel } from './ScheduleRecoveryPanel';
import { useServiceRunProgress } from './useServiceRunProgress';
import type { ServiceRunProgress } from '../lib/serviceRunProgress';

export const ServiceConfigurationPanel: React.FC<{ project: Project; onConfigure: () => void; onOpenActivity?: (view: 'emails' | 'coaching') => void; request?:typeof firebaseService.authorizedFetch; onShowStep?:(nodeId:string)=>void; onProgress?:(progress:ServiceRunProgress|null)=>void }> = ({ project, onConfigure, onOpenActivity,onProgress,onShowStep,request=firebaseService.authorizedFetch }) => {
  const [status, setStatus] = useState<any>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const load = async () => {
    const response = await request(`/api/service-projects/status?projectId=${encodeURIComponent(String(project.id))}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Service status could not be loaded');
    setStatus(body);
  };
  useEffect(() => { void load().catch(e => setError(e?.message || String(e))); }, [project.id, project.updatedAt]);
  const schedule = status?.schedules?.[0] as TenantSchedule | undefined;
  const tracking=useServiceRunProgress(String(project.id),schedule?.id,request);
  useEffect(()=>{onProgress?.(tracking.progress);},[tracking.progress,onProgress]);
  const previousStatus = tracking.progress && tracking.progress.scheduleId===status?.lastRun?.scheduleId && tracking.progress?.scheduledFor===status?.lastRun?.scheduledFor ? tracking.progress.status : status?.lastRun?.status;
  const runLabel=tracking.checking?'Checking run status…':tracking.progress?.status==='starting'?'Starting…':tracking.progress?.status==='running'?'Running…':tracking.progress?.status==='waiting'?'Waiting…':tracking.progress?.status==='held'?'Held for review':'Run now';
  const isCoaching = project.projectData?.project_template === 'daily_coaching';
  const recoveryHeld = !!schedule?.recoveryPendingId || (!status?.lastRun?.recoveryResolution && !!(status?.lastRun?.manualReviewRequired || status?.lastRun?.recoveryReviewedAt || status?.lastRun?.status==='blocked'));
  const action = async (kind: 'run' | 'toggle') => {
    if (!schedule) return;
    if(kind==='run'&&tracking.busy)return;
    const scheduledFor=Date.now();
    if(kind==='run')tracking.start(schedule.id,scheduledFor);
    setWorking(true); setError(undefined); setNotice(undefined);
    try {
      const response = await request(kind === 'run' ? '/api/schedules/run' : '/api/schedules', {
        method: kind === 'run' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'run' ? { id: schedule.id,scheduledFor } : { id: schedule.id, enabled: !schedule.enabled })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${kind} failed`);
      if (kind === 'run') {
        if(body.scheduledFor && body.scheduledFor!==scheduledFor)tracking.start(schedule.id,body.scheduledFor);
        const result = body.result || {};
        if (result.status === 'blocked' || (result.status === 'deferred' && result.error)) { setNotice(result.error || 'Outbound operation held for review.'); await load(); return; }
        if (result.status === 'failed') throw new Error(result.error || `${isCoaching ? 'Coaching' : 'Email triage'} run failed`);
        setNotice(!isCoaching && result.status === 'deferred'
          ? `Processed ${result.processedCount || 0} message(s). More backlog is queued safely.`
          : isCoaching ? 'Coaching run started. Open coaching activity to follow the call and outcome.' : `Run completed: ${result.processedCount || 0} message(s) processed.`);
      } else {
        setNotice(schedule.enabled ? 'Schedule paused.' : 'Schedule resumed.');
      }
      await load();
    } catch (e: any) {
      if(kind==='run' && e instanceof TypeError) {
        setError('The connection ended before the run result arrived. The run may have started; do not start another call while its status is being checked.');
        try { await load(); } catch { /* Preserve the uncertain request warning. */ }
      } else setError(e?.message || String(e));
    }
    finally { setWorking(false); }
  };
  return <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-violet-950">Service Configuration</h3><p className="text-xs text-violet-700">{isCoaching ? 'Daily Coaching' : 'Email Triage'} · {!status ? 'loading schedule' : recoveryHeld ? (schedule?.enabled ? 'Enabled — blocked by recovery' : 'Paused — recovery required') : schedule?.enabled ? 'active' : 'paused or incomplete'}</p></div><div className="flex flex-wrap gap-2">{onOpenActivity && <button type="button" onClick={() => onOpenActivity(isCoaching ? 'coaching' : 'emails')} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700">{isCoaching ? <BrainCircuit size={14} /> : <Inbox size={14} />} Open {isCoaching ? 'coaching' : 'email'} activity</button>}<button type="button" onClick={onConfigure} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-800"><Settings size={14} /> Edit / validate</button>{schedule && <><button type="button" disabled={working || tracking.busy || recoveryHeld} aria-busy={tracking.busy} onClick={() => void action('run')} className="flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white">{tracking.busy ? <RefreshCw size={14} className="animate-spin motion-reduce:animate-none" /> : <Play size={14} />} {runLabel}</button><button type="button" disabled={working} onClick={() => void action('toggle')} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-800">{schedule.enabled ? <Pause size={14} /> : <Play size={14} />}{schedule.enabled ? 'Pause' : 'Resume'}</button></>}</div></div>
    {error ? <p className="mt-3 flex items-center gap-1 text-xs font-bold text-red-700"><AlertTriangle size={14} />{error}</p> : notice ? <p className="mt-3 flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} />{notice}</p> : !status ? <p className="mt-3 flex items-center gap-1 text-xs text-violet-700"><RefreshCw className="animate-spin" size={14} />Loading service health…</p> : null}
    {status && <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-violet-900 md:grid-cols-4"><div><b>Connection:</b> {project.projectData?.triage_connection_id || project.projectData?.coaching_workspace_connection_id || 'missing'}</div><div><b>Previous:</b> {status.lastRun ? isCoaching ? previousStatus : `${previousStatus} · ${status.lastRun.processedCount ?? 0}` : 'none'}</div><div><b>Next:</b> {schedule ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled'}</div><div className="flex items-center gap-1">{status.scheduler?.overdue ? <AlertTriangle size={14} className="text-amber-600" /> : <CheckCircle2 size={14} className="text-emerald-600" />}<b>Tick:</b> {status.scheduler?.lastTickAt ? new Date(status.scheduler.lastTickAt).toLocaleString() : 'never'}</div></div>}
    {status?.lastDigest && <div className="mt-3 rounded-lg bg-white/80 p-3 text-xs text-violet-900"><div className="flex flex-wrap items-center gap-2 font-bold"><span>{status.lastDigest.counts?.total ?? 0} new</span><span aria-hidden="true">·</span><span>{status.lastDigest.counts?.outstanding ?? 0} outstanding</span><span aria-hidden="true">·</span><span>{status.lastDigest.counts?.draftsPrepared ?? 0} drafts currently prepared</span></div><p className="mt-1 text-[11px] text-violet-700">Drafts cover the current outstanding set and do not necessarily correspond to every new message.</p>{status.lastDigest.summary && <details className="mt-2"><summary className="cursor-pointer font-bold text-violet-800">View digest summary</summary><p className="mt-2 whitespace-pre-wrap leading-5">{status.lastDigest.summary}</p></details>}</div>}
    {status?.scheduler?.warning && <p className="mt-2 text-xs font-bold text-amber-700">{status.scheduler.warning}</p>}
    <div role="status" aria-live="polite" className="mt-2 text-sm text-indigo-900">
      {tracking.trackingError || (tracking.progress && <><b>{tracking.progress.status==='held'?'Held for review':tracking.progress.status==='completed'?'Completed':tracking.progress.status==='failed'?'Failed':tracking.progress.status==='cancelled'?'Cancelled':tracking.progress.status==='waiting'?'Waiting':'Running'}</b>{tracking.progress.nodes.length>0?`: ${tracking.progress.nodes.map(n=>n.name).join(', ')}`:tracking.progress.status==='starting'?' — starting workflow':tracking.progress.status==='running'?' — checking current step':''}</>)}
    </div>
    {onShowStep && tracking.progress?.nodes.some(n=>n.status!=='failed') && <button type="button" className="mt-2 text-xs underline text-indigo-700" onClick={()=>onShowStep(tracking.progress!.nodes.find(n=>n.status!=='failed')!.id)}>Show current step</button>}
    {recoveryHeld && schedule && <button type="button" className="mt-3 rounded-lg bg-amber-700 px-3 py-2 text-white font-bold" onClick={()=>setRecoveryOpen(true)}>Resolve held run</button>}
    {recoveryOpen && schedule && <ScheduleRecoveryPanel schedule={schedule} onClose={()=>setRecoveryOpen(false)} onApplied={load} />}
    <ServiceStatusNotices status={status} />
  </div>;
};
