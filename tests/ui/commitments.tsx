import React from 'react';
import { createRoot } from 'react-dom/client';
import { CommitmentsPanel } from '../../components/CommitmentsPanel';
import { firebaseService } from '../../services/firebaseService';
import { createCommitment, transitionCommitment, commitmentTiming, type Commitment } from '../../lib/commitments/model';
let rows:Commitment[]=[];let sequence=0;
firebaseService.authorizedFetch=async(input,options={})=>{
  const url=new URL(String(input),'http://fixture');const body=options.body?JSON.parse(String(options.body)):null;
  document.getElementById('request-log')!.textContent=JSON.stringify({path:url.pathname,body},null,2);
  const result=(data:unknown,status=200)=>new Response(JSON.stringify(data),{status});
  if(url.searchParams.get('view')==='parties') return result({viewerUid:'ceo',data:[{id:'user:ceo',name:'Me'},{id:'contact:alex',name:'Alex'}]});
  if(url.searchParams.get('view')==='candidates') return result({data:[],bounded:true});
  try {
    if(!body) return result({data:rows.map(row=>({...row,timing:commitmentTiming(row)})),viewerUid:'ceo',next:null});
    if(options.method==='PATCH') {
      const current=rows.find(row=>row.id===body.id)!;const next=transitionCommitment(current,body,'ceo',Date.now(),`ask_fixture_${++sequence}`);
      rows=rows.map(row=>row.id===next.id?next:row);return result({item:next,viewerUid:'ceo'});
    }
    const row=createCommitment({id:`ob_fixture_${++sequence}`,orgId:'fixture',projectId:body.projectId,actor:'ceo',terms:body.terms,now:Date.now(),askId:`ask_fixture_${sequence}`});
    rows.push(row);return result({item:row,viewerUid:'ceo'});
  } catch(error:any) { return result({error:error.message},error.status||500); }
};
createRoot(document.getElementById('root')!).render(<CommitmentsPanel projectId="alpha" orgId="fixture" projects={[{id:'alpha',name:'Alpha reporting'}] as any}/>);
