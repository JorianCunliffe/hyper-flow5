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
  const [creating,setCreating]=useState(false),[description,setDescription]=useState(''),[newPromisor,setNewPromisor]=useState<string[]>([]),[newPromisee,setNewPromisee]=useState('');
  const [beneficiaries,setBeneficiaries]=useState<string[]>([]),[conditionText,setConditionText]=useState(''),[evidenceText,setEvidenceText]=useState(''),[related,setRelated]=useState('');
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
  const choose=(row:PromiseRecord)=>{setSelected(row);setCreating(false);setDescription(row.description);setBeneficiaries(row.promisee_parties.map(p=>p.person_id||''));setRelated(row.related_promise_id||'');setReason('');setAssignments(row.promisor_parties.map(p=>p.person_id||''));setDue(row.due_interpretation?.instant||'');setTargetProject(row.external_project_id||'');setTargetThread(row.thread_id||'');};
  const refresh=async()=>setPage(await request({operation:'query',...filters}));
  const review=(reviewAction:string)=>run(async()=>{
    const patch=reviewAction==='correct'?{promisor_parties:selected!.promisor_parties.map((p,i)=>({...p,person_id:assignments[i]||null})),...(due?{due:{wording:selected!.due_interpretation?.wording||due,instant:due,status:'confirmed',precision:'instant',assumptions:[]}}:{})}:{};
    choose(await request({...filters,operation:'review',promiseId:selected!.id,expectedRevision:selected!.revision,reviewAction,reason,patch}));await refresh();
  });
  const mutate=(operation:string,patch:Record<string,unknown>={},conditionId?:string)=>run(async()=>{
    const updated=await request({...filters,operation,promiseId:selected?.id,conditionId,expectedRevision:selected?.revision,reason,patch});
    if(operation==='delete'||!updated.description){setSelected(null);}else choose(updated);
    setConditionText('');setEvidenceText('');await refresh();
  });
  const selectedParty=(id:string)=>({person_id:id,label:people.find(p=>p.id===id)?.name||id,ref:id,role:'human'});
  const partyName=(p:PromiseRecord['promisor_parties'][number],row:PromiseRecord)=>row.people.find(x=>x.id===p.person_id)?.name||p.label||'Unresolved participant';
  return <section className="mb-6 rounded-xl border border-slate-200 bg-white p-5" aria-label="Promise ledger">
    <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-bold">Promise ledger</h2><p className="text-sm text-slate-600">Captured from communications or recorded manually. “We” is a joint promise by both participants. Business acceptance remains a separate review.</p></div><div className="flex gap-2"><button className={control} disabled={busy||!projectId} onClick={()=>{setCreating(true);setSelected(null);setDescription('');setReason('');setNewPromisor([]);setNewPromisee('');}}>New promise</button><button className={control} disabled={busy} onClick={()=>run(refresh)}>Refresh ledger</button></div></div>
    <div className="my-4 flex flex-wrap items-end gap-3">
      <label className="text-sm">Person<select aria-label="Promise person" className={`${control} ml-2`} value={person} onChange={e=>setPerson(e.target.value)}><option value="">All people</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="text-sm">Thread<input aria-label="Promise thread" className={`${control} ml-2`} value={thread} onChange={e=>setThread(e.target.value)} placeholder="All threads"/></label>
      <label className="text-sm">View<select className={`${control} ml-2`} value={direction} onChange={e=>setDirection(e.target.value)}><option value="">All promises</option><option value="owing" disabled={!person}>Promised by selected person</option><option value="owed" disabled={!person}>Owed to selected person</option></select></label>
      <label className="text-sm"><input type="checkbox" checked={unresolved} onChange={e=>setUnresolved(e.target.checked)}/> Unresolved associations</label>
    </div>
    {creating&&<form className="my-4 space-y-3 rounded-lg border p-4" onSubmit={e=>{e.preventDefault();void mutate('create',{description,promisor_parties:newPromisor.map(selectedParty),joint:newPromisor.length>1,promisee_parties:newPromisee?[selectedParty(newPromisee)]:[]});}}>
      <h3 className="font-bold">New promise</h3><label className="block">What was promised?<textarea required className={`${control} w-full`} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="block">Promisor<select multiple required className={control} value={newPromisor} onChange={e=>setNewPromisor(Array.from(e.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>,o=>o.value))}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block">Promisee<select className={control} value={newPromisee} onChange={e=>setNewPromisee(e.target.value)}><option value="">Unspecified</option>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block">Reason<textarea required className={`${control} w-full`} value={reason} onChange={e=>setReason(e.target.value)}/></label>
      <button className={control} disabled={busy||!description.trim()||!newPromisor.length||!reason.trim()}>Create promise</button><button type="button" className={control} onClick={()=>setCreating(false)}>Cancel</button>
    </form>}
    {error&&<p role="alert" className="my-3 text-sm text-red-700">{error}</p>}
    {busy&&<p role="status" className="text-sm text-slate-500">Loading promise evidence…</p>}
    <div className="grid gap-4 lg:grid-cols-2"><div className="space-y-2">
      {page?.data.map(row=><button key={row.id} className={`w-full rounded-lg border p-3 text-left ${selected?.id===row.id?'border-indigo-500 bg-indigo-50':'border-slate-200'}`} onClick={()=>run(async()=>choose(await request({...filters,operation:'read',promiseId:row.id})))}>
        <strong className="block">{row.description}</strong><span className="block text-sm">{row.joint?'Joint promisors: ':'Promisor: '}{row.promisor_parties.map(p=>partyName(p,row)).join(' + ')}</span>
        <span className="block text-xs text-slate-600">{row.observed_state.replaceAll('_',' ')} · {row.review_state.replaceAll('_',' ')} · {row.source_type==='manual'?'Manual entry':row.origin==='agent'?'Agent-origin speech':'Human speech'}{row.unresolved?' · Needs association review':''}{!row.source_current?' · Source changed':''}</span>
        <span className="block text-xs text-slate-500">Project: {row.external_project_id||'Unassigned'} · Thread: {row.thread_id||'Unassigned'}</span>
        {row.due_interpretation?.wording&&<span className="block text-xs">Due wording: {row.due_interpretation.wording} ({row.due_interpretation.status?.replaceAll('_',' ')})</span>}
      </button>)}
      {page&&!page.data.length&&!busy&&<p className="text-sm text-slate-600">No promises on this page. Check processing coverage for pending or failed extraction.</p>}
      {page?.next&&<button className={control} disabled={busy} onClick={()=>run(async()=>{const next=await request({...filters,operation:'query',after:page.next});setPage({...next,data:[...page.data,...next.data]});})}>Load more promises</button>}
    </div>{selected&&<article className="rounded-lg bg-slate-50 p-4"><h3 className="font-bold">Review promise evidence</h3>
      {selected.evidence.map(e=><blockquote key={e.id} className="my-3 border-l-2 border-indigo-300 pl-3 text-sm"><p>{e.quote}</p><footer className="text-xs text-slate-500">{e.speaker.label||'Human reviewer'} · {e.kind.replaceAll('_',' ')} · {!e.communication_id?'Human evidence':e.current?'Current source':'Earlier source revision'}</footer></blockquote>)}
      <div className="space-y-2">{selected.promisor_parties.map((p,i)=><label key={`${p.ref}:${i}`} className="block text-sm">{selected.joint?'Joint participant':'Promisor'}: {p.label}<select className={`${control} ml-2`} value={assignments[i]||''} onChange={e=>setAssignments(prior=>prior.map((v,j)=>i===j?e.target.value:v))}><option value="">Unresolved identity</option>{people.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}</select></label>)}</div>
      <div className="mt-2 flex gap-2"><button className={control} disabled={busy} onClick={()=>{setSelected({...selected,promisor_parties:[...selected.promisor_parties,{ref:`participant-${selected.promisor_parties.length}`,person_id:null,label:'Additional promisor',role:'human'}]});setAssignments([...assignments,'']);}}>Add promisor</button><button className={control} disabled={busy||selected.promisor_parties.length<2} onClick={()=>{setSelected({...selected,promisor_parties:selected.promisor_parties.slice(0,-1)});setAssignments(assignments.slice(0,-1));}}>Remove last promisor</button><label><input type="checkbox" checked={selected.joint} onChange={e=>setSelected({...selected,joint:e.target.checked})}/> Joint promise</label></div>
      <label className="mt-3 block text-sm">Current terms<textarea className={`${control} w-full`} maxLength={1000} value={description} onChange={e=>setDescription(e.target.value)}/></label>
      <label className="mt-3 block text-sm">Promisees<select multiple className={`${control} w-full`} value={beneficiaries.filter(Boolean)} onChange={e=>setBeneficiaries(Array.from(e.currentTarget.selectedOptions as HTMLCollectionOf<HTMLOptionElement>,o=>o.value))}>{people.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="mt-3 block text-sm">Related promise ID<input className={`${control} w-full`} value={related} onChange={e=>setRelated(e.target.value)} placeholder="Optional"/></label>
      <label className="mt-3 block text-sm">Confirmed deadline, including timezone offset<input className="mt-1 w-full rounded-lg border p-2" value={due} onChange={e=>setDue(e.target.value)} placeholder="2026-09-25T17:00:00+10:00"/></label>
      <label className="mt-3 block text-sm">Evidence or reason<textarea className="mt-1 w-full rounded-lg border p-2" value={reason} onChange={e=>setReason(e.target.value)} placeholder="What supports this review decision?"/></label>
      <div className="mt-3 flex flex-wrap gap-2"><button className={control} disabled={busy||!reason.trim()||!description.trim()} onClick={()=>mutate('update',{description,promisor_parties:selected.promisor_parties.map((p,i)=>({...p,person_id:assignments[i]||null})),promisee_parties:[...beneficiaries.filter(Boolean).map(selectedParty),...(beneficiaries.includes('')?selected.promisee_parties.filter(p=>!p.person_id):[])],joint:selected.joint,related_promise_id:related||null,due:due?{instant:due,status:'confirmed',wording:due}:{} })}>Save terms</button>
        <button className={control} disabled={busy||!reason.trim()} onClick={()=>{if(window.confirm('Delete this promise? Its evidence and history will be retained.'))void mutate('delete');}}>Delete promise</button>{[['confirm','Confirm extraction'],['completion_claimed','Record completion claim'],['verify_fulfillment','Verify fulfillment'],['dismiss','Dismiss']].map(([action,label])=><button key={action} className={control} disabled={busy||!reason.trim()||(['confirm','verify_fulfillment'].includes(action)&&!selected.source_current)||(action==='verify_fulfillment'&&selected.conditions?.some(c=>c.status==='pending'))} onClick={()=>review(action)}>{label}</button>)}
        <button className={control} disabled={busy||!selected.external_project_id||!selected.source_current||['dismissed','retracted'].includes(selected.review_state)} onClick={()=>run(()=>onImport(selected))}>Review as business obligation</button>
      </div>
      <div className="mt-4 space-y-2"><h4 className="font-semibold">Conditions</h4><p className="text-xs">Confirm conditions separately before verifying fulfillment.</p>
        {selected.conditions?.map(c=><div key={c.id} className="rounded border p-2 text-sm"><p>{c.description} · {c.status}</p><button className={control} disabled={busy||!reason.trim()} onClick={()=>{const value=window.prompt('Condition description',c.description);if(value?.trim())void mutate('condition_update',{description:value},c.id);}}>Edit</button><select aria-label={`Status: ${c.description}`} className={control} disabled={busy||!reason.trim()} value={c.status} onChange={e=>mutate('condition_update',{status:e.target.value},c.id)}><option value="pending">Pending</option><option value="satisfied">Satisfied</option><option value="waived">Waived</option></select><button className={control} disabled={busy||!reason.trim()} onClick={()=>mutate('condition_delete',{},c.id)}>Remove</button></div>)}
        <label className="block text-sm">New condition<input className={`${control} w-full`} value={conditionText} onChange={e=>setConditionText(e.target.value)}/></label><button className={control} disabled={busy||!reason.trim()||!conditionText.trim()} onClick={()=>mutate('condition_create',{description:conditionText})}>Add condition</button>
        <label className="block text-sm">Human evidence<textarea className={`${control} w-full`} value={evidenceText} onChange={e=>setEvidenceText(e.target.value)}/></label><button className={control} disabled={busy||!reason.trim()||!evidenceText.trim()} onClick={()=>mutate('evidence_add',{quote:evidenceText})}>Attach evidence</button>
      </div>
      {projects.length>0&&<details className="mt-4 text-sm"><summary>Correct project or thread</summary><p className="my-2">Move the current promise terms to a project or thread. Source evidence is retained. Record the reason above.</p>
        <label className="block">Project<select className={`${control} ml-2`} value={targetProject} onChange={e=>{setTargetProject(e.target.value);setTargetThread('');}}><option value="">Choose project</option>{projects.map(p=><option key={p.id} value={String(p.id)}>{p.name}</option>)}</select></label>
        <label className="mt-2 block">Thread<input className={`${control} ml-2`} value={targetThread} onChange={e=>setTargetThread(e.target.value)} placeholder="Blank leaves unassigned"/></label>
        <button className={`${control} mt-2`} disabled={busy||!reason.trim()||!targetProject} onClick={()=>run(async()=>{await request({...filters,operation:'update',promiseId:selected.id,expectedRevision:selected.revision,patch:{external_project_id:targetProject,thread_id:targetThread||null},reason});setSelected(null);await refresh();})}>Save promise association</button>
      </details>}
      <details className="mt-4 text-sm"><summary>Promise history</summary>{selected.history?.map(h=><p key={h.id} className="my-2">{new Date(h.created_at).toLocaleString()} · {h.action.replaceAll('_',' ')}: {h.reason}</p>)}</details>
    </article>}</div>
    <div className="mt-4 border-t pt-3"><button className={control} disabled={busy} onClick={()=>run(async()=>setCoverage(await request({...filters,operation:'coverage'})))}>Check processing coverage</button>
      {coverage&&<div className="mt-2 text-sm" role="status"><p>This page: {coverage.data.length} source revisions · {coverage.data.filter(r=>r.status==='done').length} processed · {coverage.data.filter(r=>r.status==='pending'||r.status==='processing').length} pending · {coverage.data.filter(r=>r.status==='failed').length} failed.</p>
        {coverage.next!==null&&<button className={control} disabled={busy} onClick={()=>run(async()=>{const next=await request({...filters,operation:'coverage',offset:coverage.next});setCoverage({...next,data:[...coverage.data,...next.data]});})}>Load more processing records</button>}</div>}
    </div>
  </section>;
}
