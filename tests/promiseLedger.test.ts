import {test} from 'node:test';
import assert from 'node:assert/strict';
import {handlePromiseLedger,ledgerSource} from '../lib/commitments/promiseLedger.js';
import {applyPromiseRevision} from '../lib/commitments/promiseEvents.js';
import {createCommitment} from '../lib/commitments/model.js';
import {HttpCommunicationsClient} from '../lib/communications/clientCore.js';

test('ledger adapter derives tenant/project/private scope and reviewer identity on the server',async()=>{
 let seen:any;
 await handlePromiseLedger({orgId:'tenant',uid:'reviewer'},{operation:'review',promiseId:'p',projectId:'alpha',reviewAction:'confirm',expectedRevision:2,reason:'Checked',include_private:true,allowed_project_ids:['secret'],initiator_id:'forged'},
  {projects:async()=>[{id:'alpha'}] as any,settings:async()=>({primaryPersonId:'person'}) as any,client:{promiseLedger:async(...args)=>{seen=args;return {};}}});
 assert.equal(seen[0],'tenant');assert.deepEqual(seen[2].allowed_project_ids,['alpha']);assert.equal(seen[2].include_private,false);assert.equal(seen[2].initiator_id,'reviewer');
 await assert.rejects(()=>handlePromiseLedger({orgId:'tenant',uid:'reviewer'},{projectId:'secret'}, {projects:async()=>[{id:'alpha'}] as any}),/not accessible/);
});
test('joint promise evidence keeps both source promisors and cannot be imported stale',()=>{
 const source:any={id:'p',revision:4,description:'We will send the report.',source_current:true,review_state:'needs_review',thread_id:'t',source_communication_ids:['c'],promisor_parties:[{person_id:'alice'},{person_id:'bob'}]};
 assert.deepEqual(ledgerSource(source).jointPromisorIds,['alice','bob']);assert.equal(ledgerSource(source).version,'ledger:4');
 assert.throws(()=>ledgerSource({...source,source_current:false}),/changed/);
});
test('promise events are revision-idempotent and preserve accepted obligation terms',()=>{
 const row=createCommitment({id:'ob_a',orgId:'tenant',projectId:'alpha',actor:'ceo',now:1,askId:'a',source:{id:'p',version:'ledger:1',wording:'Old wording',communicationIds:['c'],provider:'promise-ledger.v1'},terms:{deliverable:'Accepted report'}});
 row.state='accepted';row.acceptedEvidence='Reviewed by CEO';
 const changed=applyPromiseRevision(row,'p',3,10);assert.equal(changed.sourceChanged,true);assert.equal(changed.state,'accepted');assert.deepEqual(changed.terms,row.terms);
 assert.equal(applyPromiseRevision(changed,'p',3,11),changed);assert.equal(applyPromiseRevision(changed,'p',2,12),changed);assert.equal(applyPromiseRevision(changed,'other',4,12),changed);
});
test('ledger client uses tenant credentials and encoded promise routes',async()=>{
 let url='',headers:any;
 const client=new HttpCommunicationsClient({baseUrl:'https://communications.example',apiKey:'test-only',fetchImpl:async(input,init)=>{url=String(input);headers=init?.headers;return new Response(JSON.stringify({id:'p'}),{status:200});}});
 await client.promiseLedger('tenant','read',{id:'p/one'});assert.ok(url.endsWith('/v1/promises/p%2Fone/read'));assert.equal(new Headers(headers).get('X-Tenant-Id'),'tenant');
});

test('association correction reads the permitted source and rejects an inaccessible destination',async()=>{
 let correction:any;
 const deps={projects:async()=>[{id:'alpha'},{id:'beta'}] as any,settings:async()=>null,client:{promiseLedger:async()=>({communication_id:'canonical_source'}),correctThread:async(...args:any[])=>{correction=args;return {} as any;}}};
 await handlePromiseLedger({orgId:'tenant',uid:'reviewer'},{operation:'link',promiseId:'p',projectId:'alpha',targetProjectId:'beta',reason:'This belongs to the other project'},deps);
 assert.equal(correction[1],'canonical_source');assert.equal(correction[2].external_project_id,'beta');assert.equal(correction[2].initiator_id,'reviewer');
 await assert.rejects(()=>handlePromiseLedger({orgId:'tenant',uid:'reviewer'},{operation:'link',promiseId:'p',targetProjectId:'secret',reason:'Move'},deps),/accessible project/);
});
