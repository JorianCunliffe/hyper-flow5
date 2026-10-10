import React, { useEffect, useState } from 'react';
import { firebaseService } from '../services/firebaseService';
import type { ContactPolicy } from '../lib/cockpit/businessHours';
const request=async(body?:unknown)=>{
  const r=await firebaseService.authorizedFetch('/api/cockpit'+(body?'':'?operation=contact_policy'),body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{});
  const value=await r.json();if(!r.ok)throw new Error(value.error||'Contact policy unavailable');return value;
};
export function ContactPolicyEditor({transport=request}:{transport?:typeof request}) {
  const [policy,setPolicy]=useState<ContactPolicy>();const [review,setReview]=useState<any>();const [error,setError]=useState('');const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
  useEffect(()=>{let active=true;transport().then(r=>{if(active){setPolicy(r.policy);if(!r.enabled)setNotice('Contact policy v2 is not enabled on this deployment. Saved rules take effect after rollout is enabled.');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[transport]);
  function change(next:ContactPolicy){setPolicy(next);setReview(undefined);setNotice('');}
  async function submit(apply:boolean){if(!policy)return;setBusy(true);setError('');try{const r=await transport(apply?{operation:'contact_policy_apply',...review}:{operation:'contact_policy_preview',policy,expectedRevision:policy.revision});if(apply){setPolicy(r.policy);setReview(undefined);setNotice(r.notice);}else setReview(r);}catch(e:any){setError(e.message);}finally{setBusy(false);}}
  return <section aria-label="Contact and business hours" className="space-y-3 rounded-lg border p-4">
    <h3>Contact and business hours</h3><p>Outbound contact and inbound replies use separate rules. Project and receptionist restrictions still apply.</p>
    {error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    {policy&&<fieldset disabled={busy} className="space-y-3">
      <label className="block">Timezone <input value={policy.timezone} onChange={e=>change({...policy,timezone:e.target.value})}/></label>
      <label className="block">After-hours inbound replies <select value={policy.replies.mode} onChange={e=>change({...policy,replies:{...policy.replies,mode:e.target.value as ContactPolicy['replies']['mode']}})}><option value="reply">Reply with after-hours notice</option><option value="acknowledge">Acknowledge and queue until opening</option><option value="queue">Queue until opening time</option></select></label>
      {(['windowHours','expiryHours','maxPerDay','maxPerContact'] as const).map(key=><label className="block" key={key}>{({windowHours:'Reply window (hours)',expiryHours:'Deferred reply expiry (hours)',maxPerDay:'Replies per day',maxPerContact:'Replies per person per day'})[key]} <input type="number" min="1" value={policy.replies[key]} onChange={e=>change({...policy,replies:{...policy.replies,[key]:Number(e.target.value)}})}/></label>)}
      <label className="block">Outbound opening time <input type="time" value={policy.outbound.start} onChange={e=>change({...policy,outbound:{...policy.outbound,start:e.target.value}})}/></label>
      <label className="block">Outbound closing time <input type="text" placeholder="HH:mm (or 24:00)" value={policy.outbound.end} onChange={e=>change({...policy,outbound:{...policy.outbound,end:e.target.value}})}/></label>
      <fieldset><legend>Outbound contact days</legend>{['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((day,i)=><label key={day} className="mr-3"><input type="checkbox" checked={policy.outbound.days.includes(i)} onChange={e=>change({...policy,outbound:{...policy.outbound,days:e.target.checked?[...policy.outbound.days,i]:policy.outbound.days.filter(d=>d!==i)}})}/>{day}</label>)}</fieldset>
      <label className="block">Closed dates (one YYYY-MM-DD per line)<textarea value={policy.outbound.closures?.join('\n')||''} onChange={e=>change({...policy,outbound:{...policy.outbound,closures:e.target.value.split('\n').filter(Boolean)}})}/></label>
      <button type="button" onClick={()=>void submit(false)}>Review contact policy</button>
      <fieldset><legend>Time-limited outbound exceptions</legend><p>Exact recipient and project only, for up to 24 hours. Existing permissions and budgets still apply.</p>
        {(policy.outboundExceptions||[]).map((exception,index)=><div key={index} className="space-y-2 border p-2">
          {(['target','projectId','reason'] as const).map(key=><label className="block" key={key}>{({target:'Recipient phone (international format)',projectId:'Project ID',reason:'Reason'})[key]}<input value={exception[key]} onChange={e=>change({...policy,outboundExceptions:policy.outboundExceptions!.map((x,i)=>i===index?{...x,[key]:e.target.value}:x)})}/></label>)}
          <p>Starts: {new Date(exception.startsAt).toLocaleString("en-AU",{timeZone:policy.timezone})}. Expires: {new Date(exception.expiresAt).toLocaleString("en-AU",{timeZone:policy.timezone})} ({policy.timezone}).</p>
          <p>Channels: {exception.channels.join(', ')}</p><button type="button" onClick={()=>change({...policy,outboundExceptions:policy.outboundExceptions!.filter((_,i)=>i!==index)})}>Remove exception</button>
        </div>)}
        <button type="button" onClick={()=>change({...policy,outboundExceptions:[...(policy.outboundExceptions||[]),{target:'',projectId:'',reason:'',channels:['sms','voice'],startsAt:Date.now(),expiresAt:Date.now()+2*3600000}]})}>Add two-hour contact exception</button>
      </fieldset>
      {review&&<div aria-label="Contact policy review"><p>Outbound contact: {review.preview.reason} Inbound after-hours mode: {review.policy.replies.mode}. Local time: {review.preview.localTime}. Source: {review.preview.source}. Revision: {review.expectedRevision}.</p><p>{review.preview.nextEligibleAt?`Next outbound opening: ${new Date(review.preview.nextEligibleAt).toLocaleString("en-AU",{timeZone:review.policy.timezone})}. `:""}{review.note}</p><pre className="overflow-auto">{JSON.stringify(review.policy,null,2)}</pre><button type="button" onClick={()=>void submit(true)}>Apply reviewed contact policy</button></div>}
    </fieldset>}
  </section>;
}
