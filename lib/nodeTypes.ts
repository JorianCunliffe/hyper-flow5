import { Milestone, NodeType } from '../types.js';

/**
 * Node-type helpers, kept separate from the engine so both the engine and the
 * human-ask logic can use them without importing each other.
 */

export const ACTION_NODE_TYPES: NodeType[] = [
  NodeType.EMAIL,
  NodeType.SMS,
  NodeType.PHONE_CALL,
  NodeType.WEBHOOK,
  NodeType.REPORT
];

// Maps action node types to the taskType handled by /api/tasks/execute
export const ACTION_TASK_TYPE: Partial<Record<NodeType, string>> = {
  [NodeType.EMAIL]: 'send_email',
  [NodeType.SMS]: 'send_sms',
  [NodeType.PHONE_CALL]: 'outgoing_call',
  [NodeType.WEBHOOK]: 'webhook',
  [NodeType.REPORT]: 'write_report'
};

export const getNodeType = (m: Milestone): NodeType => m.nodeType || NodeType.MILESTONE;

export const isActionNode = (m: Milestone): boolean => ACTION_NODE_TYPES.includes(getNodeType(m));
