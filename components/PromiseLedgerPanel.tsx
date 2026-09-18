import React,{useEffect,useState} from 'react';
import {firebaseService} from '../services/firebaseService';
import type {PromiseRecord,PromisePage} from '../lib/communications/promiseTypes';

async function request(body:Record<string,unknown>) {
  const response=await firebaseService.authorizedFetch('/api/commitments',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'promise_ledger',...body})});
  const result=await response.json();if(!response.ok)throw new Error(result.error||'Promise ledger unavailable');return result;
}
const control='rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:opacity-40';
export function PromiseLedgerPanel({orgId,projectId,projects=[],onImport}:{orgId:string;projectId:string;projects?:Array<{id:string|number;name:string}>;onImport:(promise:PromiseRecord)=>Promise<void>}) {
  const [page,setPage]=useState<PromisePage|null>(null),[selected,setSelected]=useState<PromiseRecord|null>(null);
  const [person,setPerson]=useState(''),[thread,setThread]=useState(''),[direction,setDirection]=useState(''),[unresolved,setUnresolved]=useState(false);
  const [people,setPeople]=useState<Array<{id:string;name:string}>>([]);
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[reason,setReason]=useState('');
  const [assignments,setAssignments]=useState<string[]>([]);
  const [due,setDue]=useState(''),[targetProject,setTargetProject]=useState(''),[targetThread,setTargetThread]=useState('');
  const [coverage,setCoverage]=useState<{data:Array<{id:string;status:string;outcome:string|null;attempts:number}>;next:number|null}|null>(null);
  const filters={projectId,personId:person||undefined,threadId:thread||undefined,direction:direction||undefined,unresolved};
  useEffect(()=>{
    let active=true;setPage(null);setSelected(null);setCoverage(null);setError('');setBusy(true);
    Promise.all([request({operation:'query',...filters}),firebaseService.authorizedFetch('/api/commitments?view=parties').then(async r=>{const value=await r.json();if(!r.ok)throw new Error(value.error);return value;})])
      .then(([result,parties])=>{if(active){setPage(result);setPeople(parties.data.filter((p:{id:string})=>p.id.startsWith('contact:')).map((p:{id:string;name:string})=>({...p,id:p.id.slice(8)})));}})
      .catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[orgId,projectId,person,thread,direction,unresolved]);
  const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');try{await work();}catch(e){setError(e instanceof Error?e.message:'Promise ledger unavailable');}finally{setBusy(false);}};
  const choose=(row:PromiseRecord)=>{setSelected(row);setReason('');setAssignments(row.promisor_parties.map(p=>p.person_id||''));setDue(row.due_interpretation?.instant||'');setTargetProject(row.external_project_id||'');setTargetThread(row.thread_id||'');};
  const refresh=async()=>setPage(await request({operation:'query',...filters}));
  const review=(reviewAction:string)=>run(async()=>{
    const patch=reviewAction==='correct'?{promisor_parties:selected!.promisor_parties.map((p,i)=>({...p,person_id:assignments[i]||null})),...(due?{due:{wording:selected!.due_interpretation?.wording||due,instant:due,status:'confirmed',precision:'instant',assumptions:[]}}:{})}:{};
    choose(await request({...filters,operation:'review',promiseId:selected!.id,expectedRevision:selected!.revision,reviewAction,reason,patch}));await refresh();
  });
  const partyName=(p:PromiseRecord['promisor_parties'][number],row:PromiseRecord)=>row.people.find(x=>x.id===p.person_id)?.name||p.label||'Unresolved participant';
  return <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Promise ledger">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Promise ledger</h2><p className="text-sm text-slate-600">Automatically captured from communications. “We” is a joint promise by both participants. Business acceptance remains a separate review.</p></div><button className={control} disabled={busy} onClick={()=>run(refresh)}>Refresh ledger</button></div>
    <div className="my-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">Person<select aria-label="Promise person" className={`${control} ml-2`} value={person} onChange={e=>setPerson(e.target.value)}><option value="">All people</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-sm">Thread<input aria-label="Promise thread" className={`${control} ml-2`} value={thread} onChange={e=>setThread(e.target.value)} placeholder="All threads"/></label>
      <label className="text-sm">View<select className={`${control} ml-2`} value={direction} onChange={e=>setDirection(e.target.value)}><option value="">All promises</option><option value="owing" disabled={!person}>Promised by selected person</option><option value="owed" disabled={!person}>Owed to selected person</option></select></label>
      <label className="text-sm"><input type="checkbox" checked={unresolved} onChange={e=>setUnresolved(e.target.checked)}/> Unresolved associations</label>
    </div>
    {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {busy&&<p role="status" className="text-sm text-slate-500">Loading promise evidence…</p>}
    <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2">
      {page?.data.map(row=><button key={row.id} className={`w-full rounded-lg border p-3 text-left ${selected?.id===row.id?'border-indigo-500 bg-indigo-50':'border-slate-200'}`} onClick={()=>run(async()=>choose(await request({...filters,operation:'read',promiseId:row.id})))}>
        <strong className="block">{row.description}</strong><span className="block text-sm">{row.joint?'Joint promisors: ':'Promisor: '}{row.promisor_parties.map(p=>partyName(p,row)).join(' + ')}</span>
        <span className="block text-xs text-slate-600">{row.observed_state.replaceAll('_',' ')} · {row.review_state.replaceAll('_',' ')} · {row.origin==='agent'?'Agent-origin speech':'Human speech'}{row.unresolved?' · Needs association review':''}{!row.source_current?' · Source changed':''}</span>
        <span className="block text-xs text-slate-500">Project: {row.external_project_id||'Unassigned'} · Thread: {row.thread_id||'Unassigned'}</span>
        {row.due_interpretation?.wording&&<span className="block text-xs">Due wording: {row.due_interpretation.wording} ({row.due_interpretation.status?.replaceAll('_',' ')})</span>}
      </button>)}
      {page&&!page.data.length&&!busy&&<p className="text-sm text-slate-600">No promises on this page. Check processing coverage for pending or failed extraction.</p>}
      {page?.next&&<button className={control} disabled={busy} onClick={()=>run(async()=>{const next=await request({...filters,operation:'query',after:page.next});setPage({...next,data:[...page.data,...next.data]});})}>Load more promises</button>}
    </div>{selected&&<article className="rounded-lg bg-slate-50 p-4"><h3 className="font-bold">Review promise evidence</h3>
      {selected.evidence.map(e=><blockquote key={e.id} className="my-3 border-l-2 border-indigo-300 pl-3 text-sm"><p>{e.quote}</p><footer className="text-xs text-slate-500">{e.speaker.label} · {e.kind.replaceAll('_',' ')} · {e.current?'Current source':'Earlier source revision'}</footer></blockquote>)}
      <div className="space-y-2">{selected.promisor_parties.map((p,i)=><label key={`${p.ref}:${i}`} className="block text-sm">{selected.joint?'Joint participant':'Promisor'}: {p.label}<select className={`${control} ml-2`} value={assignments[i]||''} onChange={e=>setAssignments(prior=>prior.map((v,j)=>i===j?e.target.value:v))}><option value="">Unresolved identity</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div>
      <label className="mt-3 block text-sm">Confirmed deadline, including timezone offset<input className="mt-1 w-full rounded-lg border p-2" value={due} onChange={e=>setDue(e.target.value)} placeholder="2026-09-25T17:00:00+10:00"/></label>
      <label className="mt-3 block text-sm">Evidence or reason<textarea className="mt-1 w-full rounded-lg border p-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="What supports this review decision?"/></label>
      <div className="mt-3 flex flex-wrap gap-2">{[['correct','Save corrections'],['confirm','Confirm extraction'],['completion_claimed','Record completion claim'],['verify_fulfillment','Verify fulfillment'],['dismiss','Dismiss']].map(([action,label])=><button key={action} className={control} disabled={busy||!reason.trim()||(['confirm','verify_fulfillment'].includes(action)&&!selected.source_current)} onClick={()=>review(action)}>{label}</button>)}
        <button className={control} disabled={busy||!selected.external_project_id||!selected.source_current||['dismissed','retracted'].includes(selected.review_state)} onClick={()=>run(()=>onImport(selected))}>Review as business obligation</button>
      </div>
      {projects.length>0&&<details className="mt-4 text-sm"><summary>Correct project or thread</summary><p className="my-2">This corrects the source communication and queues fresh extraction. Record the reason above.</p>
        <label className="block">Project<select className={`${control} ml-2`} value={targetProject} onChange={e=>{setTargetProject(e.target.value);setTargetThread('');}}><option value="">Choose project</option>{projects.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}</select></label>
        <label className="mt-2 block">Thread<input className={`${control} ml-2`} value={targetThread} onChange={e=>setTargetThread(e.target.value)} placeholder="Blank creates a new thread"/></label>
        <button className={`${control} mt-2`} disabled={busy||!reason.trim()||!targetProject} onClick={()=>run(async()=>{await request({...filters,operation:'link',promiseId:selected.id,targetProjectId:targetProject,targetThreadId:targetThread,reason});setSelected(null);await refresh();})}>Correct source association</button>
      </details>}
      <details className="mt-4 text-sm"><summary>Promise history</summary>{selected.history?.map(h=><p key={h.id} className="my-2">{new Date(h.created_at).toLocaleString()} · {h.action.replaceAll('_',' ')}: {h.reason}</p>)}</details>
    </article>}</div>
    <div className="mt-4 border-t pt-3"><button className={control} disabled={busy} onClick={()=>run(async()=>setCoverage(await request({...filters,operation:'coverage'})))}>Check processing coverage</button>
      {coverage&&<div className="mt-2 text-sm" role="status"><p>This page: {coverage.data.length} source revisions · {coverage.data.filter(r=>r.status==='done').length} processed · {coverage.data.filter(r=>r.status==='pending'||r.status==='processing').length} pending · {coverage.data.filter(r=>r.status==='failed').length} failed.</p>
        {coverage.next!==null&&<button className={control} disabled={busy} onClick={()=>run(async()=>{const next=await request({...filters,operation:'coverage',offset:coverage.next});setCoverage({...next,data:[...coverage.data,...next.data]});})}>Load more processing records</button>}</div>}
    </div>
  </section>;
}
