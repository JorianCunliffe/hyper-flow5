import type {ConversationContext} from '../types.js';
import type {CommunicationResult} from './communications/types.js';

export function clarificationKey(personId:string|undefined,communication:CommunicationResult):string|undefined {
  if(!personId||communication.personId!==personId||communication.channel!=='sms'||communication.direction!=='inbound'||communication.recipients?.length!==1)return;
  return `pending-project:${personId}:${communication.recipients[0]}`;
}
export function clarificationQuestion(context:ConversationContext|null,source:CommunicationResult,current:CommunicationResult,projectId:string,now=Date.now()):string|undefined {
  if(!context||context.clarificationState!=='awaiting_project'||context.expiresAt<=now||
    !context.candidateProjectIds?.includes(projectId)||source.id!==context.pendingCommunicationId||source.id===current.id||
    source.tenantId!==context.orgId||current.tenantId!==context.orgId||!context.personId||
    source.personId!==context.personId||current.personId!==context.personId||source.direction!=='inbound'||current.direction!=='inbound'||
    source.channel!=='sms'||current.channel!=='sms'||source.sender!==current.sender||
    source.recipients?.length!==1||current.recipients?.length!==1||source.recipients[0]!==context.receivingIdentity||current.recipients[0]!==context.receivingIdentity||
    !source.content||!Number.isFinite(Date.parse(source.occurredAt||''))||!Number.isFinite(Date.parse(current.occurredAt||''))||Date.parse(source.occurredAt!)>Date.parse(current.occurredAt!)||now-Date.parse(source.occurredAt!)>15*60_000)return;
  return `Original question: ${source.content.slice(0,12000)}\nProject clarification: ${(current.content||'').slice(0,2000)}`;
}
