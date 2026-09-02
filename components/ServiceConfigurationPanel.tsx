import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Inbox, Pause, Play, RefreshCw, Settings } from 'lucide-react';
import type { Project, TenantSchedule } from '../types';
import { firebaseService } from '../services/firebaseService';

export const ServiceConfigurationPanel: React.FC<{ project: Project; onConfigure: () => void; onOpenActivity?: () => void }> = ({ project, onConfigure, onOpenActivity }) => {
  const [status, setStatus] = useState<any>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const load = async () => {
    const response = await firebaseService.authorizedFetch(`/api/service-projects/status?projectId=${encodeURIComponent(String(project.id))}`);
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || 'Service status could not be loaded');
    setStatus(body);
  };
  useEffect(() => { void load().catch(e => setError(e?.message || String(e))); }, [project.id, project.updatedAt]);
  const schedule = status?.schedules?.[0] as TenantSchedule | undefined;
  const action = async (kind: 'run' | 'toggle') => {
    if (!schedule) return;
    setWorking(true); setError(undefined); setNotice(undefined);
    try {
      const response = await firebaseService.authorizedFetch(kind === 'run' ? '/api/schedules/run' : '/api/schedules', {
        method: kind === 'run' ? 'POST' : 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(kind === 'run' ? { id: schedule.id } : { id: schedule.id, enabled: !schedule.enabled })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || `${kind} failed`);
      if (kind === 'run') {
        const result = body.result || {};
        if (result.status === 'failed') throw new Error(result.error || 'Email triage failed');
        setNotice(result.status === 'deferred'
          ? `Processed ${result.processedCount || 0} message(s). More backlog is queued safely.`
          : `Run completed: ${result.processedCount || 0} message(s) processed.`);
      } else {
        setNotice(schedule.enabled ? 'Schedule paused.' : 'Schedule resumed.');
      }
      await load();
    } catch (e: any) { setError(e?.message || String(e)); }
    finally { setWorking(false); }
  };
  return <div className="mb-5 rounded-2xl border border-violet-200 bg-violet-50/60 p-4">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-black text-violet-950">Service Configuration</h3><p className="text-xs text-violet-700">{project.projectData?.project_template === 'daily_coaching' ? 'Daily Coaching' : 'Email Triage'} · {schedule?.enabled ? 'active' : 'paused or incomplete'}</p></div><div className="flex flex-wrap gap-2">{onOpenActivity && project.projectData?.project_template !== 'daily_coaching' && <button type="button" onClick={onOpenActivity} className="flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-indigo-700"><Inbox size={14} /> Open email activity</button>}<button type="button" onClick={onConfigure} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-800"><Settings size={14} /> Edit / validate</button>{schedule && <><button type="button" disabled={working} onClick={() => void action('run')} className="flex items-center gap-1 rounded-lg bg-violet-700 px-3 py-1.5 text-xs font-bold text-white"><Play size={14} /> Run now</button><button type="button" disabled={working} onClick={() => void action('toggle')} className="flex items-center gap-1 rounded-lg border border-violet-300 bg-white px-3 py-1.5 text-xs font-bold text-violet-800">{schedule.enabled ? <Pause size={14} /> : <Play size={14} />}{schedule.enabled ? 'Pause' : 'Resume'}</button></>}</div></div>
    {error ? <p className="mt-3 flex items-center gap-1 text-xs font-bold text-red-700"><AlertTriangle size={14} />{error}</p> : notice ? <p className="mt-3 flex items-center gap-1 text-xs font-bold text-emerald-700"><CheckCircle2 size={14} />{notice}</p> : !status ? <p className="mt-3 flex items-center gap-1 text-xs text-violet-700"><RefreshCw className="animate-spin" size={14} />Loading service health…</p> : null}
    {status && <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-violet-900 md:grid-cols-4"><div><b>Connection:</b> {project.projectData?.triage_connection_id || project.projectData?.coaching_workspace_connection_id || 'missing'}</div><div><b>Previous:</b> {status.lastRun ? `${status.lastRun.status} · ${status.lastRun.processedCount ?? 0}` : 'none'}</div><div><b>Next:</b> {schedule ? new Date(schedule.nextRunAt).toLocaleString() : 'not scheduled'}</div><div className="flex items-center gap-1">{status.scheduler?.overdue ? <AlertTriangle size={14} className="text-amber-600" /> : <CheckCircle2 size={14} className="text-emerald-600" />}<b>Tick:</b> {status.scheduler?.lastTickAt ? new Date(status.scheduler.lastTickAt).toLocaleString() : 'never'}</div></div>}
    {status?.lastDigest?.summary && <p className="mt-3 line-clamp-2 rounded-lg bg-white/80 p-2 text-xs text-violet-900"><b>Last digest:</b> {status.lastDigest.summary}</p>}
    {status?.scheduler?.warning && <p className="mt-2 text-xs font-bold text-amber-700">{status.scheduler.warning}</p>}
  </div>;
};
