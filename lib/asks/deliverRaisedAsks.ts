import type { HumanAsk, Project } from '../../types.js';
import { upsertAsk } from '../humanAsk.js';
import { readTenantCommunicationsSettings, resolveTeamMemberIdentity } from '../serverStore.js';
import { deliverAsk } from './deliverAsk.js';
import { createHash } from 'node:crypto';
import { durableActionExecutor } from '../actionDispatch.js';

export interface RaisedAsk {
  nodeId: string;
  ask: HumanAsk;
}

/** Delivers newly-raised non-web asks and retains provider-neutral audit IDs. */
export const deliverRaisedAsks = async (
  project: Project,
  orgId: string,
  raised: RaisedAsk[]
): Promise<{ project: Project; log: string[] }> => {
  let current = project;
  const log: string[] = [];
  let communicationsSettings: Awaited<ReturnType<typeof readTenantCommunicationsSettings>> | undefined;
  try {
    communicationsSettings = await readTenantCommunicationsSettings(orgId);
  } catch {
    // Individual delivery attempts retain the actionable configuration failure.
  }

  for (const item of raised) {
    let ask = item.ask;
    const people = ask.assignees?.length ? ask.assignees : ask.personId ? [ask.personId] : [];
    const channels = ask.channels.filter(channel => channel !== 'web');
    for (const personId of people) {
      for (const channel of channels) {
        if ((ask.deliveries || []).some(delivery => delivery.personId === personId && delivery.channel === channel && delivery.status === 'accepted')) continue;
        const identity = JSON.stringify([ask.id, personId, channel]);
        const deliveryAskId = `delivery_${createHash('sha256').update(identity).digest('hex')}`;
        const deliveryToken = createHash('sha256').update(JSON.stringify([ask.token, identity])).digest('hex');
        try {
          const recipient = await resolveTeamMemberIdentity(orgId, personId, channel);
          const input = {
            ask, orgId, projectId: current.id, personId, recipient, channel, deliveryAskId, deliveryToken,
            fromNumber: typeof current.projectData?.communications_from_number === 'string'
              ? current.projectData.communications_from_number
              : communicationsSettings?.fromNumber,
            emailIdentity: communicationsSettings?.defaultEmailIdentity,
            replyIdentity: communicationsSettings?.replyServiceIdentity,
            connectionId: communicationsSettings?.connectionId
          };
          const execute = durableActionExecutor(async (_type, _template, frozen) => {
            const result = await deliverAsk(frozen as typeof input);
            return { status: 'success', output: { communication_id: result.id } };
          });
          const outcome = await execute(channel === 'voice' ? 'outgoing_call' : channel === 'sms' ? 'send_sms' : 'send_email', '', input, {
            orgId, projectId: current.id, nodeId: item.nodeId, runId: `op:ask:${deliveryAskId}`,
            flowRunId: current.projectData?.flow_run_id, occurrenceId: current.projectData?.flow_occurrence_id
          });
          const result = { id: String(outcome.output.communication_id) };
          ask = {
            ...ask,
            deliveries: [...(ask.deliveries || []), {
              channel, personId, deliveryAskId, deliveryToken, communicationId: result.id, status: 'accepted', at: Date.now()
            }]
          };
          log.push(`Ask ${ask.id} delivered by ${channel} as ${result.id}`);
        } catch (error: any) {
          if (error?.recoverable) throw error;
          ask = {
            ...ask,
            deliveries: [...(ask.deliveries || []), {
              channel, personId, deliveryAskId, deliveryToken, status: 'failed', at: Date.now(), error: error?.message || String(error)
            }]
          };
          log.push(`Ask ${ask.id} ${channel} delivery failed: ${error?.message || String(error)}`);
        }
      }
    }
    current = {
      ...current,
      milestones: current.milestones.map(node => node.id === item.nodeId ? upsertAsk(node, ask) : node)
    };
  }

  return { project: current, log };
};
