import type { HumanAsk, Project } from '../../types.js';
import { readTenantCommunicationsSettings, resolveTeamMemberIdentity } from '../serverStore.js';
import { newAskId, newAskToken } from './createAsk.js';
import { deliverAsk } from './deliverAsk.js';
import { nextAskField } from './askSteps.js';

export interface DeliverNextSmsStepInput {
  ask: HumanAsk;
  project: Project;
  orgId: string;
  projectId: string;
  personId?: string;
}

/**
 * Delivers exactly one subsequent field for an open SMS Ask. Each step gets a
 * fresh delivery Ask id/token, which also creates a distinct Communications
 * idempotency key while keeping the canonical Human Ask unchanged.
 */
export const deliverNextSmsStep = async (input: DeliverNextSmsStepInput): Promise<HumanAsk> => {
  if (input.ask.status !== 'open' || !nextAskField(input.ask)) return input.ask;
  const priorSms = [...(input.ask.deliveries || [])].reverse().find(delivery =>
    delivery.channel === 'sms' && delivery.status === 'accepted'
  );
  const personId = input.personId || priorSms?.personId || input.ask.personId || input.ask.assignees?.[0];
  if (!personId) throw new Error(`Ask ${input.ask.id} has no SMS assignee`);

  const settings = await readTenantCommunicationsSettings(input.orgId);
  const recipient = await resolveTeamMemberIdentity(input.orgId, personId, 'sms');
  const deliveryAskId = newAskId();
  const deliveryToken = newAskToken();

  try {
    const result = await deliverAsk({
      ask: input.ask,
      orgId: input.orgId,
      projectId: input.projectId,
      personId,
      recipient,
      channel: 'sms',
      deliveryAskId,
      deliveryToken,
      fromNumber: typeof input.project.projectData?.communications_from_number === 'string'
        ? input.project.projectData.communications_from_number
        : settings?.fromNumber,
      connectionId: settings?.connectionId
    });
    return {
      ...input.ask,
      deliveries: [...(input.ask.deliveries || []), {
        channel: 'sms', personId, deliveryAskId, deliveryToken,
        communicationId: result.id, status: 'accepted', at: Date.now()
      }]
    };
  } catch (error: any) {
    return {
      ...input.ask,
      deliveries: [...(input.ask.deliveries || []), {
        channel: 'sms', personId, deliveryAskId, deliveryToken,
        status: 'failed', at: Date.now(), error: error?.message || String(error)
      }]
    };
  }
};
