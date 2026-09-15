import { NodeType, type EventTriggerConfig, type FlowEvent, type Project } from '../types.js';
import { isNodeReady, resolveNodeStates } from './flowEngine.js';
import { resetProjectForOccurrence } from './flowOccurrence.js';

const listMatches = (allowed: string[] | undefined, value: string | undefined): boolean =>
  !allowed?.length || allowed.includes('*') || (!!value && allowed.includes(value));

export const eventMatchesTrigger = (config: EventTriggerConfig | undefined, event: FlowEvent): boolean => {
  if (!config?.eventTypes?.length) return false;
  if (!listMatches(config.eventTypes, event.type)) return false;
  if (!listMatches(config.channels, event.channel)) return false;
  if (!listMatches(config.directions, event.direction)) return false;
  if (!listMatches(config.personIds, event.personId)) return false;
  return true;
};

const validVariable = (value: unknown): string | undefined => {
  const key = typeof value === 'string' ? value.trim() : '';
  return /^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(key) ? key : undefined;
};

/**
 * Applies one trusted event to matching EVENT_TRIGGER nodes and creates a fresh
 * flow occurrence. No action is executed here; the normal orchestrator does that.
 */
export const applyFlowEvent = (
  project: Project,
  event: FlowEvent,
  clearProjectDataKeys: string[] = []
): { project: Project; matchedNodeIds: string[]; occurrenceId: string } => {
  const occurrenceId = `event:${event.id}`;
  let current = resetProjectForOccurrence(project, occurrenceId, clearProjectDataKeys);
  const states = resolveNodeStates(current);
  const matchedNodeIds = current.milestones
    .filter(node =>
      node.nodeType === NodeType.EVENT_TRIGGER &&
      isNodeReady(node, states) &&
      eventMatchesTrigger(node.eventTriggerConfig, event)
    )
    .map(node => node.id);

  if (!matchedNodeIds.length) return { project, matchedNodeIds, occurrenceId };

  const triggeredAt = Date.now();
  const payloadWrites: Record<string, unknown> = {};
  for (const node of current.milestones) {
    if (!matchedNodeIds.includes(node.id)) continue;
    const variable = validVariable(node.eventTriggerConfig?.payloadVariable);
    if (variable) payloadWrites[variable] = event.payload || {};
  }

  current = {
    ...current,
    projectData: {
      ...(current.projectData || {}),
      ...payloadWrites,
      flow_occurrence_id: occurrenceId,
      flow_trigger_event_id: event.id,
      flow_trigger_event_type: event.type,
      flow_triggered_at: new Date(event.occurredAt).toISOString(),
      ...(event.channel ? { flow_trigger_channel: event.channel } : {}),
      ...(event.direction ? { flow_trigger_direction: event.direction } : {}),
      ...(event.personId ? { flow_trigger_person_id: event.personId } : {}),
      ...(event.communicationId ? { flow_trigger_communication_id: event.communicationId } : {})
    },
    milestones: current.milestones.map(node => matchedNodeIds.includes(node.id) ? {
      ...node,
      eventTriggerConfig: {
        ...node.eventTriggerConfig!,
        lastEventId: event.id,
        triggeredAt,
        occurrenceId
      }
    } : node)
  };

  return { project: current, matchedNodeIds, occurrenceId };
};
