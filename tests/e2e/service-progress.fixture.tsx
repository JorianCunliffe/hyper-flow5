import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import {ServiceConfigurationPanel} from '../../components/ServiceConfigurationPanel';
import {MilestoneNode} from '../../components/MilestoneNode';
import {NodeType} from '../../types';
const schedule:any={id:'schedule_fixture_progress',name:'Fixture coaching',enabled:true,timezone:'Australia/Brisbane',nextRunAt:Date.now()+86400000};
const project:any={id:'progress-fixture',name:'Fixture coaching',projectData:{project_template:'daily_coaching'}};
let phase=sessionStorage.getItem('fixture-phase')||'idle',at=Number(sessionStorage.getItem('fixture-at')||0),requests=0;
const response=(b:any)=>new Response(JSON.stringify(b),{status:200,headers:{'content-type':'application/json'}});
const request:any=async(input:string,init:any)=>{
 if(input==='/api/schedules/run'){requests++;const body=JSON.parse(init.body);at=body.scheduledFor;phase='running';sessionStorage.setItem('fixture-at',String(at));sessionStorage.setItem('fixture-phase',phase);await new Promise(r=>setTimeout(r,6000));return response({scheduledFor:at,result:{status:'deferred'}});}
 if(input.includes('progress=true')){if(phase==='offline')throw new TypeError('Failed to fetch');return response({progress:at?{projectId:project.id,scheduleId:schedule.id,scheduledFor:at,status:phase==='idle'?'completed':phase,nodes:['running','waiting','failed'].includes(phase)?[{id:'CALL',name:'Daily coaching call',status:phase}]:[]}:null});}
 return response({schedules:[schedule],lastRun:null,scheduler:{}});
};
function Fixture(){const [p,setP]=useState<any>(null);const [mode,setMode]=useState(phase);return <main className="p-8"><h1 className="text-xl font-bold">Isolated run progress test — no provider calls</h1><label>Simulated state <select aria-label="Simulated state" value={mode} onChange={e=>{phase=e.target.value;setMode(phase);sessionStorage.setItem('fixture-phase',phase);}}>{['idle','running','waiting','held','completed','failed','cancelled','offline'].map(s=><option key={s}>{s}</option>)}</select></label><ServiceConfigurationPanel project={project} request={request} onConfigure={()=>{}} onProgress={setP}/><p>Tracked occurrence: {p?.scheduledFor||'none'}. Start requests this page: {requests}</p><div className="relative h-80"><MilestoneNode {...({milestone:{id:'CALL',name:'Daily coaching call',nodeType:NodeType.PHONE_CALL,x:250,y:150,subtasks:[],actionConfig:{}},executionStatus:p?.nodes[0]?.status,parents:[],children:[],onHover:()=>{},settings:{},projectData:{},projectName:'Fixture',projectTimeUnit:'days',duration:1} as any)}/></div></main>};createRoot(document.getElementById('root')!).render(<Fixture/>);
