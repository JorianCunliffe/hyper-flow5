import test from 'node:test';
import assert from 'node:assert/strict';
import { handleContacts } from '../lib/communications/contacts.js';
import { requestScope } from '../lib/tenantControl/clients.js';
const member = {uid:'u',orgId:'tenant-a',role:'admin' as const,apiClientId:'scoped-client'};
const input = {name:'Carol',phone_number:'+61414022817'};
test('contact creation uses authenticated tenant and whitelist payload', async () => {
 const calls: unknown[]=[];
 const result=await handleContacts({method:'POST',body:input},member,{
 listPeople:async tenant=>{assert.equal(tenant,'tenant-a');return [];},
 createPerson:async (tenant,body)=>{calls.push([tenant,body]);return {id:'p',name:body.name,phone:body.phone_number};}
 });
 assert.equal(result.status,201); assert.deepEqual(calls,[['tenant-a',input]]);
});
test('contact creation rejects members, tenant overrides and invalid phones before provider calls',async()=>{
 for(const [body,role,status] of [[input,'member',403],[{...input,tenantId:'other'},'admin',400],[{...input,phone_number:'0414022817'},'admin',400]] as const){
 await assert.rejects(handleContacts({method:'POST',body},{...member,role}), (e:any)=>e.status===status);
 }
});
test('matching contact is reused and conflicting identity rejected',async()=>{
 let creates=0;
 const client={listPeople:async()=>[{id:'p',name:'Carol',phone:input.phone_number}],createPerson:async()=>{creates++;return {id:'new'};}};
 assert.equal((await handleContacts({method:'POST',body:input},member,client)).status,200);
 await assert.rejects(handleContacts({method:'POST',body:{...input,name:'Other'}},member,client),(e:any)=>e.status===409);
 assert.equal(creates,0);
});
test('canonical and dispatcher contact routes require matching machine scopes',()=>{
 for(const method of ['GET','POST']){
 const expected=`communications:${method==='GET'?'read':'write'}`;
 assert.equal(requestScope({url:'/api/communications/contacts',method}),expected);
 assert.equal(requestScope({url:'/api/communications/status?action=contacts',method}),expected);
 }
});

test('upstream contact transport supplies trusted tenant and key and maps response',async()=>{
 const { HttpCommunicationsClient }=await import('../lib/communications/clientCore.js');
 const client=new HttpCommunicationsClient({baseUrl:'https://example.test',apiKey:'test-only',fetchImpl:async(url,init)=>{
 assert.equal(String(url),'https://example.test/v1/contacts');
 assert.equal((init?.headers as Record<string,string>)['X-Tenant-Id'],'tenant-a');
 assert.equal((init?.headers as Record<string,string>)['X-API-Key'],'test-only');
 assert.equal(init?.method,'POST'); assert.deepEqual(JSON.parse(String(init?.body)),input);
 return new Response(JSON.stringify({person_id:'p',name:'Carol',phone_number:input.phone_number}),{status:201});
 }});
 assert.deepEqual(await client.createPerson('tenant-a',input),{id:'p',name:'Carol',phone:input.phone_number});
});
