import React, { useEffect, useRef, useState } from 'react';
import { uploadManagedFile } from '../services/managedFiles';
import { firebaseService } from '../services/firebaseService';
import type { MeetingSegment } from '../lib/communications/meetingTypes';

type Receipt={fileId:string;name:string;status:string;message?:string;segments?:MeetingSegment[];text?:string;createdAt?:number};
const button='rounded-lg border border-slate-300 px-3 py-2 text-sm font-semibold disabled:opacity-40';
export function MeetingAudioIntake({orgId,request,onReview}:{key?:string;orgId:string;request:(url:string,body?:unknown)=>Promise<any>;onReview:(receipt:Receipt)=>void}) {
  const [file,setFile]=useState<File|null>(null),[fileId,setFileId]=useState('');
  const [receipt,setReceipt]=useState<Receipt|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[progress,setProgress]=useState('');
  const [uploads,setUploads]=useState<Array<{fileId:string;name:string}>>([]),[next,setNext]=useState<string|null>(null);
  const mounted=useRef(true);
  const identity=useRef({orgId,uid:firebaseService.getCurrentUser()?.uid});
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  const checkIdentity=()=>{
    if(!mounted.current || firebaseService.getCurrentOrgId()!==identity.current.orgId || firebaseService.getCurrentUser()?.uid!==identity.current.uid)
      throw new Error('Your account changed. Reopen Meetings before continuing.');
  };
  const run=async(fn:()=>Promise<void>)=>{setBusy(true);setError('');try{checkIdentity();await fn();}catch(e:any){if(mounted.current)setError(e.message);}finally{if(mounted.current)setBusy(false);}};
  const refresh=async(id:string)=>{const result=await request(`/api/meetings?audio=1&fileId=${encodeURIComponent(id)}`);checkIdentity();setReceipt(result);};
  useEffect(()=>{
    if(!receipt || !['pending','transcribing'].includes(receipt.status) || busy || error)return;
    const timer=setTimeout(()=>void run(()=>refresh(receipt.fileId)),5000);
    return()=>clearTimeout(timer);
  },[receipt,busy,error]);
  const loadUploads=async(after?:string)=>{
    const result=await request(`/api/meetings?audio=1${after?`&after=${encodeURIComponent(after)}`:''}`);checkIdentity();
    setUploads(old=>after?[...old,...result.data]:result.data);setNext(result.next);
    if(!after && !result.data.length)setProgress('No ready recordings on this page.');
  };
  const start=async(id:string)=>{const result=await request('/api/meetings',{operation:'audio_start',fileId:id});checkIdentity();setReceipt(result);};
  return <section className="space-y-3 rounded-lg border border-indigo-200 bg-indigo-50 p-4" aria-label="Meeting audio intake">
    <h3 className="font-semibold">Upload a meeting recording</h3>
    <p className="text-sm">Choose audio up to 25 MB. Transcription uses the connected provider. Review the speakers, notes and projects below before saving evidence.</p>
    <label className="block text-sm">Audio file
      <input type="file" accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm" disabled={busy} className="block w-full rounded border bg-white p-2" onChange={e=>{
        setFile(e.target.files?.[0]||null);setFileId(crypto.randomUUID());setReceipt(null);setError('');setProgress('');
      }}/>
    </label>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy||!file} onClick={()=>void run(async()=>{
        if(!file || file.size<1 || file.size>25*1024*1024)throw new Error('Choose a nonempty recording up to 25 MB.');
        setProgress('Uploading privately…');
        const uploaded=await uploadManagedFile(file,file.name,{id:fileId,visibility:'private',checkIdentity,
          request:(query,body)=>request(`/api/files${query}`,body),progress:(done,total)=>setProgress(`Uploaded ${Math.round(done/total*100)}%`)});
        setProgress('Upload complete. Requesting transcription…');
        await start(uploaded.id);setProgress('');
      })}>Upload and transcribe</button>
      <button className={button} disabled={busy} onClick={()=>void run(()=>loadUploads())}>Resume a previous recording</button>
    </div>
    {!!uploads.length && <label className="block text-sm">Your private recordings
      <select aria-label="Previous recording" className="w-full rounded border bg-white p-2" value={receipt?.fileId||''} disabled={busy} onChange={e=>{const id=e.target.value;if(id)void run(()=>refresh(id));}}>
        <option value="">Choose recording</option>{uploads.map(item=><option key={item.fileId} value={item.fileId}>{item.name} · {item.fileId.slice(0,8)}</option>)}
      </select>
    </label>}
    {next && <button className={button} disabled={busy} onClick={()=>void run(()=>loadUploads(next))}>More recordings</button>}
    {receipt && <div className="space-y-2" role="status">
      <p>{receipt.name}: <strong>{{not_queued:'Ready to transcribe',pending:'Queued for transcription',transcribing:'Transcribing',done:'Transcript ready for review',failed:'Transcription failed'}[receipt.status]||receipt.status}</strong></p>
      {receipt.message && <p className="text-sm">{receipt.message}</p>}
      <button className={button} disabled={busy} onClick={()=>void run(()=>refresh(receipt.fileId))}>Refresh transcription</button>{' '}
      {receipt.status==='not_queued' && <button className={button} disabled={busy} onClick={()=>void run(()=>start(receipt.fileId))}>Resume transcription</button>}
      {receipt.status==='done' && <button className={button} disabled={busy} onClick={()=>onReview(receipt)}>Review transcript</button>}
    </div>}
    {progress && <p role="status" className="text-sm">{progress}</p>}
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    <p className="text-xs text-slate-600">The recording stays private to your account. The provider receives a private link valid for 24 hours. Only the reviewed meeting topics are shared with their selected projects.</p>
  </section>;
}
