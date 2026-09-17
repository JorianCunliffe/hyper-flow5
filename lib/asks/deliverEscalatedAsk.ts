import { createHash } from 'node:crypto';
import type { HumanAsk, Project } from '../../types.js';
import { createCommunicationsClient } from '../communications/client.js';
import { claimContactDispatch, readTenantAgentProfile, readTenantCommunicationsSettings } from '../serverStore.js';
import { readTenantCapabilityPolicy } from '../capabilityPolicyStore.js';
import { assertCapabilityAllowed } from '../capabilityPolicy.js';
import { resolveGrantedPersonTarget } from '../actionTarget.js';
import { durableActionExecutor } from '../actionDispatch.js';
import { deliverAsk } from './deliverAsk.js';
import { escalationStep, nextEscalationCycle, reconcileEscalationCall, validateEscalation, type EscalationPlan } from './askEscalation.js';

/** One durable escalation transition per wakeup. The original Ask owns all answers. */
const defaults = { now: Date.now, client: createCommunicationsClient, readTenantAgentProfile, readTenantCapabilityPolicy, resolveGrantedPersonTarget, claimContactDispatch, readTenantCommunicationsSettings, durableActionExecutor, deliverAsk };
export const deliverEscalatedAsk = async (project: Project, orgId: string, ask: HumanAsk, plan: EscalationPlan, dependencies = defaults): Promise<HumanAsk> => {
  validateEscalation(plan);
  if (ask.status !== 'open') return ask;
  const now = dependencies.now();
  const state = ask.escalationState || { cycle: 0, step: 0, nextAt: now };
  if (state.nextAt > now) return ask;
  if (state.awaitingId) {
    const communication = await dependencies.client().getCommunication(orgId, state.awaitingId);
    return { ...ask, escalationState: reconcileEscalationCall(plan, state, communication, now) };
  }
  const { personId, channel } = escalationStep(plan, state.step);
  const identity = JSON.stringify([ask.id, state.cycle, state.step, personId, channel]);
  const deliveryAskId = `delivery_${createHash('sha256').update(identity).digest('hex')}`;
  const deliveryToken = createHash('sha256').update(JSON.stringify([ask.token, identity])).digest('hex');
  const runId = `op:ask:${deliveryAskId}`;
  try {
    const profile = await dependencies.readTenantAgentProfile(orgId);
    if (!profile) throw new Error('Configure tenant authority before escalation');
    profile.capabilityPolicy = await dependencies.readTenantCapabilityPolicy(orgId);
    assertCapabilityAllowed({ profile, capability: channel === 'voice' ? 'phone.call' : 'sms.send', autonomous: true });
    const recipient = await dependencies.resolveGrantedPersonTarget({ orgId, projectId: project.id, personId, channel, profile });
    const claim = await dependencies.claimContactDispatch(orgId, { operationId: runId, target: recipient, channel, coalesce: false });
    if (!claim.allowed && claim.existingOperationId !== runId) throw new Error(claim.reason || 'Contact policy refused this attempt');
    const settings = await dependencies.readTenantCommunicationsSettings(orgId);
    const input = { ask: channel === 'sms' ? { ...ask, prompt: `${project.name}: please call back to continue the workflow. Your answers are still needed.` } : ask,
      orgId, projectId: project.id, personId, recipient, channel, deliveryAskId, deliveryToken,
      fromNumber: settings.fromNumber };
    const execute = dependencies.durableActionExecutor(async (_type, _template, frozen) => {
      const result = await dependencies.deliverAsk(frozen as typeof input);
      return { status: 'success', output: { communication_id: result.id } };
    });
    const outcome = await execute(channel === 'voice' ? 'outgoing_call' : 'send_sms', '', input, {
      orgId, projectId: project.id, nodeId: ask.nodeId, runId,
      flowRunId: project.projectData?.flow_run_id, occurrenceId: project.projectData?.flow_occurrence_id
    });
    const communicationId = String(outcome.output.communication_id);
    return { ...ask,
      escalationState: channel === 'voice' ? { ...state, awaitingId: communicationId, nextAt: now + 60_000, error: undefined }
        : state.step === 4 ? nextEscalationCycle(plan, state, now) : { ...state, step: state.step + 1, nextAt: now, error: undefined },
      deliveries: [...(ask.deliveries || []), { channel, personId, deliveryAskId, deliveryToken, communicationId, status: 'accepted', at: now }]
    };
  } catch (error: any) {
    if (error?.recoverable) throw error;
    // Configuration/window limits delay this same operation; they never advance the chain.
    return { ...ask, escalationState: { ...state, nextAt: now + 300_000, error: error.message } };
  }
};
