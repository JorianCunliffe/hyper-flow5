import {useCallback,useEffect,useRef,useState} from 'react';
import {firebaseService} from '../services/firebaseService';
import type {ServiceRunProgress} from '../lib/serviceRunProgress';
export const progressBusy=(p?:ServiceRunProgress|null)=>!!p&&['starting','running','waiting','held'].includes(p.status);
export function useServiceRunProgress(projectId:string,scheduleId?:string,request=firebaseService.authorizedFetch){
 const storageKey=`service-run:${firebaseService.getCurrentOrgId()}:${firebaseService.getCurrentUser()?.uid}:${projectId}`;
 const [progress,setProgress]=useState<ServiceRunProgress|null>(null);
 const [checking,setChecking]=useState(true);
 const [trackingError,setTrackingError]=useState('');
 const [cycle,setCycle]=useState(0);
 const pinned=useRef<{scheduleId:string;scheduledFor:number}|null>(null);
 const generation=useRef(0);
 const scope=useRef('');
 const start=useCallback((id:string,at:number)=>{
  generation.current++;pinned.current={scheduleId:id,scheduledFor:at};
  try{sessionStorage.setItem(storageKey,JSON.stringify(pinned.current));}catch{}
  setTrackingError('');setChecking(false);setProgress({projectId,scheduleId:id,scheduledFor:at,status:'starting',nodes:[]});
  setCycle(n=>n+1);
 },[projectId,storageKey]);
 useEffect(()=>{
  generation.current++;
  if(scope.current!==`${storageKey}:${scheduleId}`){pinned.current=null;scope.current=`${storageKey}:${scheduleId}`;setProgress(null);setChecking(true);}
  setTrackingError('');
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'null');if(saved?.scheduleId===scheduleId&&Number.isSafeInteger(saved.scheduledFor))pinned.current=saved;}catch{}
  if(!scheduleId)return;
  let disposed=false,done=false,timer:ReturnType<typeof setTimeout>|undefined,controller:AbortController|undefined,inFlight=false;
  const poll=async()=>{
   if(disposed||done||inFlight||document.hidden)return;
   inFlight=true;const version=generation.current;controller=new AbortController();const timeout=setTimeout(()=>controller?.abort(),10000);
   try{
    const target=pinned.current;
    const query=new URLSearchParams({projectId,scheduleId,progress:'true',...(target?{scheduledFor:String(target.scheduledFor)}:{})});
    const r=await request(`/api/service-projects/status?${query}`,{signal:controller.signal});
    if(!r.ok)throw Error('Progress could not be checked');
    const body=await r.json();if(disposed||version!==generation.current)return;
    const p=body.progress as ServiceRunProgress|null;
    if(p && !target){pinned.current={scheduleId:p.scheduleId,scheduledFor:p.scheduledFor};try{sessionStorage.setItem(storageKey,JSON.stringify(pinned.current));}catch{}}
    setProgress(p);setChecking(false);setTrackingError('');
    done=!p||['completed','failed','cancelled'].includes(p.status);
    if(p?.status==='starting' && Date.now()-p.scheduledFor>30000){setChecking(true);setTrackingError('The start is not confirmed yet. Checking this same run; do not start another call.');}
   }catch(e){if(!disposed&&version===generation.current){setChecking(true);setTrackingError('Connection interrupted. Checking the saved run; no automatic restart.');}}
   finally{clearTimeout(timeout);inFlight=false;if(!disposed&&!done)timer=setTimeout(poll,3000);}
  };
  const visible=()=>{if(!document.hidden){clearTimeout(timer);void poll();}};
  document.addEventListener('visibilitychange',visible);void poll();
  return()=>{disposed=true;generation.current++;clearTimeout(timer);controller?.abort();document.removeEventListener('visibilitychange',visible);};
 },[projectId,scheduleId,storageKey,cycle,request]);
 return {progress,checking,trackingError,start,busy:checking||progressBusy(progress)};
}

