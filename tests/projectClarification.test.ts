import test from 'node:test';
import assert from 'node:assert/strict';
import {matchProjectReferences,isProjectSelection} from '../lib/projectReferences.js';
import {clarificationKey,clarificationQuestion} from '../lib/projectClarification.js';
import {decideProjectRoute} from '../lib/agentRouter.js';

const projects=[{id:'old',name:'Cairns Sharehouse — Morning Run'},{id:'v2',name:'Cairns Sharehouse — Morning Run v2'}];
const labels=(p:typeof projects[number])=>[p.name];
test('specific v2 reference wins but separate mentions and shared aliases stay ambiguous',()=>{
 assert.deepEqual(matchProjectReferences('Cairns sharehouse morning run v2',projects,labels).map(x=>x.id),['v2']);
 assert.equal(matchProjectReferences('Compare Cairns Sharehouse Morning Run and Cairns Sharehouse Morning Run v2',projects,labels).length,2);
 assert.equal(matchProjectReferences('Sharehouse',projects,()=>['Sharehouse']).length,2);
 const result=decideProjectRoute({content:'Cairns sharehouse morning run v2',projects:projects as any,personId:'p',profile:{primaryPersonId:'p',allowedProjectIds:['old','v2']} as any});
 assert.equal(result.projectId,'v2');assert.equal(result.reason,'explicit_reference');
 assert.equal(isProjectSelection('I meant Cairns Sharehouse Morning Run v2 please',labels(projects[1])),true);
 assert.equal(isProjectSelection('For Cairns Sharehouse Morning Run v2, what is the rent?',labels(projects[1])),false);
});
const now=Date.parse('2026-10-06T00:20:00Z');
const source:any={id:'q',tenantId:'org',personId:'p',direction:'inbound',channel:'sms',sender:'+61400000001',recipients:['+61400000002'],occurredAt:new Date(now-60000).toISOString(),content:'What did I last do for the acceptance test?'};
const current:any={...source,id:'answer',threadId:'new-thread',occurredAt:new Date(now).toISOString(),content:'Cairns sharehouse morning run v2'};
const pending:any={orgId:'org',personId:'p',clarificationState:'awaiting_project',pendingCommunicationId:'q',candidateProjectIds:['old','v2'],receivingIdentity:'+61400000002',expiresAt:now+60000};
test('verified project clarification retains original question across provider thread changes',()=>{
 assert.equal(clarificationKey('p',source),clarificationKey('p',current));
 assert.match(clarificationQuestion(pending,source,current,'v2',now)!,/Original question: What did I last do/);
});
test('clarifications cannot cross tenant, person, number, permission candidates, channel or expiry',()=>{
 for(const change of [{tenantId:'other'},{personId:'other'},{sender:'+61499999999'},{recipients:['+61400000003']},{channel:'voice'},{direction:'outbound'},{occurredAt:'invalid'}])
   assert.equal(clarificationQuestion(pending,source,{...current,...change},'v2',now),undefined);
 assert.equal(clarificationQuestion(pending,source,current,'private',now),undefined);
 assert.equal(clarificationQuestion({...pending,expiresAt:now},source,current,'v2',now),undefined);
 assert.equal(clarificationQuestion(pending,{...source,id:'wrong'},current,'v2',now),undefined);
 assert.equal(clarificationQuestion(pending,{...source,occurredAt:new Date(now-16*60000).toISOString()},current,'v2',now),undefined);
 assert.equal(clarificationKey('other',current),undefined);
});
