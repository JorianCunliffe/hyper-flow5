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
  NodeType.REPORT,
  NodeType.GOOGLE_DOC,
  NodeType.GOOGLE_SHEET_READ,
  NodeType.GOOGLE_SHEET_APPEND,
  NodeType.COACHING_EXTRACT,
  NodeType.EMAIL_TRIAGE
];

// Maps action node types to the taskType handled by /api/tasks/execute
export const ACTION_TASK_TYPE: Partial<Record<NodeType, string>> = {
  [NodeType.EMAIL]: 'send_email',
  [NodeType.SMS]: 'send_sms',
  [NodeType.PHONE_CALL]: 'outgoing_call',
  [NodeType.WEBHOOK]: 'webhook',
  [NodeType.REPORT]: 'write_report',
  [NodeType.GOOGLE_DOC]: 'read_google_doc',
  [NodeType.GOOGLE_SHEET_READ]: 'read_google_sheet',
  [NodeType.GOOGLE_SHEET_APPEND]: 'append_google_sheet',
  [NodeType.COACHING_EXTRACT]: 'extract_coaching_result',
  [NodeType.EMAIL_TRIAGE]: 'run_email_triage'
};

export const getNodeType = (m: Milestone): NodeType => m.nodeType || NodeType.MILESTONE;

export const isActionNode = (m: Milestone): boolean => ACTION_NODE_TYPES.includes(getNodeType(m));
