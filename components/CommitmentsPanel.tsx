import React, { useEffect, useState } from 'react';
import { PromiseLedgerPanel } from './PromiseLedgerPanel';
import type { Project } from '../types';
import type { Commitment, CommitmentTerms, CommitmentCommand, CommitmentSource } from '../lib/commitments/model';
import { firebaseService } from '../services/firebaseService';
import { memoryEvidence } from '../lib/communications/memoryTypes';

const input = 'w-full rounded-lg border border-slate-300 bg-white p-2 text-sm text-slate-900';
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40';
const emptyTerms: CommitmentTerms = { owner: '', beneficiary: '', deliverable: '', criteria: '', dueAt: '', timezone: 'Australia/Brisbane' };
const deadline = (terms: CommitmentTerms) => {
  try { return `${new Date(terms.dueAt).toLocaleString(undefined, {timeZone: terms.timezone})} (${terms.timezone})`; }
  catch { return 'Deadline needs clarification'; }
};
async function api(path: string, body?: object, method = 'POST') {
  const response = await firebaseService.authorizedFetch(path, body ? { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Obligations are unavailable. Please try again.');
  return result;
}
export const CommitmentsPanel: React.FC<{ orgId: string; projects: Project[]; projectId: string | null; initialId?:string }> = ({ orgId, projects, projectId,initialId }) => {
  const [rows,setRows] = useState<Commitment[]>([]); const [selected,setSelected] = useState<Commitment | null>(null);
  const project = projectId || ''; const [view,setView] = useState('all'); const [party,setParty] = useState('');
  const [parties,setParties] = useState<Array<{id:string;name:string}>>([]); const [viewer,setViewer] = useState('');
  const [terms,setTerms] = useState<CommitmentTerms>(emptyTerms); const [note,setNote] = useState('');
  const [error,setError] = useState(''); const [busy,setBusy] = useState(false); const [next,setNext] = useState<string | null>(null);
  const [candidates,setCandidates] = useState<CommitmentSource[]>([]); const [sourceText,setSourceText] = useState<string[]>([]);
  const [sourceThread,setSourceThread] = useState(''); const [searched,setSearched] = useState(false);
  const [lead,setLead] = useState(24); const [follow,setFollow] = useState(false);
  const choose = (row: Commitment | null) => { setSelected(row); setTerms(row?.proposedTerms || row?.terms || { ...emptyTerms, owner: `user:${viewer}` }); setNote(''); setSourceText([]); setFollow(row?.followUp.enabled || false); setLead(row?.followUp.leadHours ?? 24); };
  const load = async (after = '') => {
    const params = new URLSearchParams({ view, projectId: project, party, after });
    const result = await api(`/api/commitments?${params}`);
    setRows(prior => after ? [...prior,...result.data] : result.data); setNext(result.next); setViewer(result.viewerUid);
  };
  useEffect(() => {
    let active = true; setRows([]); setSelected(null); setCandidates([]); setSearched(false); setSourceThread(''); setError(''); setBusy(true);
    const params = new URLSearchParams({ view, projectId: project, party });
    Promise.all([api(`/api/commitments?${params}`), api('/api/commitments?view=parties'),initialId?api(`/api/commitments?id=${encodeURIComponent(initialId)}`):Promise.resolve(null)]).then(([result,options,focused]) => {
      if (!active) return;
      setRows(result.data); setNext(result.next); setViewer(result.viewerUid); setParties(options.data);
      setTerms({ ...emptyTerms, owner: `user:${result.viewerUid}` });
      if(focused?.item)choose(focused.item);
    }).catch(failure => { if (active) setError(failure.message); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [orgId,project,view,party,initialId]);
  const run = async (operation: () => Promise<void>) => { setBusy(true); setError(''); try { await operation(); } catch (failure: any) { setError(failure.message); } finally { setBusy(false); } };
  const save = (action: CommitmentCommand['action'], decision?: CommitmentCommand['decision']) => run(async () => {
    if (!selected) return;
    const result = await api('/api/commitments', { id: selected.id, projectId: selected.projectId, expectedVersion: selected.version,
      action, askId: selected.review?.ask.id, decision, note, terms, enabled: follow, leadHours: lead }, 'PATCH');
    choose(result.item); await load();
  });
  const label = (id: string) => parties.find(row => row.id === id)?.name || id || 'Needs clarification';
  const reviewer = selected?.reviewerUid === viewer;
  const unsavedTerms = Boolean(selected && JSON.stringify(terms) !== JSON.stringify(selected.proposedTerms || selected.terms));
  const closed = selected && ['fulfilled','dismissed','cancelled'].includes(selected.state);
  return <section className="h-full overflow-auto bg-slate-50 p-4 md:p-8" aria-label="Operational obligations">
    <header className="mb-5"><h1 className="text-2xl font-bold text-slate-900">Obligations</h1>
      <p className="mt-2 text-sm text-slate-600">See what you owe, what others owe you, and what still needs agreement. Submission is not fulfillment.</p></header>
    <div className="mb-4 grid gap-3 md:grid-cols-2">
      <label>View<select className={input} value={view} onChange={e=>setView(e.target.value)}><option value="all">All obligations</option><option value="owing">I owe</option><option value="owed">Owed to me</option></select></label>
      <label>Contact or person<select className={input} value={party} onChange={e=>setParty(e.target.value)}><option value="">Everyone</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
    </div>
    {error && <p role="alert" className="mb-4 rounded-lg bg-red-50 p-3 text-red-800">{error}</p>}
    <details className="mb-3 text-sm"><summary>Find evidence in a specific communication thread</summary><label className="block mt-2">Thread reference<input className={input} value={sourceThread} onChange={e=>{setSourceThread(e.target.value);setCandidates([]);setSearched(false);}} placeholder="Paste a thread reference from Communications"/></label><p>Choose its project above. A thread lookup can include historical promise evidence; project discovery shows open extracted promises.</p></details>
    <div className="mb-4 flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={()=>run(()=>load())}>Refresh</button>
      <button className={button} disabled={busy || !project} onClick={()=>choose(null)}>New obligation</button>
      <button className={button} disabled={busy || !project} onClick={()=>run(async()=>{ const result=await api(`/api/commitments?view=candidates&projectId=${encodeURIComponent(project)}&threadId=${encodeURIComponent(sourceThread)}`); setCandidates(result.data);setSearched(true); })}>Find promise evidence</button>
    </div>
    {searched && !candidates.length && <p role="status" className="mb-3 text-sm">No current permitted promise evidence was found in this bounded view.</p>}
    {candidates.length > 0 && <aside className="mb-5 rounded-xl border border-amber-200 bg-amber-50 p-4"><h2 className="font-bold">Promise candidates — not yet accepted</h2><p className="text-sm">This is a bounded source view. Refreshing a candidate never accepts or fulfills it.</p>{candidates.map(c=><div key={c.id} className="my-3"><p>{c.wording}</p><button className={button} disabled={busy} onClick={()=>run(async()=>{ const result=await api('/api/commitments',{projectId:project,threadId:sourceThread,sourceId:c.id}); choose(result.item); await load(); })}>Review candidate</button></div>)}</aside>}
    <div key={`${orgId}:${project}`}><PromiseLedgerPanel orgId={orgId} projectId={project} projects={projects} onImport={async promise=>{
      const result=await api('/api/commitments',{projectId:promise.external_project_id,sourceId:promise.id,sourceProvider:'promise-ledger.v1'});
      choose(result.item);await load();
    }}/></div>
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="space-y-3" aria-label="Obligation list">
        {!rows.length && !busy && <p className="rounded-xl border bg-white p-5 text-slate-600">No obligations on this page. Choose a project to add one or review promise evidence.</p>}
        {rows.map(row=><button key={row.id} className={`w-full rounded-xl border bg-white p-4 text-left ${selected?.id===row.id?'border-indigo-500':'border-slate-200'}`} onClick={()=>choose(row)}>
          <strong className="block">{row.terms.deliverable || 'Unclear promise'}</strong><span className="block text-sm text-slate-600">Owner: {label(row.terms.owner)} · Beneficiary: {label(row.terms.beneficiary)}</span>
          <span className="mt-2 block text-sm">{row.state.replaceAll('_',' ')} · {row.terms.dueAt && Number.isFinite(Date.parse(row.terms.dueAt)) ? deadline(row.terms) : 'Deadline needs clarification'}</span>
          {(row as any).timing?.overdue && <span className="text-sm font-bold text-red-700">Overdue</span>}
          {(row as any).timing?.atRisk && !(row as any).timing?.overdue && <span className="text-sm font-bold text-amber-800">At risk</span>}
          {row.proposedTerms && <span className="block text-sm text-amber-800">Changed terms await approval. Previous terms still apply.</span>}
        </button>)}
        {next && <button className={button} disabled={busy} onClick={()=>run(()=>load(next))}>Load more</button>}
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-lg font-bold">{selected ? 'Review obligation' : 'Create a review candidate'}</h2>
        {selected?.review && <p className="mb-3 rounded-lg bg-indigo-50 p-3 text-indigo-900">{selected.review.ask.prompt}</p>}
        {selected?.source && <div className="mb-3 text-sm"><p>Linked communication evidence</p><p>{selected.sourceChanged ? 'Source has changed since acceptance.' : 'Acceptance is a separate human decision.'}</p><button className={button} disabled={busy} onClick={()=>run(async()=>{
          const result=await api('/api/communications/memory',{kind:selected.source!.threadId?'thread':'project',id:selected.source!.threadId || selected.projectId});
          const excerpts = memoryEvidence(result.data).filter(e=>e.sources.some(id=>selected.source!.communicationIds.includes(id))).map(e=>e.text);
          setSourceText(excerpts.length ? excerpts : ['Current source evidence is unavailable in this permitted view.']);
        })}>View current source</button>{sourceText.map((text,i)=><blockquote key={i} className="mt-2 border-l-2 pl-3">{text}</blockquote>)}</div>}
        {selected?.proposedTerms && <p className="mb-3 text-sm">Current accepted deadline: {selected.terms.dueAt}. The editor shows proposed terms.</p>}
        {unsavedTerms && selected?.review?.kind !== 'clarify' && <p role="status" className="mb-3 text-amber-800">Save the changed terms before approving an Ask. The current Ask still refers to the saved terms.</p>}
        <fieldset disabled={busy || Boolean(closed)} className="space-y-3">
          {(['owner','beneficiary'] as const).map(key=><label key={key} className="block capitalize">{key}<select className={input} value={terms[key]} onChange={e=>setTerms({...terms,[key]:e.target.value})}><option value="">Needs clarification</option>{parties.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>)}
          <label className="block">Deliverable<textarea className={input} value={terms.deliverable} onChange={e=>setTerms({...terms,deliverable:e.target.value})}/></label>
          <label className="block">Acceptance criteria<textarea className={input} placeholder="What evidence proves the promised work is complete?" value={terms.criteria} onChange={e=>setTerms({...terms,criteria:e.target.value})}/></label>
          <label className="block">Due date and time, including offset<input className={input} placeholder="2026-09-11T17:00:00+10:00" value={terms.dueAt} onChange={e=>setTerms({...terms,dueAt:e.target.value})}/></label>
          <label className="block">Timezone<input className={input} value={terms.timezone} onChange={e=>setTerms({...terms,timezone:e.target.value})}/></label>
          <label className="block">Evidence or reason<textarea className={input} placeholder="Who agreed, what was agreed, and the evidence for this decision" value={note} onChange={e=>setNote(e.target.value)}/></label>
          <div className="flex flex-wrap gap-2">
            {!selected && <button className={button} disabled={!project} onClick={()=>run(async()=>{ const result=await api('/api/commitments',{projectId:project,terms}); choose(result.item); await load(); })}>Create candidate</button>}
            {selected && <>
              <button className={button} onClick={()=>save('terms')}>{selected.state==='candidate'?'Save proposed terms':'Propose changed terms'}</button>
              {selected.review && reviewer && (selected.review.kind==='clarify' ? <button className={button} onClick={()=>save('respond')}>Answer clarification</button> : <><button className={button} disabled={unsavedTerms} onClick={()=>save('respond','approved')}>Approve current Ask</button><button className={button} onClick={()=>save('respond','revise')}>Request revision</button><button className={button} onClick={()=>save('respond','rejected')}>Reject</button></>)}
              {selected.state==='candidate' ? <button className={button} onClick={()=>save('dismiss')}>Dismiss candidate</button> : <><button className={button} onClick={()=>save('progress')}>Record progress</button><button className={button} onClick={()=>save('submit')}>Submit evidence for review</button><button className={button} onClick={()=>save('dispute')}>Record dispute</button></>}
              <button className={button} onClick={()=>save('cancel')}>Request cancellation</button>
            </>}
          </div>
          {selected && <div className="border-t pt-3"><label><input type="checkbox" checked={follow} onChange={e=>setFollow(e.target.checked)}/> Flag for follow-up</label><label className="block">Hours before due<input type="number" min="0" max="720" className={input} value={lead} onChange={e=>setLead(Number(e.target.value))}/></label><p className="text-xs text-slate-500">Saved for web review only. No messages are sent automatically.</p><button className={button} onClick={()=>save('follow_up')}>Save follow-up rule</button></div>}
        </fieldset>
        {selected && <details className="mt-4"><summary>Decision history</summary>{selected.history.map(h=><div key={h.version} className="my-3 border-t pt-2 text-sm"><p>{new Date(h.at).toLocaleString()} · {h.action.replaceAll('_',' ')}: {h.note}</p>{h.terms && <p className="text-slate-600">Owner: {label(h.terms.owner)} · Beneficiary: {label(h.terms.beneficiary)} · {h.terms.deliverable} · Due: {h.terms.dueAt || 'Unconfirmed'} ({h.terms.timezone || 'Unconfirmed timezone'}) · Acceptance: {h.terms.criteria || 'Unconfirmed'}</p>}</div>)}</details>}
      </div>
    </div>
  </section>;
};
