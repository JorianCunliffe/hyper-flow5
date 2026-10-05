import React from 'react';
import {createRoot} from 'react-dom/client';
import {ContactPolicyEditor} from '../../components/ContactPolicyEditor';
import {policyDefaults,normalizeContactPolicy,evaluateContactPolicy} from '../../lib/cockpit/businessHours';
let stored=policyDefaults('Australia/Brisbane',{startHour:9,endHour:17});
const transport=async(body?:any)=>{
  if(!body)return {policy:structuredClone(stored),enabled:true};
  const policy=normalizeContactPolicy(body.policy);
  if(body.expectedRevision!==stored.revision)throw new Error('Stale policy');
  if(body.operation==='contact_policy_apply'){if(body.planHash!==JSON.stringify(policy))throw new Error('Review required');stored={...policy,revision:stored.revision+1};return {policy:stored,notice:'Fixture policy saved. No provider calls or production changes.'};}
  return {policy,planHash:JSON.stringify(policy),expectedRevision:stored.revision,preview:evaluateContactPolicy(policy,{orgId:'fixture',channel:'sms',target:'preview',now:Date.parse('2026-10-05T09:00:36Z')}),note:'Fixture preview only. No SMS is sent.'};
};
createRoot(document.getElementById('root')!).render(<main><h1>Contact policy browser fixture</h1><p>Isolated transport · no provider calls</p><ContactPolicyEditor transport={transport}/></main>);
