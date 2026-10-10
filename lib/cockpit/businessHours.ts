import type { CommunicationResult } from '../communications/types.js';

export type ReplyMode = 'reply' | 'acknowledge' | 'queue';
export interface BusinessHours { days: number[]; start: string; end: string; closures?: string[] }
export interface ContactPolicy {
  revision: number;
  timezone: string;
  outbound: BusinessHours;
  outboundExceptions?: Array<{ target: string; projectId: string; channels: Array<'sms' | 'voice'>; startsAt: number; expiresAt: number; reason: string }>;
  replies: { mode: ReplyMode; windowHours: number; expiryHours: number; maxPerDay: number; maxPerContact: number };
}
export interface PolicyDecision {
  status: 'allowed' | 'deferred' | 'blocked' | 'needs_review';
  allowed: boolean;
  reason: string;
  revision: number;
  source: string;
  localTime: string;
  nextEligibleAt?: number;
  expiresAt?: number;
  reactive: boolean;
  afterHours: boolean;
  notice?: string;
  noticeKey?: string;
}
export const AFTER_HOURS_NOTICE = 'It is outside business hours, so some actions will need staff review.';
export const CONTACT_POLICY_PROMPT_VERSION = 'contact-policy-v1';
export function validateHours(raw: any): BusinessHours {
  if (!raw || !Array.isArray(raw.days) || !raw.days.length || raw.days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6) ||
    !(typeof raw.start==='string'&&/^([01]\d|2[0-3]):[0-5]\d$/.test(raw.start)) || !(typeof raw.end==='string'&&(/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(raw.end)||raw.end==='24:00')) || raw.start === raw.end ||
    (raw.closures !== undefined && (!Array.isArray(raw.closures) || raw.closures.length > 366 || raw.closures.some((d: any) => typeof d !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(d) || !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0,10) !== d))))
    throw new Error('Hours require weekdays, distinct HH:mm times and valid dated closures.');
  return { days: [...new Set<number>(raw.days)], start: raw.start, end: raw.end, closures: raw.closures || [] };
}
export function normalizeContactPolicy(raw: any): ContactPolicy {
  if (!raw || !Number.isInteger(raw.revision) || raw.revision < 0) throw new Error('Contact policy revision is required.');
  new Intl.DateTimeFormat('en', { timeZone: raw.timezone }).format();
  if (typeof raw.timezone !== 'string' || !raw.timezone) throw new Error('Policy timezone is required.');
  const r = raw.replies;
  if (!r || !['reply','acknowledge','queue'].includes(r.mode) || ![r.windowHours,r.expiryHours,r.maxPerDay,r.maxPerContact].every(Number.isInteger) ||
      r.windowHours < 1 || r.windowHours > 168 || r.expiryHours < 1 || r.expiryHours > 168 || r.maxPerDay < 1 || r.maxPerDay > 1000 || r.maxPerContact < 1 || r.maxPerContact > 100)
    throw new Error('Reply policy requires a mode, 1–168 hour windows and bounded contact budgets.');
  const exceptions = raw.outboundExceptions;
  if (exceptions !== undefined && (!Array.isArray(exceptions) || exceptions.length > 10 || exceptions.some((e:any) =>
    !e || typeof e.target !== 'string' || !/^\+[1-9]\d{7,14}$/.test(e.target) || typeof e.projectId !== 'string' || !e.projectId.trim() ||
    !Array.isArray(e.channels) || !e.channels.length || e.channels.some((c:any)=>!['sms','voice'].includes(c)) ||
    !Number.isSafeInteger(e.startsAt) || !Number.isSafeInteger(e.expiresAt) || e.expiresAt <= e.startsAt || e.expiresAt-e.startsAt > 86400000 ||
    typeof e.reason !== 'string' || !e.reason.trim() || e.reason.length > 500))) throw new Error('Contact exceptions require an exact phone number, project, channels, reason and a window of at most 24 hours.');
  return { revision: raw.revision, timezone: raw.timezone, outbound: validateHours(raw.outbound), ...(exceptions ? {outboundExceptions:exceptions.map((e:any)=>({target:e.target,projectId:e.projectId,channels:[...new Set(e.channels)],startsAt:e.startsAt,expiresAt:e.expiresAt,reason:e.reason}))} : {}), replies: {mode:r.mode,windowHours:r.windowHours,expiryHours:r.expiryHours,maxPerDay:r.maxPerDay,maxPerContact:r.maxPerContact} };
}
export function policyDefaults(timezone = 'Australia/Brisbane', legacy?: {startHour:number;endHour:number}): ContactPolicy {
  return {revision:0,timezone,outbound:{days:[0,1,2,3,4,5,6],start:`${String(legacy?.startHour ?? 9).padStart(2,'0')}:00`,end: legacy?.endHour === 24 ? '24:00' : `${String(legacy?.endHour ?? 17).padStart(2,'0')}:00`,closures:[]},replies:{mode:legacy?'queue':'reply',windowHours:24,expiryHours:24,maxPerDay:200,maxPerContact:20}};
}
function local(now:number, timezone:string) {
  const p = new Intl.DateTimeFormat('en-CA',{timeZone:timezone,year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
  const get=(k:string)=>p.find(x=>x.type===k)?.value || '';
  return {date:`${get('year')}-${get('month')}-${get('day')}`,day:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(get('weekday')),time:`${get('hour')}:${get('minute')}`};
}
export function hoursOpen(hours:BusinessHours|undefined, timezone:string, now:number):boolean {
  if (!hours) return true;
  const t=local(now,timezone);
  if(hours.closures?.includes(t.date)) return false;
  if(hours.start < hours.end) return hours.days.includes(t.day) && t.time >= hours.start && t.time < hours.end;
  const previousDate=new Date(Date.parse(t.date+'T12:00:00Z')-86400000).toISOString().slice(0,10);
  return (hours.days.includes(t.day) && t.time>=hours.start) || (hours.days.includes((t.day+6)%7) && t.time<hours.end && !hours.closures?.includes(previousDate));
}
export function nextOpening(hours:BusinessHours, timezone:string, now:number, deadline=now+8*86400000):number|undefined {
  // Iterate real instants, so skipped and repeated DST hours are handled without local-time arithmetic.
  for(let t=Math.floor(now/60000)*60000+60000;t<=deadline;t+=60000) if(hoursOpen(hours,timezone,t)) return t;
}
export function restrictReplyMode(...modes:Array<ReplyMode|undefined>):ReplyMode {
  return modes.includes('queue')?'queue':modes.includes('acknowledge')?'acknowledge':'reply';
}
export function evaluateContactPolicy(policy:ContactPolicy,input:{orgId:string;target:string;projectId?:string;from?:string;channel:string;source?:CommunicationResult;now:number;mode?:ReplyMode;businessHours?:BusinessHours;businessTimezone?:string;projectHours?:BusinessHours}):PolicyDecision {
  const {now,source}=input;
  const open=hoursOpen(policy.outbound,policy.timezone,now);
  const businessOpen=hoursOpen(input.businessHours,input.businessTimezone||policy.timezone,now) && hoursOpen(input.projectHours,input.businessTimezone||policy.timezone,now);
  const base:PolicyDecision={status:'allowed',allowed:true,reason:'Contact permitted.',revision:policy.revision,source:'workspace',localTime:new Date(now).toLocaleString('en-AU',{timeZone:policy.timezone}),reactive:false,afterHours:!open||!businessOpen};
  if(source) {
    const at=Date.parse(source.occurredAt||'');
    if(source.tenantId!==input.orgId || source.direction!=='inbound' || source.channel!==input.channel || input.channel==='voice' || !source.personId || source.sender!==input.target || !input.from || source.recipients?.length!==1 || source.recipients[0]!==input.from || !Number.isFinite(at) || at>now || now-at>policy.replies.windowHours*3600000)
      return {...base,status:'needs_review',allowed:false,reason:'Inbound reply evidence is missing, expired or does not match the recipient and receiving identity.'};
    base.reactive=true; base.expiresAt=at+policy.replies.expiryHours*3600000;
    if(now>=base.expiresAt) return {...base,status:'needs_review',allowed:false,reason:'Deferred response expired; review the enquiry.'};
    const mode=restrictReplyMode(policy.replies.mode,input.mode);
    let next:number|undefined;
    if(base.afterHours&&mode!=='reply'){

      for(let t=Math.floor(now/60000)*60000+60000;t<=base.expiresAt;t+=60000) if(hoursOpen(policy.outbound,policy.timezone,t)&&hoursOpen(input.businessHours,input.businessTimezone||policy.timezone,t)&&hoursOpen(input.projectHours,input.businessTimezone||policy.timezone,t)){next=t;break;}
    }
    if(base.afterHours && mode==='queue') {
      return {...base,status:next?'deferred':'needs_review',allowed:false,reason:next?'Waiting until contact hours open.':'No opening before the response expires.',nextEligibleAt:next};
    }
    return {...base,nextEligibleAt:base.afterHours&&mode==='acknowledge'?next:undefined,notice:base.afterHours?AFTER_HOURS_NOTICE:undefined,reason:base.afterHours&&mode==='acknowledge'?'After-hours acknowledgement only.':'Direct inbound response permitted.'};
  }
  if(!open && policy.outboundExceptions?.some(e=>e.target===input.target && e.projectId===input.projectId && e.channels.some(c=>c===input.channel) && now>=e.startsAt && now<e.expiresAt))
    return {...base,source:'workspace approved contact exception',reason:'Time-limited contact exception applies; permissions and contact budgets still apply.'};
  if(!open){const next=nextOpening(policy.outbound,policy.timezone,now);return {...base,status:next?'deferred':'needs_review',allowed:false,reason:next?'Outside the configured contact hours.':'No contact opening in the next eight days; review required.',nextEligibleAt:next};}
  return base;
}
export class ContactPolicyHold extends Error { constructor(public decision:PolicyDecision){super(decision.reason);this.name='ContactPolicyHold';} }

/** Pure CAS transform shared by persistence and replay fixtures. */
export function applyContactPolicyRevision(current:any,raw:unknown,expectedRevision:number,requestId:string){
  const policy=normalizeContactPolicy(raw),fingerprint=JSON.stringify({policy,expectedRevision});
  if(current?.receipt?.requestId===requestId){if(current.receipt.fingerprint!==fingerprint)throw new Error('Request ID reused with different policy.');return current;}
  if((current?.revision||0)!==expectedRevision)throw new Error('Contact policy changed; reload and review again.');
  return {...policy,revision:expectedRevision+1,receipt:{requestId,fingerprint}};
}
