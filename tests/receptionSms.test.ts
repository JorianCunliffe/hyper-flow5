import test from 'node:test';
import assert from 'node:assert/strict';
import { processReceptionSms, smsReceptionDependencies } from '../lib/reception/sms.js';
import { digest, validateConfig } from '../lib/reception/model.js';
process.env.PROJECT_RECEPTION_ENABLED = 'true';
function fixture() {
  const records = new Map<string, any>(), messages = new Map<string, any>(), sent: any[] = [], evidence: any[] = [];
  const clone = (v: any) => v == null ? null : structuredClone(v);
  const store: any = {
    read: async (o: string, c: string, id: string) => clone(records.get(`${o}/${c}/${id}`)),
    list: async (o: string, c: string) => [...records].filter(([k]) => k.startsWith(`${o}/${c}/`)).map(([,v]) => clone(v)),
    transact: async (o: string, c: string, id: string, fn: any) => { const k = `${o}/${c}/${id}`; const v = fn(clone(records.get(k))); records.set(k, clone(v)); return clone(v); }
  };
  const project = (id: string, visibility = 'public') => ({ projectId: id, label: id, enabled: true, visibility, aliases: [], knowledge: `Public ${id}`, historySourceProjectIds: [id], intakeOwner: 'staff', actions: [] });
  const config: any = { revision: 1, lines: [{ id: 'line', identity: '+61400000001', enabled: true, smsEnabled: true, name: 'Reception', greeting: '', timezone: 'Australia/Brisbane', projectIds: ['Sharehouse', 'Private'], inboxOwner: 'reception' }], projects: [project('Sharehouse'), project('Private', 'recognized')] };
  records.set('org/config/current', config);
  let now = Date.parse('2026-10-05T05:00:00Z');
  const profile = { automaticActions: ['sms'], primaryPersonId: 'staff', allowedProjectIds: ['Private'], conversation: { historyEnabled: true } };
  const client: any = { getCommunication: async (_o: string, id: string) => messages.get(id), sendSms: async (r: any) => { sent.push(r); return { id: `sent_${sent.length}`, status: 'accepted' }; } };
  const deps: any = { ...smsReceptionDependencies, store, client: () => client, now: () => now, enabled: () => true,
    profile: async () => profile, policy: async () => ({ 'sms.send': 'automatic' }), claim: async () => ({ allowed: true }),
    listTenantProjects: async () => config.projects.map((p: any) => ({ id: p.projectId })), readTenantAgentProfile: async () => profile,
    evidence: async (input: any) => { evidence.push(input); return { status: 'current', sources: [{ text: 'Own relevant history' }] }; },
    analyze: async () => ({ intent: 'answer', answer: 'Hello, how can I help with your room enquiry?' }) };
  const message = (id = 'message', body = 'Any rooms?') => { const m: any = { id, tenantId: 'org', channel: 'sms', direction: 'inbound', personId: 'new_person', sender: '+61400000002', recipients: ['+61400000001'], content: body }; messages.set(id,m); return m; };
  return { records, store, sent, evidence, deps, config, client, message, advance: () => { now += 20000; } };
}
test('new sender gets public help on receiving number, own history and acknowledged intake', async () => {
  const f = fixture(); const r = await processReceptionSms('org', f.message(), f.client, f.deps);
  assert.equal(r.status, 'completed'); assert.equal(r.projectId, 'Sharehouse');
  assert.equal(f.sent[0].from, '+61400000001'); assert.equal(f.sent[0].to, '+61400000002');
  assert.equal(f.evidence[0].personId, 'new_person'); assert.equal(f.evidence[0].projectId, 'Sharehouse');
  const enquiries = await f.store.list('org', 'enquiries'); assert.equal(enquiries.length, 1); assert.equal(enquiries[0].owner, 'staff');
  assert.equal((await f.store.read('org','people','new_person')).projectIds[0], 'Sharehouse');
});
test('multiple public services clarify without exposing private or internal project names', async () => {
  const f = fixture(); f.config.projects.push({ ...f.config.projects[0], projectId: 'Repairs', label: 'Repairs' }); f.config.lines[0].projectIds.push('Repairs');
  await processReceptionSms('org', f.message(), f.client, f.deps);
  assert.match(f.sent[0].body, /Which service/); assert.doesNotMatch(f.sent[0].body, /Private/);
  assert.equal((await f.store.list('org','enquiries'))[0].owner,'reception');
});
test('private explicit request clears routing and does not expose private history', async () => {
  const f=fixture(); await processReceptionSms('org',f.message('one'),f.client,f.deps); f.advance();
  const result=await processReceptionSms('org',f.message('two','Private'),f.client,f.deps);
  assert.equal(result.projectId,undefined); assert.equal(f.evidence.length,1); assert.doesNotMatch(f.sent[1].body,/Private/);
});
test('duplicates and lost send responses cannot repeat external effects', async () => {
  const f=fixture(), m=f.message(); await processReceptionSms('org',m,f.client,f.deps); await processReceptionSms('org',m,f.client,f.deps); assert.equal(f.sent.length,1);
  const g=fixture(); g.client.sendSms=async (r: any)=>{g.sent.push(r);throw new Error('response lost');};
  const gm=g.message(); assert.equal((await processReceptionSms('org',gm,g.client,g.deps)).status,'needs_review');
  await processReceptionSms('org',gm,g.client,g.deps); assert.equal(g.sent.length,1);
});
test('existing voice settings do not enable SMS; disabled line and wrong tenant fail closed', async () => {
  const f=fixture(); delete f.config.lines[0].smsEnabled;
  assert.equal(validateConfig(f.config,['Sharehouse','Private']).lines[0].smsEnabled,false);
  assert.equal((await processReceptionSms('org',f.message(),f.client,f.deps)).handled,false);
  f.config.lines[0].smsEnabled=true; f.config.lines[0].enabled=false;
  assert.equal((await processReceptionSms('org',f.message(),f.client,f.deps)).status,'needs_review'); assert.equal(f.sent.length,0);
  await assert.rejects(processReceptionSms('other',f.message(),f.client,f.deps),/tenant mismatch/);
});
test('permission denial saves enquiry without sending; Ask replies retain their dedicated path', async () => {
  const f=fixture(); f.deps.policy=async()=>({'sms.send':'denied'});
  assert.equal((await processReceptionSms('org',f.message(),f.client,f.deps)).status,'needs_review'); assert.equal(f.sent.length,0); assert.equal((await f.store.list('org','enquiries')).length,1);
  const m={...f.message('ask'),purpose:{type:'human_ask',ask_id:'ask'}};
  assert.equal((await processReceptionSms('org',m,f.client,f.deps)).status,'completed'); assert.equal(f.sent.length,0);
});
test('history is cleared on service switch and intake preserves prior messages', async () => {
  const f=fixture(); f.config.projects.push({...f.config.projects[0],projectId:'Repairs',label:'Repairs'}); f.config.lines[0].projectIds.push('Repairs');
  const inputs:any[]=[];f.deps.analyze=async (d:any)=>{inputs.push(d);return {intent:'answer',answer:'Hello'};};
  await processReceptionSms('org',f.message('one','Sharehouse room request'),f.client,f.deps);f.advance();
  await processReceptionSms('org',f.message('two','Extra details'),f.client,f.deps);f.advance();
  await processReceptionSms('org',f.message('three','Repairs please'),f.client,f.deps);
  assert.equal(inputs[1].priorMessages.length,2);assert.equal(inputs[2].priorMessages.length,0);
  assert.match((await f.store.list('org','enquiries')).find((e:any)=>e.projectId==='Sharehouse').request,/room request\nExtra details/);
});
test('model failure and unsupported actions take messages without invented success',async()=>{
  for(const mode of ['failure','booking']) {const f=fixture();f.deps.analyze=async()=>{if(mode==='failure')throw new Error('model down');return {intent:'booking',answer:'Booked!'};};
    const r=await processReceptionSms('org',f.message(),f.client,f.deps); assert.equal(r.status,'needs_review');assert.match(f.sent[0].body,/saved/);assert.doesNotMatch(f.sent[0].body,/Booked!/);
  }
});

