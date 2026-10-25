import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ServiceConfigurationPanel } from '../../components/ServiceConfigurationPanel';
import { MilestoneNode } from '../../components/MilestoneNode';
import { NodeType } from '../../types';

const nextTime = () => { const date = new Date(); date.setUTCHours(23, 0, 0, 0); if (+date <= Date.now()) date.setUTCDate(date.getUTCDate()+1); return +date; };
const schedule: any = { id: 'schedule_fixture_progress', name: 'Fixture coaching', enabled: true, timezone: 'Australia/Brisbane', nextRunAt: nextTime() };
const project: any = { id: 'progress-fixture', name: 'Fixture coaching', projectData: { project_template: 'daily_coaching' } };
let phase = sessionStorage.getItem('fixture-phase') || 'idle';
let at = Number(sessionStorage.getItem('fixture-at') || 0), requests = 0;
const response = (body: any) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const request: any = async (input: string, init: any) => {
  if (input === '/api/schedules/run') {
    requests++; at = JSON.parse(init.body).scheduledFor; phase = 'running'; schedule.enabled = true; schedule.nextRunAt = nextTime();
    sessionStorage.setItem('fixture-at', String(at)); sessionStorage.setItem('fixture-phase', phase);
    await new Promise(resolve => setTimeout(resolve, 6000));
    return response({ scheduledFor: at, nextRunAt: schedule.nextRunAt, scheduleEnabled: true, result: { status: 'deferred' } });
  }
  if (input === '/api/schedules' && init?.method === 'PATCH') {
    schedule.enabled = JSON.parse(init.body).enabled;
    if (schedule.enabled) schedule.nextRunAt = nextTime();
    return response({ schedule });
  }
  if (input.includes('progress=true')) {
    if (phase === 'offline') throw new TypeError('Failed to fetch');
    const review = phase === 'review';
    return response({ progress: at ? { projectId: project.id, scheduleId: schedule.id, scheduledFor: at,
      status: phase === 'idle' ? 'completed' : review ? 'waiting' : phase, awaitingReview: review, canStartNewRun: review,
      nodes: review ? [{ id: 'EXTRACT', name: 'Extract coaching outcome', status: 'waiting' }]
        : ['running','waiting','failed'].includes(phase) ? [{ id: 'CALL', name: 'Daily coaching call', status: phase }] : [] } : null });
  }
  return response({ schedules: [schedule], lastRun: null, scheduler: {} });
};

function Fixture() {
  const [progress, setProgress] = useState<any>(null), [mode, setMode] = useState(phase), [revision, setRevision] = useState(1);
  return <main className="p-8">
    <h1 className="text-xl font-bold">Isolated run progress test — no provider calls</h1>
    <label>Simulated state <select aria-label="Simulated state" value={mode} onChange={event => {
      phase = event.target.value; setMode(phase); sessionStorage.setItem('fixture-phase', phase);
    }}>{['idle','running','waiting','review','held','completed','failed','cancelled','offline'].map(state => <option key={state}>{state}</option>)}</select></label>
    <button onClick={() => { phase = 'idle'; at = 0; schedule.enabled = false; schedule.nextRunAt = Date.now()-86400000;
      sessionStorage.removeItem('fixture-at'); sessionStorage.removeItem('fixture-phase'); setMode('idle'); setRevision(n=>n+1);
    }}>Reset paused fixture</button>
    <ServiceConfigurationPanel key={revision} project={{...project,updatedAt:revision}} request={request} onConfigure={()=>{}} onProgress={setProgress}/>
    <p>Tracked occurrence: {progress?.scheduledFor || 'none'}. Start requests this page: {requests}</p>
    <div className="relative h-80"><MilestoneNode {...({ milestone: { id: 'CALL', name: 'Daily coaching call', nodeType: NodeType.PHONE_CALL,
      x: 250, y: 150, subtasks: [], actionConfig: {} }, executionStatus: progress?.nodes[0]?.status, parents: [], children: [],
      onHover: ()=>{}, settings: {}, projectData: {}, projectName: 'Fixture', projectTimeUnit: 'days', duration: 1 } as any)}/></div>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
