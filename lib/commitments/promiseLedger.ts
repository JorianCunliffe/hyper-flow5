import { HttpCommunicationsClient } from '../communications/client.js';
import { listTenantProjects, readTenantAgentProfile } from '../serverStore.js';
import { CommitmentError, type CommitmentSource } from './model.js';
import type { PromiseRecord } from '../communications/promiseTypes.js';

export function ledgerSource(row:PromiseRecord):CommitmentSource {
  if(!row.source_current||['dismissed','retracted'].includes(row.review_state))throw new CommitmentError(409,'Promise evidence changed or was dismissed. Refresh it before review.');
  return {id:row.id,version:`ledger:${row.revision}`,wording:row.description,communicationIds:row.source_communication_ids,
    ...(row.thread_id?{threadId:row.thread_id}:{}),provider:'promise-ledger.v1',
    jointPromisorIds:row.promisor_parties.map(p=>p.person_id).filter((id):id is string=>Boolean(id))};
}

export async function handlePromiseLedger(member:{orgId:string;uid:string},input:Record<string,any>,deps:{
  projects?:typeof listTenantProjects;settings?:typeof readTenantAgentProfile;
  client?:Pick<HttpCommunicationsClient,'promiseLedger'> & Partial<Pick<HttpCommunicationsClient,'correctThread'>>;
}={}) {
  const projects=await (deps.projects||listTenantProjects)(member.orgId);
  const allowed=projects.map(p=>String(p.id));
  const project=typeof input.projectId==='string'?input.projectId:'';
  if(project&&!allowed.includes(project))throw new CommitmentError(403,'Project is not accessible in this organization.');
  const settings=await (deps.settings||readTenantAgentProfile)(member.orgId);
  const operation=['read','review','coverage'].includes(input.operation)?input.operation:'query';
  const scope={allowed_project_ids:project?[project]:allowed,include_private:false,
    ...(project?{external_project_id:project}:{}),
    ...(!project&&settings?.primaryPersonId?{unassigned_person_id:settings.primaryPersonId}:{}),
    ...(input.personId?{person_id:String(input.personId)}:{}),...(input.threadId?{thread_id:String(input.threadId)}:{})};
  const client=deps.client||new HttpCommunicationsClient();
  if(input.operation==='link'){
    if(!allowed.includes(input.targetProjectId)||typeof input.reason!=='string'||!input.reason.trim())throw new CommitmentError(400,'An accessible project and correction reason are required.');
    const row=await client.promiseLedger(member.orgId,'read',{...scope,id:input.promiseId});
    if(!client.correctThread)throw new CommitmentError(503,'Thread correction unavailable.');
    return client.correctThread(member.orgId,row.communication_id,{...(input.targetThreadId?{thread_id:input.targetThreadId}:{create_new:true}),
      external_project_id:input.targetProjectId,reason_code:'wrong_project',reason_detail:input.reason.slice(0,2000),initiator_id:member.uid});
  }
  return client.promiseLedger(member.orgId,operation,{
    ...scope,id:input.promiseId,after:input.after,offset:input.offset,limit:50,
    status:input.status,unresolved:input.unresolved===true,review_state:input.reviewState,direction:input.direction,
    ...(operation==='review'?{action:input.reviewAction,expected_revision:input.expectedRevision,reason:input.reason,patch:input.patch||{},initiator_id:member.uid}:{})
  });
}
