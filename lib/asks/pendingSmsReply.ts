import type { HumanAsk } from '../../types.js';
import type { FlowRun } from '../flowRuntimeTypes.js';
import type { CommunicationResult, CommunicationsClient } from '../communications/types.js';
import { listActiveReceptionRuns } from '../reception/asks.js';

export interface SmsAskMatch { projectId: string; runId: string; askId: string; deliveryAskId: string }

/** Match acknowledged SMS requests, never general contact/project associations. */
export async function pendingSmsReply(input: {
  orgId: string; personId?: string; projectIds: string[]; message: CommunicationResult;
  trustedProjectId?: string; now?: number;
}, client: Pick<CommunicationsClient, 'getCommunication'>,
readRuns: (org: string, project: string) => Promise<FlowRun[]> = listActiveReceptionRuns
): Promise<SmsAskMatch[]> {
  const { message: m, orgId, personId } = input;
  const now = input.now ?? Date.now();
  const at = Date.parse(m.occurredAt || '');
  if (!personId || m.personId !== personId || m.tenantId !== orgId || m.direction !== 'inbound'
    || m.channel !== 'sms' || !m.content?.trim() || !m.sender || m.recipients?.length !== 1
    || !Number.isFinite(at) || at > now + 60_000 || now - at > 24 * 3_600_000) return [];
  const matches = new Map<string, SmsAskMatch>();
  for (const projectId of input.projectIds) {
    if (input.trustedProjectId && input.trustedProjectId !== projectId) continue;
    for (const run of await readRuns(orgId, projectId)) {
      if (run.orgId !== orgId || run.projectId !== projectId || !['waiting', 'running'].includes(run.status)) continue;
      for (const node of run.state.milestones) for (const ask of node.asks || []) {
        const replay = ask.responses?.some(r => r.communicationId === m.id);
        if (ask.runId !== run.id || (ask.status !== 'open' && !replay)
          || (!replay && ask.dueAt && ask.dueAt <= now)) continue;
        const delivery = [...(ask.deliveries || [])].reverse().find(d => d.channel === 'sms'
          && d.personId === personId && d.status === 'accepted' && d.communicationId && d.at <= at);
        if (!delivery || at - delivery.at > 24 * 3_600_000) continue;
        const sent = await client.getCommunication(orgId, delivery.communicationId!);
        if (!smsReceiptMatches(m, sent, ask, delivery.deliveryAskId || ask.id, projectId, orgId, personId)) continue;
        matches.set(ask.id, { projectId, runId: run.id, askId: ask.id, deliveryAskId: delivery.deliveryAskId || ask.id });
      }
    }
  }
  return [...matches.values()];
}

export function smsReceiptMatches(m: CommunicationResult, sent: CommunicationResult, ask: HumanAsk,
  deliveryAskId: string, projectId: string, orgId: string, personId: string): boolean {
  return sent.tenantId === orgId && sent.personId === personId && sent.channel === 'sms'
    && sent.direction === 'outbound' && !['failed', 'cancelled'].includes(sent.status)
    && sent.sender === m.recipients?.[0] && sent.recipients?.length === 1 && sent.recipients[0] === m.sender
    && sent.purpose?.type === 'human_ask' && sent.purpose.ask_id === deliveryAskId
    && sent.correlation?.project_id === projectId && sent.correlation?.tenant_id === orgId
    && Boolean(ask.id);
}
