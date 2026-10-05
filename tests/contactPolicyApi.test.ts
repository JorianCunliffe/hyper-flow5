import test from 'node:test';
import assert from 'node:assert/strict';
import {handleContactPolicy} from '../lib/cockpit/contactPolicyApi.js';
import {applyContactPolicyRevision,policyDefaults} from '../lib/cockpit/businessHours.js';
const admin={orgId:'a',uid:'admin'};
function fixture(){const rows=new Map<string,any>();let role='admin';const deps:any={member:async()=>({role}),profile:async()=>({timezone:'Australia/Brisbane',contactWindow:{startHour:9,endHour:17}}),read:async(org:string)=>rows.get(org)||null,save:async(org:string,p:any,r:number,id:string)=>{const next=applyContactPolicyRevision(rows.get(org),p,r,id);rows.set(org,next);return next;}};return {deps,rows,setRole:(r:string)=>{role=r;}};}
test('contact policy review/apply/replay is tenant isolated and human-only',async()=>{
 const f=fixture(),policy=policyDefaults();
 const migrated:any=await handleContactPolicy({method:'GET'},admin,f.deps);assert.equal(migrated.policy.replies.mode,'queue');assert.equal(migrated.newConfigurationDefaults.replies.mode,'reply');
 const review:any=await handleContactPolicy({method:'POST',body:{operation:'contact_policy_preview',policy,expectedRevision:0}},admin,f.deps);assert.equal(f.rows.size,0);
 const body={operation:'contact_policy_apply',...review};
 await assert.rejects(handleContactPolicy({method:'POST',body},{...admin,apiClientId:'agent'},f.deps),/human session/);
 await handleContactPolicy({method:'POST',body},admin,f.deps);await handleContactPolicy({method:'POST',body},admin,f.deps);assert.equal(f.rows.get('a').revision,1);assert.equal(f.rows.has('b'),false);
 await assert.rejects(handleContactPolicy({method:'POST',body:{...body,policy:{...policy,replies:{...policy.replies,mode:'queue'}}}},admin,f.deps),/exact policy/);
 f.setRole('member');await assert.rejects(handleContactPolicy({method:'GET'},admin,f.deps),/administrator/);
});
test('invalid contact policy and stale previews are rejected without writes',async()=>{
 const f=fixture();await assert.rejects(handleContactPolicy({method:'POST',body:{operation:'contact_policy_preview',expectedRevision:0,policy:{}}},admin,f.deps),/revision/);
 await assert.rejects(handleContactPolicy({method:'POST',body:{operation:'contact_policy_preview',expectedRevision:2,policy:policyDefaults()}},admin,f.deps),/changed/);assert.equal(f.rows.size,0);
});

test('a reviewed apply racing a newer policy returns a conflict',async()=>{
 const f=fixture();const policy=policyDefaults();
 const review:any=await handleContactPolicy({method:'POST',body:{operation:'contact_policy_preview',expectedRevision:0,policy}},admin,f.deps);
 f.rows.set('a',{...policy,revision:1});
 await assert.rejects(handleContactPolicy({method:'POST',body:{operation:'contact_policy_apply',...review}},admin,f.deps),(e:any)=>e.status===409);
 assert.equal(f.rows.get('a').revision,1);
});
