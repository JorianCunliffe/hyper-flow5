/** Provider-free browser fixture. All file and transcription requests stay in this transport. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MeetingsPanel } from '../../components/MeetingsPanel';
import { firebaseService } from '../../services/firebaseService';
let file:any=null, queued=false, polls=0,imports=0;
const saved:any[]=[];
firebaseService.getCurrentOrgId=()=> 'fixture';
firebaseService.getCurrentUser=()=>({uid:'fixture-user'}) as any;
firebaseService.authorizedFetch=async(input:any,init?:RequestInit)=>{
  const url=new URL(String(input),location.origin),body=init?.body?JSON.parse(String(init.body)):null;
  if(url.pathname==='/api/contacts')return Response.json({data:[{id:'jorian',name:'Jorian',email:'jorian@example.test'}]});
  if(url.pathname==='/api/files'){
    if(body.operation==='start')file={...body,state:'uploading',offset:0};
    if(body.operation==='chunk')file={...file,state:'ready',offset:file.bytes};
    return Response.json({file});
  }
  if(body?.operation==='audio_start'){queued=true;return Response.json({fileId:file.id,name:file.name,status:'pending'});}
  if(url.searchParams.get('audio')==='1'){
    if(!url.searchParams.get('fileId'))return Response.json({data:file?[{fileId:file.id,name:file.name}]:[],next:null});
    polls++;return Response.json({fileId:file.id,name:file.name,status:queued?'done':'not_queued',segments:[{id:'audio-1',speakerId:null,speaker:'A',text:'We discussed the inspection schedule.',startMs:0,endMs:5000}]});
  }
  if(body){imports++;const row={id:`meeting-${imports}`,title:body.title,recorded_at:body.occurredAt,metadata:{...body,version:1}};saved.push(row);document.getElementById('fixture-status')!.textContent=`Imports: ${imports}; transcription polls: ${polls}`;return Response.json({item:row,receipt:{id:row.id,version:1,duplicate:false}});}
  if(url.searchParams.has('id'))return Response.json({item:saved.find(r=>r.id===url.searchParams.get('id'))});
  return Response.json({data:saved,next:null});
};
createRoot(document.getElementById('root')!).render(<main className="mx-auto max-w-6xl p-6"><p className="mb-4 rounded bg-amber-100 p-3">Fixture only — no provider calls or tenant data. <span id="fixture-status">Imports: 0</span></p><MeetingsPanel orgId="fixture" projects={[{id:'sharehouse',name:'Cairns Sharehouse'}] as any} onOpenObligations={()=>{}}/></main>);
