/** Communications owns these records. They are evidence, not accepted obligations. */
export interface PromiseParty {ref:string;person_id:string|null;label:string;role:string}
export interface PromiseRecord {
  id:string;revision:number;description:string;original_wording:string;thread_id:string|null;external_project_id:string|null;
  promisor_parties:PromiseParty[];promisee_parties:PromiseParty[];joint:boolean;origin:string;review_state:string;observed_state:string;
  source_current:boolean;unresolved:boolean;overdue:boolean;source_communication_ids:string[];
  people:Array<{id:string;name:string;email?:string;phone_number?:string}>;
  due_interpretation:{wording?:string;instant?:string;status?:string;assumptions?:string[]};
  evidence:Array<{id:string;quote:string;kind:string;current:boolean;communication_id:string;segment_id?:string;speaker:{label:string;attribution?:string}}>; 
  history?:Array<{id:string;revision:number;action:string;actor:string;reason:string;created_at:string}>;
}
export interface PromisePage {contract_version:'promise-ledger.v1';data:PromiseRecord[];next:string|null}
