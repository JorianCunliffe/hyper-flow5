import type { HumanAsk, Project } from '../../types.js';
import { upsertAsk } from '../humanAsk.js';
import { readTenantCommunicationsSettings, resolveTeamMemberIdentity } from '../serverStore.js';
import { deliverAsk } from './deliverAsk.js';

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
  let configuredFromNumber: string | undefined;
  try {
    configuredFromNumber = (await readTenantCommunicationsSettings(orgId)).fromNumber;
  } catch {
    // Email-only asks do not require Communications configuration. Individual
    // channel attempts below retain the actionable failure when it is needed.
  }

  for (const item of raised) {
    let ask = item.ask;
    const people = ask.assignees?.length ? ask.assignees : ask.personId ? [ask.personId] : [];
    const channels = ask.channels.filter(channel => channel !== 'web');
    for (const personId of people) {
      for (const channel of channels) {
        try {
          const recipient = await resolveTeamMemberIdentity(orgId, personId, channel);
          const result = await deliverAsk({
            ask, orgId, projectId: current.id, personId, recipient, channel,
            fromNumber: typeof current.projectData?.communications_from_number === 'string'
              ? current.projectData.communications_from_number
              : configuredFromNumber
          });
          ask = {
            ...ask,
            deliveries: [...(ask.deliveries || []), {
              channel, personId, communicationId: result.id, status: 'accepted', at: Date.now()
            }]
          };
          log.push(`Ask ${ask.id} delivered by ${channel} as ${result.id}`);
        } catch (error: any) {
          ask = {
            ...ask,
            deliveries: [...(ask.deliveries || []), {
              channel, personId, status: 'failed', at: Date.now(), error: error?.message || String(error)
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