async function bookingFixture() {
  const f=fixture(), rows:any[]=[];
  const booking={resourceName:'diary',staffPersonId:'carol',durationMinutes:15,travelMinutes:5,properties:['Martyn St'],columns:{date:0,time:1,property:2,attendees:3,groupSize:4,status:5}};
  f.config.projects[0].actions=['booking']; f.config.projects[0].booking=booking;
  await f.store.transact('org','availability',digest(['Sharehouse','carol']),()=>({expiresAt:f.deps.now()+86400000,windows:[{date:'2026-10-05',start:'15:00',end:'17:00',properties:['Martyn St']}]}));
  f.deps.actions={...f.deps.actions,readDiary:async()=>({values:structuredClone(rows)}),execute:async(_kind:any,args:string)=>{rows.push(...JSON.parse(args).values);return {status:'success',output:{receipt:'saved'}};}};
  f.deps.analyze=async()=>({intent:'booking',answer:'Please confirm',booking:{date:'2026-10-05',time:'16:00',property:'Martyn St',attendees:'Jorian',groupSize:1}});
  return {...f,rows};
}
test('booking requires a later exact confirmation; duplicate confirmation cannot write twice',async()=>{
  const f=await bookingFixture();
  await processReceptionSms('org',f.message('review','Book Martyn St at 4pm today for Jorian'),f.client,f.deps);
  assert.equal(f.rows.length,0);assert.match(f.sent[0].body,/Nothing is booked yet/);
  const code=f.sent[0].body.match(/CONFIRM ([A-F0-9]{8})/)[0];f.advance();
  const m=f.message('confirm',code),result=await processReceptionSms('org',m,f.client,f.deps);
  assert.equal(result.status,'completed');assert.equal(f.rows.length,1);assert.match(f.sent[1].body,/booking is confirmed/);
  await processReceptionSms('org',m,f.client,f.deps);assert.equal(f.rows.length,1);assert.equal(f.sent.length,2);
});
test('changed booking policy or conflicting diary prevents confirmation',async()=>{
  for(const mode of ['policy','conflict']) {const f=await bookingFixture();await processReceptionSms('org',f.message('review'),f.client,f.deps);
    const code=f.sent[0].body.match(/CONFIRM ([A-F0-9]{8})/)[0];f.advance();
    if(mode==='policy') f.config.revision++;else f.rows.push(['external appointment']);
    const result=await processReceptionSms('org',f.message('confirm',code),f.client,f.deps);
    assert.equal(result.status,'needs_review');assert.equal(f.rows.length,mode==='conflict'?1:0);assert.equal(f.sent.length,1);
  }
});
test('fresh availability uses the shared permitted webhook and stale responses fall back to intake',async()=>{
  for(const stale of [false,true]) {const f=fixture();f.config.projects[0].actions=['availability'];f.config.projects[0].availabilityConnection='rooms';
    let calls=0;f.deps.actions={...f.deps.actions,webhook:async()=>{calls++;return {webhook_fetched_at:new Date(f.deps.now()-(stale?120000:0)).toISOString(),rooms:['Room A']};}};
    f.deps.analyze=async(d:any)=>d.freshAvailability?{intent:'answer',answer:'Room A is currently available'}:{intent:'availability',answer:'Checking'};
    const result=await processReceptionSms('org',f.message(),f.client,f.deps);assert.equal(calls,1);
    assert.equal(result.status,stale?'needs_review':'completed');if(stale)assert.doesNotMatch(f.sent[0].body,/Room A/);
  }
});
test('concurrent duplicate messages serialize and do not send twice',async()=>{
  const f=fixture(),m=f.message();let release:()=>void=()=>{};const waiting=new Promise<void>(r=>release=r);let started:()=>void=()=>{};const entered=new Promise<void>(r=>started=r);
  f.deps.analyze=async()=>{started();await waiting;return {intent:'answer',answer:'Hello'};};
  const first=processReceptionSms('org',m,f.client,f.deps);await entered;
  const duplicate=await processReceptionSms('org',m,f.client,f.deps);assert.equal(duplicate.status,'needs_review');release();await first;assert.equal(f.sent.length,1);
});

test('permission revocation during generation and mismatched receiving identity block sending',async()=>{
  const f=fixture();f.deps.analyze=async()=>{f.deps.profile=async()=>({primaryPersonId:'different',automaticActions:['sms']});return {intent:'answer',answer:'Secret'};};
  assert.equal((await processReceptionSms('org',f.message(),f.client,f.deps)).status,'needs_review');assert.equal(f.sent.length,0);
  const g=fixture();const m=g.message();g.deps.client=()=>({getCommunication:async()=>({...m,recipients:['+61400000099']})});
  assert.equal((await processReceptionSms('org',m,g.client,g.deps)).status,'needs_review');assert.equal(g.sent.length,0);
});
