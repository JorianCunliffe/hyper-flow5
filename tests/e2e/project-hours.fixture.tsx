import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ProjectHoursEditor } from '../../components/ProjectHoursEditor';
import { NodeConfigModal } from '../../components/modals/NodeConfigModal';
import { checkProjectHours, normalizeProjectHours, type ProjectOperatingHours } from '../../lib/projectHours';
import { NodeType, type Milestone } from '../../types';
function Fixture() {
  const [hours,setHours]=useState<ProjectOperatingHours>();
  const [saved,setSaved]=useState('');
  const [selected,setSelected]=useState<Milestone>();
  const [result,setResult]=useState<Record<string,unknown>>({});
  const [error,setError]=useState('');
  const nodes:Milestone[]=[{id:'H',name:'Check project hours',nodeType:NodeType.CHECK_HOURS,subtasks:[],dependsOn:[],estimatedDuration:1,actionConfig:{template:'{}',autoExecute:true}},
    {id:'W',name:'Wait until opening',nodeType:NodeType.WAIT,subtasks:[],dependsOn:[],estimatedDuration:1,waitConfig:{kind:'timer',resumeAtPath:'hours_next_open_at'}}];
  return <main><h1>Project hours fixture — no provider calls</h1><ProjectHoursEditor value={hours} onChange={setHours}/>
    <button onClick={()=>{try{setSaved(JSON.stringify(normalizeProjectHours(hours),null,2));setError('');}catch(e:any){setError(e.message);}}}>Save fixture settings</button>
    <button onClick={()=>setResult(checkProjectHours(hours,Date.parse('2026-10-12T00:00:00Z')))}>Check Monday 10 am Brisbane</button>
    <button onClick={()=>setResult(checkProjectHours(hours,Date.parse('2026-10-12T09:00:00Z')))}>Check Monday 7 pm Brisbane</button>
    {nodes.map(n=><button key={n.id} onClick={()=>setSelected(n)}>Configure {n.name}</button>)}
    {error&&<p role="alert">{error}</p>}<pre aria-label="Saved project settings">{saved}</pre><pre aria-label="Check result">{JSON.stringify(result,null,2)}</pre>
    {selected&&<NodeConfigModal milestone={selected} milestones={nodes} projectData={result} isRunning={false} onClose={()=>setSelected(undefined)} onSave={updates=>{setSaved(JSON.stringify(updates,null,2));setSelected(undefined);}} onRun={()=>setResult(checkProjectHours(hours))}/>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture/>);
