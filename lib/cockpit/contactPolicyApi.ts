import {readContactPolicy,saveContactPolicy,readTenantAgentProfile,requireOrganizationMember} from '../serverStore.js';
import {normalizeContactPolicy,policyDefaults,evaluateContactPolicy} from './businessHours.js';
import {FlowError} from '../visibleFlows/model.js';
const defaults={member:requireOrganizationMember,profile:readTenantAgentProfile,read:readContactPolicy,save:saveContactPolicy};
export async function handleContactPolicy(request:{method?:string;body?:any;query?:any},member:{orgId:string;uid:string;apiClientId?:string},deps=defaults){
  const body=request.body||{};
    const actor=await deps.member(member.uid,member.orgId);
    if(!['owner','admin'].includes(actor.role)) throw new FlowError(403,'An administrator must review contact policy.');
    const profile=await deps.profile(member.orgId);
    const stored=await deps.read(member.orgId);
    const current=stored||policyDefaults(profile?.timezone,profile?.contactWindow||{startHour:9,endHour:17});
    if(request.method==='GET') return {enabled:process.env.CONTACT_POLICY_V2_ENABLED==='true',policy:current,migrated:!!stored,newConfigurationDefaults:policyDefaults(profile?.timezone)};
    if(request.method!=='POST')throw new FlowError(405,'Use GET or POST.');
    if(!['contact_policy_preview','contact_policy_apply'].includes(body.operation))throw new FlowError(422,'Choose preview or apply.');
    let proposal;try{proposal=normalizeContactPolicy(body.policy);}catch(e:any){throw new FlowError(422,e.message);} 
    if(!Number.isInteger(body.expectedRevision)||(body.operation!=='contact_policy_apply'&&body.expectedRevision!==current.revision)) throw new FlowError(409,'Contact policy changed; reload and review again.');
    if(body.operation==='contact_policy_apply') {
      if(member.apiClientId)throw new FlowError(403,'A human session must approve contact policy changes.');
      const {createHash}=await import('node:crypto');
      const hash=createHash('sha256').update(JSON.stringify(proposal)).digest('hex');
      if(body.planHash!==hash) throw new FlowError(409,'Review the exact policy before applying.');
      try {
        return {policy:await deps.save(member.orgId,proposal,body.expectedRevision,`${member.uid}:${body.expectedRevision}:${hash}`),notice:'Contact policy saved. No message was replayed.'};
      } catch (error:any) {
        if (/Contact policy changed|Request ID reused/.test(error.message)) throw new FlowError(409,error.message);
        throw error;
      }
    }
    const {createHash}=await import('node:crypto');
    return {policy:proposal,planHash:createHash('sha256').update(JSON.stringify(proposal)).digest('hex'),expectedRevision:current.revision,
      preview:evaluateContactPolicy(proposal,{orgId:member.orgId,target:'preview',channel:'sms',now:Date.now()}),note:'Inbound replies require a persisted matching source. Saving does not enable reception or grant action permissions.'};
}
