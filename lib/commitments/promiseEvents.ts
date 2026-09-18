import { listTenantProjects, listOperationalCommitments, transactOperationalCommitment } from '../serverStore.js';
import { CommitmentError, type Commitment } from './model.js';

export function applyPromiseRevision(current:Commitment,promiseId:string,revision:number,now:number):Commitment {
  if(current.source?.id!==promiseId)return current;
  const prior=Number((current.observedSourceVersion||current.source.version).replace(/^ledger:/,''));
  if(Number.isFinite(prior)&&prior>=revision)return current;
  const version=current.version+1;
  return {...current,sourceChanged:true,observedSourceVersion:`ledger:${revision}`,version,updatedAt:now,
    ...(current.review?{review:{...current.review,version,ask:{...current.review.ask,revision:version}}}:{}),
    history:[...current.history,{version,at:now,actor:'communications-service',action:'source_changed',note:`Promise evidence revision ${revision}; accepted terms are unchanged.`}]};
}
/** No automatic acceptance, fulfillment, message sending, or flow transitions. */
export async function receivePromiseChange(orgId:string,payload:Record<string,any>) {
  const id=String(payload.promise_id||'');const revision=Number(payload.revision);
  if(payload.contract_version!=='promise-ledger.v1'||!id||!Number.isSafeInteger(revision)||revision<1)throw new Error('Valid promise ID and revision required');
  const allowed=new Set((await listTenantProjects(orgId)).map(p=>String(p.id)));
  let after='';
  do {
    const page=await listOperationalCommitments(orgId,after,100);
    for(const row of page.rows)if(allowed.has(row.projectId)&&row.source?.id===id)
      await transactOperationalCommitment(orgId,row.id,current=>{
        if(!current)throw new CommitmentError(404,'Obligation no longer exists.');
        return applyPromiseRevision(current,id,revision,Date.now());
      });
    after=page.next||'';
  }while(after);
}
