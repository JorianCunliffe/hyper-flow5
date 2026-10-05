import test from 'node:test';
import assert from 'node:assert/strict';
import {policyDefaults,evaluateContactPolicy,hoursOpen,normalizeContactPolicy,nextOpening,validateHours,restrictReplyMode} from '../lib/cockpit/businessHours.js';
import {allowedReceptionActions} from '../lib/reception/model.js';
const now=Date.parse('2026-10-05T09:00:36Z'); // 19:00 Brisbane, reported SMS
const policy=policyDefaults();
const source:any={id:'sms',tenantId:'org',personId:'jorian',direction:'inbound',channel:'sms',sender:'+61400000001',recipients:['+61400000002'],occurredAt:new Date(now-1000).toISOString()};
const input={orgId:'org',target:source.sender,from:source.recipients[0],channel:'sms',source,now};
test('7pm verified inbound reply allowed, proactive call deferred, legacy stays restricted',()=>{
  const reply=evaluateContactPolicy(policy,input);assert.equal(reply.status,'allowed');assert.equal(reply.reactive,true);assert.match(reply.notice!,/outside business hours/);
  assert.equal(evaluateContactPolicy(policy,{...input,source:undefined,channel:'voice'}).status,'deferred');
  assert.equal(evaluateContactPolicy(policyDefaults('Australia/Brisbane',{startHour:9,endHour:17}),input).status,'deferred');
});
test('source identity, tenant, channel, receiving line and age cannot be forged into reply authority',()=>{
  for(const patch of [{tenantId:'other'},{personId:''},{direction:'outbound'},{channel:'voice'},{sender:'+61400000003'},{recipients:['+61400000004']},{recipients:[input.from,'+61400000004']},{occurredAt:new Date(now-25*3600000).toISOString()},{occurredAt:new Date(now+1000).toISOString()}]) assert.equal(evaluateContactPolicy(policy,{...input,source:{...source,...patch}}).status,'needs_review');
  assert.equal(evaluateContactPolicy(policy,{...input,channel:'voice',source:{...source,channel:'voice'}}).status,'needs_review');
});
test('overnight weekday windows and dated closures use the actual local date',()=>{
  const h=validateHours({days:[1],start:'22:00',end:'02:00',closures:[]});
  assert.equal(hoursOpen(h,'Australia/Brisbane',Date.parse('2026-10-05T13:00:00Z')),true);
  assert.equal(hoursOpen(h,'Australia/Brisbane',Date.parse('2026-10-05T15:00:00Z')),true);
  assert.equal(hoursOpen({...h,closures:['2026-10-06']},'Australia/Brisbane',Date.parse('2026-10-05T15:00:00Z')),false);
  assert.equal(hoursOpen(h,'Australia/Brisbane',Date.parse('2026-10-06T13:00:00Z')),false);
  assert.throws(()=>validateHours({...h,closures:['2026-02-30']}));
});
test('queue and acknowledgement compute next intersection of line/project/workspace opening hours',()=>{
  const p=normalizeContactPolicy({...policy,replies:{...policy.replies,mode:'acknowledge'}});
  const r=evaluateContactPolicy(p,{...input,businessHours:{days:[2],start:'11:00',end:'16:00'},projectHours:{days:[2],start:'12:00',end:'15:00'}});
  assert.equal(r.status,'allowed');assert.equal(r.nextEligibleAt,Date.parse('2026-10-06T02:00:00Z'));
  assert.equal(evaluateContactPolicy(p,{...input,mode:'queue'}).status,'deferred');
  assert.equal(restrictReplyMode('queue','reply'),'queue');
});
test('expiry escalates, no opening never retries forever, end 24:00 preserves legacy window',()=>{
  const p={...policy,outbound:{...policy.outbound,days:[0]},replies:{...policy.replies,mode:'queue' as const}};
  assert.equal(evaluateContactPolicy(p,input).status,'needs_review');
  assert.equal(evaluateContactPolicy(policy,{...input,now:now+24*3600000}).status,'needs_review');
  assert.equal(hoursOpen(policyDefaults('Australia/Brisbane',{startHour:0,endHour:24}).outbound,'Australia/Brisbane',Date.parse('2026-10-05T13:59:59Z')),true);
});
test('DST next opening searches real instants and restricted actions cannot inherit extra authority',()=>{
  const h={days:[0],start:'03:00',end:'04:00'};
  assert.equal(nextOpening(h,'Australia/Sydney',Date.parse('2026-10-03T15:59:00Z')),Date.parse('2026-10-03T16:00:00Z'));
  const line:any={timezone:'Australia/Brisbane',hours:policy.outbound};const project:any={actions:['availability','booking'],afterHoursActions:['availability','resume_ask']};
  assert.deepEqual(allowedReceptionActions(line,project,now),['availability']);
});

test('policy saves reject stale revisions and changed retries; exact lost-response replay is idempotent',async()=>{
  const {applyContactPolicyRevision}=await import('../lib/cockpit/businessHours.js');
  const first=applyContactPolicyRevision(null,policy,0,'op1');assert.equal(first.revision,1);
  assert.deepEqual(applyContactPolicyRevision(first,policy,0,'op1'),first);
  assert.throws(()=>applyContactPolicyRevision(first,{...policy,replies:{...policy.replies,mode:'queue'}},0,'op1'),/different policy/);
  assert.throws(()=>applyContactPolicyRevision(first,policy,0,'op2'),/changed/);
});
test('setup scope and private storage never let an element or browser widen contact authority',async()=>{
  const {scopedExtras}=await import('../lib/setupAssistant/safety.js');
  const {readFileSync}=await import('node:fs');
  assert.throws(()=>scopedExtras({kind:'element',projectId:'p',nodeId:'n'},{contactPolicy:policy}),/expand scope/);
  assert.doesNotThrow(()=>scopedExtras({kind:'workflow',projectId:'p',workspaceContactPolicy:true},{contactPolicy:policy}));
  const rules=JSON.parse(readFileSync('database.rules.json','utf8')).rules;
  for(const name of ['contact_policies','contact_dispatch_operations','contact_reply_notices']){assert.equal(rules[name]['.read'],false);assert.equal(rules[name]['.write'],false);assert.match(rules[name].$orgId['.write'],/hyperflow_runtime/);}
});
