import React, { useEffect, useState, useCallback, useRef } from 'react';
import { firebaseService } from '../services/firebaseService';
import { useProjectScope } from './ProjectScope';
import type { CapturedWorkItem } from '../lib/capturedWork/model';
const field = 'rounded border p-2 text-sm bg-white text-slate-900';
const button = 'rounded border px-3 py-2 text-sm disabled:opacity-40';
async function request(method = 'GET', body?: any, query = 'status=unresolved&limit=100') {
  const response = await firebaseService.authorizedFetch(`/api/captured-work-items?${query}`, { method, ...(body ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Could not load captured items');
  return result;
}
export function CapturedWorkPanel() {
  const scope = useProjectScope();
  const reviewForm = useRef<HTMLFormElement>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [items, setItems] = useState<CapturedWorkItem[]>([]);
  const [rawText, setRawText] = useState('');
  const [captureKey, setCaptureKey] = useState(() => crypto.randomUUID());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<CapturedWorkItem | null>(null);
  const [draft, setDraft] = useState<any>({});
  const [showClosed, setShowClosed] = useState(false);
  const load = useCallback(async (after?: string) => {
    const result = await request('GET', undefined, `status=${showClosed ? 'all' : 'unresolved'}&limit=100${after ? `&after=${encodeURIComponent(after)}` : ''}`);
    setItems(current => after ? [...current, ...result.items] : result.items);
    setNextCursor(result.nextCursor);
  }, [showClosed]);
  useEffect(() => { let active = true; request('GET', undefined, `status=${showClosed ? 'all' : 'unresolved'}&limit=100`).then(result => { if (active) { setItems(result.items); setNextCursor(result.nextCursor); } }).catch(e => { if (active) setError(e.message); }); return () => { active = false; }; }, [showClosed]);
  useEffect(() => { if (selected) reviewForm.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }, [selected]);
  const act = async (action: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); await load(); } catch (e: any) { setError(e.message); } finally { setBusy(false); }
  };
  const review = (item: CapturedWorkItem) => {
    setSelected(item); setDraft({ title: item.title || item.rawText.slice(0, 500), kind: item.kind === 'unknown' ? 'task' : item.kind || 'task', projectId: item.proposedProjectId || '', at: item.proposedAt || item.proposedDueAt ? new Date(item.proposedAt || item.proposedDueAt).toISOString() : '', mode: item.proposedMode || 'in_person', location: item.proposedLocation || '', durationMinutes: item.proposedDurationMinutes || 30 });
  };
  const update = (key: string, value: any) => setDraft((d: any) => ({ ...d, [key]: value }));
  return <section className="p-6 space-y-4 max-w-5xl mx-auto">
    <h1 className="text-2xl font-semibold">Unresolved Items</h1>
    <p className="text-sm text-slate-600">Capture a thought and keep going. Review it when you are ready. These items belong to your account and survive completed runs.</p>
    <form className="flex gap-2" onSubmit={e => { e.preventDefault(); void act(async () => { await request('POST', { rawText, idempotencyKey: captureKey }); setRawText(''); setCaptureKey(crypto.randomUUID()); }); }}>
      <input aria-label="Capture a side item" className={`${field} flex-1`} value={rawText} maxLength={8000} onChange={e => { setRawText(e.target.value); setCaptureKey(crypto.randomUUID()); }} placeholder="I need to call Peter about the filter…" />
      <button className={button} disabled={busy || !rawText.trim()}>Capture</button>
    </form>
    <div className="flex gap-4 items-center"><label className="text-sm"><input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} /> Include resolved and dismissed items</label><button className={button} disabled={busy} onClick={() => void act(() => load())}>Refresh</button></div>
    {error && <p role="alert" className="text-red-700">{error}</p>}
    {!items.length && <p className="text-slate-500">No captured items yet.</p>}
    {items.filter(item => showClosed || ['captured', 'clarifying'].includes(item.status)).map(item => <article key={item.id} className="border rounded-xl p-4 space-y-2">
      <div className="flex justify-between gap-3"><strong>{item.title || item.rawText}</strong><span className="text-xs">{item.status}</span></div>
      {item.title && <p>{item.rawText}</p>}
      <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()} · {item.kind || 'unknown'} · {item.proposedProjectName || item.proposedProjectId || 'Project not assigned'}</p>
      {item.sourceRunId && <p className="text-xs">Source: {item.sourceProjectId} / {item.sourceRunId} / {item.sourceNodeId || 'conversation'}</p>}
      {item.intent && <p className="text-sm">Confirmed {item.intent.kind}: {item.intent.title}. {item.intent.at && new Date(item.intent.at).toLocaleString()} · Awaiting downstream execution · {item.resolvedObjectId}</p>}
      {['captured', 'clarifying'].includes(item.status) && <div className="flex gap-2"><button className={button} disabled={busy} onClick={() => review(item)}>Review / assign project</button><button className={button} disabled={busy} onClick={() => void act(async () => { await request('POST', { operation: 'dismiss', id: item.id, version: item.version }); })}>Dismiss</button></div>}
    </article>)}
    {nextCursor && <button className={button} disabled={busy} onClick={async () => { setBusy(true); try { await load(nextCursor); } catch (e: any) { setError(e.message); } finally { setBusy(false); } }}>Load more</button>}
    {selected && <form ref={reviewForm} className="border-2 border-violet-300 rounded-xl p-4 space-y-3" onSubmit={e => { e.preventDefault(); void act(async () => {
      const { at, ...rest } = draft;
      if (at && !/(?:Z|[+-]\d{2}:\d{2})$/.test(at)) throw new Error('Include a timezone offset in the date/time');
      await request('POST', { operation: 'resolve', id: selected.id, version: selected.version, confirmed: true, intent: { ...rest, ...(at ? { at: Date.parse(at) } : {}) } }); setSelected(null);
    }); }}>
      <h2 className="font-semibold">Review: {selected.rawText}</h2>
      <label className="block">Title <input required className={`${field} w-full`} value={draft.title} onChange={e => update('title', e.target.value)} /></label>
      <label className="block">Kind <select className={field} value={draft.kind} onChange={e => update('kind', e.target.value)}>{['task', 'meeting', 'reminder', 'follow_up', 'note'].map(kind => <option key={kind}>{kind}</option>)}</select></label>
      <label className="block">Project <select className={field} value={draft.projectId} onChange={e => update('projectId', e.target.value)}><option value="">General workspace</option>{(scope?.projects || []).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="block">Date/time with timezone <input className={`${field} w-full`} placeholder="2026-09-26T13:00:00+10:00" value={draft.at} onChange={e => update('at', e.target.value)} required={['meeting', 'reminder'].includes(draft.kind)} /></label>
      {draft.kind === 'meeting' && <><label className="block">Mode <select className={field} value={draft.mode} onChange={e => update('mode', e.target.value)}><option value="in_person">In person</option><option value="phone">Phone</option><option value="online">Online</option></select></label><label className="block">Duration (minutes) <input type="number" min={1} max={1440} className={field} value={draft.durationMinutes} onChange={e => update('durationMinutes', Number(e.target.value))} /></label>{draft.mode === 'in_person' && <label className="block">Location <input required className={field} value={draft.location} onChange={e => update('location', e.target.value)} /></label>}</>}
      <p className="text-sm text-slate-600">Confirming records a work intent. Calendar booking, reminder delivery and messages still need a downstream action.</p>
      <div className="flex gap-2"><button className={button} disabled={busy}>Confirm intent</button><button type="button" className={button} disabled={busy} onClick={() => void act(async () => { if (draft.at && !/(?:Z|[+-]\d{2}:\d{2})$/.test(draft.at)) throw new Error('Include a timezone offset in the date/time'); await request('PATCH', { id: selected.id, version: selected.version, title: draft.title, kind: draft.kind, proposedProjectId: draft.projectId || null, proposedAt: draft.at ? Date.parse(draft.at) : null, proposedLocation: draft.location || null, ...(draft.kind === 'meeting' ? { proposedMode: draft.mode, proposedDurationMinutes: draft.durationMinutes } : {}) }); setSelected(null); })}>Save for later</button><button type="button" className={button} onClick={() => setSelected(null)}>Close</button></div>
    </form>}
  </section>;
}
