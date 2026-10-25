import test from 'node:test';
import assert from 'node:assert/strict';
import {selectOperatingItems,answerOperatingQuestion,relationshipItems,type OperatingSnapshot,type OperatingItem} from '../lib/cockpit/model';
import {claimContactDay,normalizeContactWindow,contactWindowOpen} from '../lib/cockpit/contactPolicy';
const now=Date.parse('2026-09-09T00:00:00Z');
test('contact claims preserve audited releases, normalize sparse storage and refuse released operation replay',()=>{
  const released={operationId:'unused',target:'+61400000001',channel:'voice',at:now,releasedAt:now+1,actor:'owner',reason:'Verified failure before provider dispatch',evidence:{approvedSnapshot:false}};
  const current={attempts:[{operationId:'real',target:released.target,channel:'voice',at:now},null],releasedAttempts:{receipt:released}} as unknown as import('../lib/cockpit/contactPolicy').ContactDay;
  const policy=normalizeContactWindow({startHour:9,endHour:17,maxPerDay:2,maxPerContact:2});
  const replay=claimContactDay(current,{...released,now:now+1000,coalesce:false},policy);
  assert.equal(replay.allowed,false);
  const next=claimContactDay(current,{...released,operationId:'new',now:now+1000,coalesce:false},policy);
  assert.equal(next.allowed,true);
  assert.equal(next.row.attempts.length,2);
  assert.deepEqual(next.row.releasedAttempts,{receipt:released});
  assert.equal(current.attempts.length,2);
  assert.equal(claimContactDay(next.row,{...released,operationId:'fourth',now:now+2000,coalesce:false},policy).allowed,false);
});
const item=(id:string,owner:string,beneficiary:string,state='accepted'):OperatingItem=>({id,version:1,projectId:'alpha',deliverable:`Deliver ${id}`,owner,beneficiary,dueAt:'2026-09-09T17:00:00+10:00',timezone:'Australia/Brisbane',state,needsDecision:false,reviewerUid:'ceo',updatedAt:now,sourceChanged:false,sourceCommunicationIds:['source-a']});
const snapshot:OperatingSnapshot={owner:'hyperflow',viewerUid:'ceo',timezone:'Australia/Brisbane',asOf:new Date(now).toISOString(),items:[item('mine','user:ceo','contact:alex'),item('owed','contact:alex','user:ceo'),item('other','contact:pat','contact:lee'),{...item('decision','user:ceo','contact:alex','candidate'),needsDecision:true},item('done','contact:alex','user:ceo','fulfilled')],contacts:[{id:'alex',name:'Alex Smith'},{id:'pat',name:'Pat Lee'}],flows:[],incomplete:false,notices:[]};
test('cockpit separates accepted production, waiting, decisions and fulfilled work in the user timezone',()=>{
  assert.deepEqual(selectOperatingItems(snapshot,'today',undefined,now).map(r=>r.id),['mine']);
  assert.deepEqual(selectOperatingItems(snapshot,'waiting',undefined,now).map(r=>r.id),['owed']);
  assert.deepEqual(selectOperatingItems(snapshot,'decisions',undefined,now).map(r=>r.id),['decision']);
  assert.equal(answerOperatingQuestion(snapshot,'What does Alex Smith owe?').items.some(r=>r.id==='other'),false);
  assert.deepEqual(answerOperatingQuestion(snapshot,'What does Alex Smith owe?').items.map(r=>r.id),['owed']);
  assert.deepEqual(answerOperatingQuestion(snapshot,'What is Alex Smith due to deliver?').items.map(r=>r.id),['owed']);
  assert.match(answerOperatingQuestion(snapshot,'Who am I waiting on?').answer,/Alex Smith owes Me/);
  assert.equal(answerOperatingQuestion(snapshot,'What is the weather?').items.length,0);
});
test('relationship projection needs an explicit project grant and excludes other parties, candidates and internal source details',()=>{
  assert.deepEqual(relationshipItems(snapshot,'alex',[]),[]);
  const shared=relationshipItems(snapshot,'alex',['alpha']);
  assert.deepEqual(shared.map(r=>r.id),['mine','owed']);
  assert.doesNotMatch(JSON.stringify(shared),/source-a|reviewerUid|contact:pat/);
});
test('shared contact claims coalesce across SMS and phone and enforce daily limits without spending on denied attempts',()=>{
  const policy=normalizeContactWindow({startHour:9,endHour:17,maxPerDay:2,maxPerContact:1});
  assert.equal(contactWindowOpen(now,'Australia/Brisbane',policy),true);
  assert.equal(contactWindowOpen(Date.parse('2026-09-08T14:00:00Z'),'Australia/Brisbane',policy),false);
  const first=claimContactDay(null,{operationId:'one',target:'+61415828522',channel:'sms',now,coalesce:true},policy);assert.equal(first.allowed,true);
  const second=claimContactDay(first.row,{operationId:'two',target:'+61415828522',channel:'voice',now:now+1000,coalesce:true},policy);assert.equal(second.allowed,false);assert.match(second.reason,/follow-up/);assert.equal(second.row.attempts.length,1);
  const replay=claimContactDay(first.row,{operationId:'one',target:'+61415828522',channel:'sms',now,coalesce:false},policy);assert.equal(replay.allowed,false);
  const limit=claimContactDay(first.row,{operationId:'three',target:'+61415828522',channel:'sms',now:now+3600001,coalesce:false},policy);assert.equal(limit.allowed,false);assert.match(limit.reason,/budget/);
  assert.throws(()=>normalizeContactWindow({startHour:17,endHour:9,maxPerDay:2,maxPerContact:1}),/valid/);
});
