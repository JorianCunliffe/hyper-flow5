import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {ScheduleRecoveryPanel} from '../../components/ScheduleRecoveryPanel';
const at=Date.parse('2026-10-04T23:00:00Z');
const next=Date.parse('2026-10-12T23:00:00Z');
const schedule:any={id:'schedule_fixture',name:'Fixture daily coaching',nextRunAt:at,timezone:'Australia/Brisbane'};
function Fixture(){
 const [mode,setMode]=useState('unknown');const [open,setOpen]=useState(true);const [saved,setSaved]=useState(0);
 const transport=async(b:any)=>{
  if(b.operation==='preview')return mode==='partial'?{pending:{requestId:'fixture_saved_command',decision:'resume_future'},timezone:schedule.timezone}:{planHash:'fixture',reviewedAt:Date.now(),nextRunAt:next,timezone:schedule.timezone,evidence:{outcome:mode==='safe'?'not_dispatched':'unknown',receiptStatus:mode==='safe'?'missing':'reserved'},canRetry:mode==='safe',recipient:'+61400000000',explanation:'Isolated fixture: no provider calls or production changes.'};
  if(mode==='stale')throw Error('The schedule or provider evidence changed. Review again');
  setSaved(n=>n+1);return {requestId:b.requestId,decision:b.decision || 'resume_future',originalScheduledFor:at,originalOutcome:mode==='safe'?'not_dispatched':'unknown',nextRunAt:next,timezone:schedule.timezone,callDispatched:false};
 };
 return <main><h1>Schedule recovery browser fixture</h1><p>No provider or production access. Saved fixture decisions: {saved}</p><label>Fixture scenario<select value={mode} onChange={e=>{setMode(e.target.value);setOpen(true);}}><option value="unknown">Uncertain old call</option><option value="safe">Verified non-dispatch</option><option value="stale">Stale review</option><option value="partial">Interrupted save</option></select></label>{open?<div key={mode}><ScheduleRecoveryPanel schedule={schedule} transport={transport} onClose={()=>setOpen(false)} onApplied={async()=>{}}/></div>:<button onClick={()=>setOpen(true)}>Resolve held run</button>}</main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);

