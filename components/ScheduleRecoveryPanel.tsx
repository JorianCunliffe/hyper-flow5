import React, { useEffect, useState } from 'react';
import { firebaseService } from '../services/firebaseService';
import type { TenantSchedule } from '../types';

export function ScheduleRecoveryPanel({schedule, onClose, onApplied, transport}: {schedule: TenantSchedule; onClose:()=>void; onApplied:()=>Promise<void>; transport?:(body:any)=>Promise<any>}) {
  const [preview,setPreview]=useState<any>();
  const [choice,setChoice]=useState('resume_future');
  const [note,setNote]=useState('');
  const [ack,setAck]=useState(false);
  const [confirmCall,setConfirmCall]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [receipt,setReceipt]=useState<any>();
  const [requestId,setRequestId]=useState(()=>crypto.randomUUID());
  const time=(v:number)=>new Date(v).toLocaleString('en-AU',{timeZone:preview?.timezone || schedule.timezone});
  async function command(body:any) {
    if(transport)return transport({id:schedule.id,scheduledFor:schedule.nextRunAt,...body});
    const response=await firebaseService.authorizedFetch('/api/schedules/recovery',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:schedule.id,scheduledFor:schedule.nextRunAt,...body})
    });
    const result=await response.json();
    if(!response.ok)throw new Error(result.error || 'Recovery could not be saved');
    return result;
  }
  async function review() {
    setBusy(true);setError('');
    try {setPreview(await command({operation:'preview'}));setAck(false);setConfirmCall(false);setRequestId(crypto.randomUUID());}
    catch(e:any){setError(e.message);}finally{setBusy(false);}
  }
  useEffect(()=>{if(!receipt)void review();},[schedule.id,schedule.nextRunAt]);
  async function apply() {
    setBusy(true);setError('');
    try {
      const result=await command(preview.pending
        ? {operation:'apply',requestId:preview.pending.requestId,...(preview.pending.timeReviewRequired?{nextRunAt:preview.pending.nextRunAt}:{})}
        : {operation:'apply',requestId,decision:choice,note,acceptUncertainty:ack,confirmCall,reviewedAt:preview.reviewedAt,planHash:preview.planHash});
      setReceipt(result);await onApplied();
    }catch(e:any){setError(`${e.message}. If the response was lost, retry this same decision or refresh to continue the saved operation.`);}finally{setBusy(false);}
  }
  const unresolved=['unknown','in_progress'].includes(preview?.evidence?.outcome);
  return <div role="dialog" aria-modal="true" aria-label="Resolve held run" className="fixed inset-0 z-[120] bg-slate-900/60 flex items-center justify-center p-4">
    <div className="bg-white rounded-2xl p-6 max-w-xl w-full max-h-[90vh] overflow-y-auto text-slate-900">
      <h2 className="text-xl font-bold">Resolve held run</h2>
      <p className="text-sm my-2">{schedule.name} · original occurrence {time(receipt?.originalScheduledFor || schedule.nextRunAt)} · {schedule.timezone}</p>
      {error && <p role="alert" className="text-red-700 my-3">{error}</p>}
      {receipt ? <div role="status" className="space-y-2 my-4">
        <p>Recovery decision saved: {receipt.decision.replaceAll('_',' ')}.</p>
        <p>Original provider outcome: {receipt.originalOutcome}.</p>
        {receipt.decision==='resume_future' && <p>Next scheduled call: {time(receipt.nextRunAt)} ({receipt.timezone}). Missed days will not be replayed.</p>}
        {receipt.decision==='retry_original' && <p>The original call is queued for a scheduler tick. Its original operation ID and request are preserved. This receipt is not confirmation that a call connected.</p>}
        {receipt.decision==='keep_held' && <p>The workflow remains held.</p>}
        <p className="text-xs break-all">Receipt: {receipt.requestId}</p>
      </div> : preview?.pending ? <div className="my-4">
        <p>A reviewed {preview.pending.decision.replaceAll('_',' ')} operation is partially saved. Continue it using the same receipt; do not create a replacement.</p>
        {preview.pending.timeReviewRequired && <p>The previous time has passed. Continuing confirms the new next call time: <strong>{time(preview.pending.nextRunAt)} ({preview.timezone})</strong>.</p>}
        <button disabled={busy} onClick={()=>void apply()} className="rounded bg-indigo-700 text-white px-3 py-2 mt-3">Continue saved recovery</button>
      </div> : preview ? <div className="space-y-4 my-4">
        <p>Original call: <strong>{preview.evidence.outcome.replaceAll('_',' ')}</strong> (receipt: {preview.evidence.receiptStatus}).</p>
        <p className="text-sm">{preview.explanation}</p>
        <label className="block">Recovery action
          <select className="block border rounded p-2 w-full" value={choice} onChange={e=>{setChoice(e.target.value);setAck(false);setConfirmCall(false);}} disabled={busy}>
            <option value="resume_future">Close this occurrence and resume future calls</option>
            <option value="retry_original" disabled={!preview.canRetry}>Retry this occurrence — only if verified safe</option>
            <option value="keep_held">Keep held and record findings</option>
          </select>
        </label>
        {choice==='resume_future' && <><p>Next call: <strong>{time(preview.nextRunAt)} ({preview.timezone})</strong>. The old occurrence stays failed. No missed days are replayed.</p>
          {unresolved && <label className="flex gap-2"><input type="checkbox" checked={ack} onChange={e=>setAck(e.target.checked)} />I accept that the original call remains unresolved and authorize separate future scheduled calls.</label>}</>}
        {choice==='retry_original' && <><p>Recipient: {String(preview.recipient)}. The original request will be retried on a scheduler tick; normal permissions, contact hours and readiness checks still apply.</p><label className="flex gap-2"><input type="checkbox" checked={confirmCall} onChange={e=>setConfirmCall(e.target.checked)} />I authorize retrying this original call.</label></>}
        <label className="block">Review note<textarea className="block border rounded p-2 w-full" maxLength={1000} value={note} onChange={e=>setNote(e.target.value)} disabled={busy} /></label>
        <button disabled={busy || !note.trim() || (choice==='resume_future' && unresolved && !ack) || (choice==='retry_original' && (!preview.canRetry || !confirmCall))} onClick={()=>void apply()} className="rounded bg-indigo-700 text-white px-3 py-2 disabled:opacity-50">Confirm recovery decision</button>
      </div> : <p>Reading the original call receipt…</p>}
      <div className="flex gap-3 mt-4"><button disabled={busy} onClick={onClose} className="border rounded px-3 py-2">Close</button>{!receipt && <button disabled={busy} onClick={()=>void review()} className="border rounded px-3 py-2">Refresh evidence</button>}</div>
    </div>
  </div>;
}
