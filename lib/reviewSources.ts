import { runtimeDatabase } from './runtimeDatabase.js';
import { calendarStore } from './calendar/store.js';
import { GoogleCalendar } from './calendar/google.js';
import { calendarInstant } from './calendar/time.js';
import type { CalendarLedger, DiaryEvent } from './calendar/model.js';

const key = (value:string) => encodeURIComponent(value).replace(/\./g,'%2E');
type Snapshot = {source:'calendar'|'holds';project_id:string;observed_at:string;state:'current'|'unavailable'|'not_configured';items:any[];coverage_window?:{start:string;end:string};error?:string};
/** Read complete project snapshots. No provider writes, ask tokens or attendee details. */
export async function collectReviewSources(orgId:string, projects:string[], deps:{
  now?:Date; ledgers?:()=>Promise<CalendarLedger[]>;
  events?:(ledger:CalendarLedger,start:string,end:string)=>Promise<DiaryEvent[]>;
  holds?:(projectId:string)=>Promise<any>;
} = {}):Promise<Snapshot[]> {
  if(projects.length>100)throw new Error('Review source scope exceeds 100 projects; choose one project');
  const now=deps.now || new Date();
  const observed_at=now.toISOString();
  // Include all of the owner's local today regardless of UTC offset.
  const window={start:new Date(now.getTime()-86400000).toISOString(),end:new Date(now.getTime()+8*86400000).toISOString()};
  let ledgers:CalendarLedger[]=[]; let calendarError=false;
  try {
    ledgers=await (deps.ledgers || (()=>calendarStore.list(orgId)))();
    // Existing ledger store is bounded; reaching the bound cannot prove coverage.
    if(ledgers.length>=100) calendarError=true;
  } catch {calendarError=true;}
  const reads=new Map<string,Promise<DiaryEvent[]>>();
  const output:Snapshot[]=[];
  for(const project_id of projects) {
    const calendar:Snapshot={source:'calendar',project_id,observed_at,state:'current',items:[],coverage_window:window};
    const grants=ledgers.filter(l=>l.policies[project_id]);
    try {
      if(calendarError) throw new Error('Calendar configuration unavailable or exceeds the supported limit');
      if(!grants.length) calendar.state='not_configured';
      for(const ledger of grants) {
        if(!reads.has(ledger.id)) reads.set(ledger.id,(deps.events || ((l,start,end)=>new GoogleCalendar(orgId,l.connectionId).events(l.calendarId,start,end)))(ledger,window.start,window.end));
        const events=await reads.get(ledger.id)!;
        for(const event of events) {
          if(event.status==='cancelled')continue;
          const timezone=ledger.policies[project_id].timezone;
          const instant=(value:DiaryEvent['start'])=>value?.dateTime || (value?.date ? calendarInstant(value.date+'T00:00',timezone) : null);
          const starts_at=instant(event.start), ends_at=instant(event.end);
          if(!starts_at || !ends_at)throw new Error('Calendar event has no valid time');
          calendar.items.push({id:`${ledger.id}:${event.id}`,project_id,title:event.summary || 'Calendar event',starts_at,ends_at,timezone,all_day:!!event.start?.date});
        }
      }
      if(calendar.items.length>2000)throw new Error('Calendar window exceeds the supported review size');
    }catch{calendar.state='unavailable';calendar.items=[];calendar.error='Calendar synchronization failed; check grants, provider connection and source limits';}
    output.push(calendar);
    const holds:Snapshot={source:'holds',project_id,observed_at,state:'current',items:[]};
    try{
      const tree=await (deps.holds || (async id=>(await (await runtimeDatabase()).ref(`flow_holds/${key(orgId)}/${key(id)}`).get()).val()))(project_id);
      for(const run of Object.values<any>(tree || {})) for(const h of Object.values<any>(run || {})) {
        if(h.orgId!==orgId || h.projectId!==project_id || h.kind!=='human' || !['waiting','processing'].includes(h.status))continue;
        holds.items.push({id:h.id,project_id,status:h.status,reason:h.reason || 'Awaiting human response',flow_run_id:h.flowRunId,node_id:h.nodeId,updated_at:new Date(h.updatedAt).toISOString()});
      }
      if(holds.items.length>2000)throw new Error('Hold limit');
    }catch{holds.state='unavailable';holds.items=[];holds.error='Workflow hold synchronization failed';}
    output.push(holds);
  }
  return output;
}
