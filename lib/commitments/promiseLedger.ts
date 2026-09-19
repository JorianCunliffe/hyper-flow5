import { HttpCommunicationsClient } from '../communications/client.js';
import { listTenantProjects, readTenantAgentProfile } from '../serverStore.js';
import { CommitmentError, type CommitmentSource } from './model.js';
import type { PromiseRecord } from '../communications/promiseTypes.js';

export function ledgerSource(row:PromiseRecord):CommitmentSource {
  if(!row.source_current||['deleted','dismissed','retracted'].includes(row.review_state))throw new CommitmentError(409,'Promise evidence changed or was dismissed. Refresh it before review.');
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
  const operations=['query','read','review','coverage','create','update','delete','condition_create','condition_update','condition_delete','evidence_add'];
  if(input.operation && !operations.includes(input.operation) && input.operation!=='link')throw new CommitmentError(400,'Unknown ledger operation.');
  const operation=input.operation||'query';
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
  const mutation=['create','update','delete','condition_create','condition_update','condition_delete','evidence_add'].includes(operation);
  if(mutation){
    const patch=input.patch||{};
    if(operation==='create' && (!project || (patch.external_project_id && patch.external_project_id!==project)))throw new CommitmentError(400,'Choose a project for the promise.');
    if('external_project_id' in patch && !allowed.includes(patch.external_project_id))throw new CommitmentError(403,'Destination project is not accessible.');
    if(operation!=='create')await client.promiseLedger(member.orgId,'read',{...scope,id:input.promiseId});
    return client.promiseLedger(member.orgId,operation,{...scope,allowed_project_ids:allowed,id:input.promiseId,condition_id:input.conditionId,
      expected_revision:input.expectedRevision,reason:input.reason,initiator_id:member.uid,
      patch:{...patch,...(operation==='create'?{external_project_id:project}:{})}});
  }
  return client.promiseLedger(member.orgId,operation,{
    ...scope,id:input.promiseId,after:input.after,offset:input.offset,limit:50,
    status:input.status,unresolved:input.unresolved===true,review_state:input.reviewState,direction:input.direction,
    ...(operation==='review'?{action:input.reviewAction,expected_revision:input.expectedRevision,reason:input.reason,patch:input.patch||{},initiator_id:member.uid}:{})
  });
}
