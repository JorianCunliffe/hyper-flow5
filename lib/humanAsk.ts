import {
  AskChannel,
  AskDecision,
  AskField,
  Attachment,
  HumanAsk,
  HumanResponse,
  Milestone,
  NodeType,
  Project,
  ReviewPolicy
} from '../types.js';
import { getNodeType, isActionNode } from './nodeTypes.js';
import { createAsk } from './asks/createAsk.js';

/**
 * Human-in-the-loop asks: pure logic only.
 *
 * An ask is the unit of agent-to-human handover. The same object serves
 * "approve this work", "answer this question" and "send me a file", across web,
 * email, SMS and voice — so every channel adapter normalises into one shape and
 * there is one place where an answer becomes project state.
 */

let askCounter = 0;
export const newAskId = (): string =>
  `ask_${Date.now().toString(36)}_${(++askCounter).toString(36)}`;

/**
 * Capability token for answering one ask. Uses crypto randomness where
 * available — this ends up in Reply-To headers and mail archives, so it must not
 * be guessable, and it must never grant anything beyond answering this ask.
 */
export const newAskToken = (): string => {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `t_${g.crypto.randomUUID().replace(/-/g, '')}`;
  if (g.crypto?.getRandomValues) {
    const bytes = g.crypto.getRandomValues(new Uint8Array(24));
    return `t_${Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

export const DEFAULT_CHANNELS: AskChannel[] = ['web'];

const hoursToMs = (h: number) => h * 60 * 60 * 1000;

/**
 * Firebase RTDB does not store empty arrays — it drops the key entirely — and
 * turns sparse arrays into objects keyed by index. Anything round-tripped
 * through the database therefore comes back with `responses`, `asks`,
 * `assignees` and friends missing rather than empty, so every accessor here
 * tolerates that. `normalizeAsk` restores the shape on read.
 */
const arr = <T>(value: any): T[] =>
  Array.isArray(value) ? value : value && typeof value === 'object' ? (Object.values(value) as T[]) : [];

export const normalizeAsk = (ask: any): HumanAsk => ({
  ...ask,
  responses: arr<HumanResponse>(ask?.responses).map(r => ({ ...r, attachments: arr<Attachment>(r?.attachments) })),
  assignees: arr<string>(ask?.assignees),
  channels: arr<AskChannel>(ask?.channels),
  deliveries: ask?.deliveries ? arr<any>(ask.deliveries) : undefined,
  fields: ask?.fields ? arr<AskField>(ask.fields) : undefined,
  writeBack: ask?.writeBack ? arr<any>(ask.writeBack) : undefined
});

export const normalizeNodeAsks = <T extends { asks?: any }>(node: T): T => {
  const asks = arr<any>(node?.asks);
  return asks.length ? { ...node, asks: asks.map(normalizeAsk) } : node;
};

/** The most recent response carrying an explicit decision. */
export const latestDecision = (ask: HumanAsk): AskDecision | undefined => {
  const responses = arr<HumanResponse>(ask?.responses);
  for (let i = responses.length - 1; i >= 0; i--) {
    if (responses[i].decision) return responses[i].decision;
  }
  return undefined;
};

export const isAnswered = (ask: HumanAsk): boolean => ask.status === 'answered';
export const isOpen = (ask: HumanAsk): boolean => ask.status === 'open';

export const isApproved = (ask: HumanAsk): boolean =>
  ask.status === 'answered' && latestDecision(ask) === 'approved';

export const isOverdue = (ask: HumanAsk, now = Date.now()): boolean =>
  ask.status === 'open' && !!ask.dueAt && now > ask.dueAt;

/** Asks on a node that concern a specific run (or the node generally). */
export const asksForRun = (node: Milestone, runId?: string): HumanAsk[] =>
  (node.asks || []).filter(a => (runId ? a.runId === runId : !a.runId));

/**
 * Whether a node's review gate is satisfied.
 *
 * For action nodes the approval must belong to the *current* run — otherwise a
 * node that is re-run by a loop would inherit an approval given for earlier work.
 */
export const isReviewSatisfied = (node: Milestone): boolean => {
  const policy = node.reviewPolicy;
  if (!policy?.required) return true;

  const runId = isActionNode(node) ? node.actionConfig?.lastRun?.id : undefined;
  const relevant = (node.asks || []).filter(a => a.kind === 'approval' && (!runId || a.runId === runId));
  if (relevant.length === 0) return false;

  // An expiry policy of auto_approve releases the gate once overdue; 'block' and
  // 'escalate' both keep it shut until a person actually answers.
  const now = Date.now();
  return relevant.some(
    a => isApproved(a) || (policy.onExpiry === 'auto_approve' && isOverdue(a, now))
  );
};

/** True when a node needs a review ask raised that does not exist yet. */
export const needsApprovalAsk = (node: Milestone): boolean => {
  const policy = node.reviewPolicy;
  if (!policy?.required) return false;

  const runId = isActionNode(node) ? node.actionConfig?.lastRun?.id : undefined;
  const relevant = (node.asks || []).filter(
    a => a.kind === 'approval' && a.status !== 'cancelled' && (!runId || a.runId === runId)
  );

  // Rejected outright — don't keep asking a reviewer who already said no.
  if (relevant.some(a => latestDecision(a) === 'rejected')) return false;

  return !relevant.some(a => isOpen(a) || isApproved(a));
};

export interface CreateAskOptions {
  prompt?: string;
  assignees?: string[];
  channels?: AskChannel[];
  now?: number;
  id?: string;
  token?: string;
  projectId?: string;
  personId?: string;
}

const resolveAssignees = (policy: ReviewPolicy | undefined, node: Milestone, explicit?: string[]): string[] => {
  if (explicit?.length) return explicit;
  if (policy?.reviewers?.length) return policy.reviewers;
  // Fall back to whoever is accountable for the node's work.
  const accountable = (node.subtasks || []).map(s => s.accountable).filter(Boolean) as string[];
  return Array.from(new Set(accountable));
};

/** Describes the reviewable output of an action run so the UI can render it. */
export const artifactFromRun = (node: Milestone): HumanAsk['artifact'] => {
  const output = node.actionConfig?.lastRun?.output;
  if (!output || typeof output !== 'object') return undefined;

  if (output.report_content) {
    return {
      kind: 'markdown',
      title: node.name,
      content: String(output.report_content),
      url: output.report_link,
      previousContent: node.actionConfig?.revision?.priorOutput?.report_content,
      evaluation: output.evaluation
    };
  }
  if (output.call_transcript || output.call_summary) {
    return {
      kind: 'text',
      title: `Call outcome — ${node.name}`,
      content: [output.call_summary, output.call_transcript].filter(Boolean).join('\n\n'),
      url: output.call_recording_url
    };
  }
  return { kind: 'json', title: node.name, content: JSON.stringify(output, null, 2) };
};

export const createApprovalAsk = (node: Milestone, opts: CreateAskOptions = {}): HumanAsk => {
  const now = opts.now ?? Date.now();
  const policy = node.reviewPolicy;
  const runId = isActionNode(node) ? node.actionConfig?.lastRun?.id : undefined;
  const revision = node.actionConfig?.revision?.count ?? 0;

  return {
    ...createAsk({
      taskId: node.id,
      projectId: opts.projectId,
      runId,
      personId: opts.personId || resolveAssignees(policy, node, opts.assignees)[0],
      question: opts.prompt || `Review "${node.name}" and approve, or send it back with changes.`,
      responseType: 'approval',
      assignees: resolveAssignees(policy, node, opts.assignees),
      channels: opts.channels || policy?.channels || DEFAULT_CHANNELS,
      expiresAt: policy?.slaHours ? now + hoursToMs(policy.slaHours) : undefined,
      now,
      askId: opts.id,
      askToken: opts.token
    }),
    artifact: artifactFromRun(node),
    revision
  };
};

/**
 * Builds a question ask from the variables a node is blocked on.
 *
 * `evaluateTaskReadiness` already computes exactly which facts are missing but
 * nothing consumed them — this turns that dead diagnostic into the question
 * channel, with the answer schema derived rather than hand-authored.
 */
export const createQuestionAsk = (
  node: Milestone,
  missingVariables: string[],
  opts: CreateAskOptions = {}
): HumanAsk => {
  const now = opts.now ?? Date.now();
  const fields: AskField[] = missingVariables.map(name => ({
    name,
    label: name.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()),
    type: 'string',
    required: true
  }));

  const writeBack = missingVariables.map(name => ({
      name,
      type: 'string',
      write_on: 'approval',
      value_source: 'task_output'
    } as const));

  return createAsk({
    taskId: node.id,
    projectId: opts.projectId,
    personId: opts.personId || resolveAssignees(node.reviewPolicy, node, opts.assignees)[0],
    question:
      opts.prompt ||
      `"${node.name}" needs ${missingVariables.length === 1 ? 'one detail' : `${missingVariables.length} details`} before it can run: ${missingVariables.join(', ')}.`,
    responseType: 'question',
    fields,
    assignees: resolveAssignees(node.reviewPolicy, node, opts.assignees),
    channels: opts.channels || node.reviewPolicy?.channels || DEFAULT_CHANNELS,
    expiresAt: node.reviewPolicy?.slaHours ? now + hoursToMs(node.reviewPolicy.slaHours) : undefined,
    now,
    askId: opts.id,
    askToken: opts.token,
    writeBack
  });
};

/**
 * Records a response. An ask closes when the response carries a decision, or —
 * for a question/upload ask — when everything required has been supplied.
 * A response needing interpretation never closes an ask on its own.
 */
export const recordAskResponse = (ask: HumanAsk, response: HumanResponse): HumanAsk => {
  const responses = [...arr<HumanResponse>(ask?.responses), response];
  const merged: HumanAsk = { ...ask, responses };

  if (response.needsInterpretation) return merged;

  if (response.decision) {
    return { ...merged, status: 'answered', answeredAt: response.at };
  }

  const required = (ask.fields || []).filter(f => f.required).map(f => f.name);
  if (required.length > 0) {
    const supplied = { ...collectValues(merged) };
    const hasAll = required.every(n => supplied[n] !== undefined && supplied[n] !== null && supplied[n] !== '');
    if (hasAll) return { ...merged, status: 'answered', answeredAt: response.at };
    return merged;
  }

  if (ask.kind === 'upload') {
    const hasFile = responses.some(r => arr<Attachment>(r?.attachments).length > 0);
    return hasFile ? { ...merged, status: 'answered', answeredAt: response.at } : merged;
  }

  return { ...merged, status: 'answered', answeredAt: response.at };
};

/** All values supplied across an ask's responses, later ones winning. */
export const collectValues = (ask: HumanAsk): Record<string, any> =>
  arr<HumanResponse>(ask?.responses).reduce<Record<string, any>>((acc, r) => ({ ...acc, ...(r.values || {}) }), {});

export const collectAttachments = (ask: HumanAsk) =>
  arr<HumanResponse>(ask?.responses).flatMap(r => arr<Attachment>(r?.attachments));

/** Replaces an ask on a node, preserving order. */
export const upsertAsk = (node: Milestone, ask: HumanAsk): Milestone => {
  const asks = node.asks || [];
  const idx = asks.findIndex(a => a.id === ask.id);
  return { ...node, asks: idx === -1 ? [...asks, ask] : asks.map((a, i) => (i === idx ? ask : a)) };
};

export const findAskInProject = (
  project: Project,
  predicate: (ask: HumanAsk, node: Milestone) => boolean
): { node: Milestone; ask: HumanAsk } | undefined => {
  for (const node of project.milestones) {
    for (const ask of node.asks || []) {
      if (predicate(ask, node)) return { node, ask };
    }
  }
  return undefined;
};

export const findAskByToken = (project: Project, token: string) =>
  findAskInProject(project, ask => ask.token === token);

export const findAskById = (project: Project, askId: string) =>
  findAskInProject(project, ask => ask.id === askId);

/**
 * Folds an answered ask into the project.
 *
 * - values land in projectData (directly, and via any writeBack mapping)
 * - a 'revise' decision re-arms the node with the reviewer's comment as the
 *   instruction for the next run, which is what makes a redo actually a redo
 * - a 'rejected' decision leaves the run failed and the gate shut
 */
export const applyAskToProject = (project: Project, askId: string): Project => {
  const found = findAskInProject(project, a => a.id === askId);
  if (!found || found.ask.status !== 'answered' || found.ask.appliedAt) return project;

  const { ask } = found;
  const decision = latestDecision(ask);
  const values = collectValues(ask);
  const now = Date.now();

  let projectData = { ...(project.projectData || {}) };

  // Direct values first, then any explicit writeBack mapping on top.
  if (decision !== 'rejected' && decision !== 'revise') {
    projectData = { ...projectData, ...values };
    for (const v of ask.writeBack || []) {
      if (v.value_source === 'static') projectData[v.name] = v.value;
      else if (v.value_source === 'system_date') projectData[v.name] = new Date().toISOString().split('T')[0];
      else if (v.value_source === 'task_output' && values[v.name] !== undefined) projectData[v.name] = values[v.name];
    }
  }

  const appliedAsk: HumanAsk = { ...ask, appliedAt: now };

  return {
    ...project,
    projectData,
    milestones: project.milestones.map(m => {
      if (m.id !== ask.nodeId) return m;
      const withAsk = upsertAsk(m, appliedAsk);

      if (decision === 'revise' && isActionNode(m)) {
        const feedback = [...arr<HumanResponse>(ask?.responses)].reverse().find(r => r.text)?.text || 'Revision requested.';
        const prior = m.actionConfig?.lastRun;
        return {
          ...withAsk,
          actionConfig: {
            template: '',
            ...(m.actionConfig || {}),
            // Clearing lastRun re-opens the node so the flow runs it again.
            lastRun: undefined,
            runHistory: prior ? [...(m.actionConfig?.runHistory || []), prior] : m.actionConfig?.runHistory,
            revision: {
              feedback,
              priorOutput: prior?.output,
              at: now,
              count: (m.actionConfig?.revision?.count ?? 0) + 1
            }
          }
        };
      }

      return withAsk;
    })
  };
};

/**
 * Whether a node has been sent back more times than its policy allows.
 * At that point the gate stops re-asking rather than looping forever.
 */
export const revisionsExhausted = (node: Milestone): boolean => {
  const max = node.reviewPolicy?.maxRevisions;
  if (max === undefined) return false;
  return (node.actionConfig?.revision?.count ?? 0) >= max;
};

/** Nodes with asks currently awaiting a human. Drives reminders and the review queue. */
export const openAsks = (project: Project): { node: Milestone; ask: HumanAsk }[] => {
  const out: { node: Milestone; ask: HumanAsk }[] = [];
  for (const node of project.milestones) {
    for (const ask of node.asks || []) {
      if (ask.status === 'open') out.push({ node, ask });
    }
  }
  return out;
};

/** Milestone nodes are reviewed on their subtasks; other node types on their run. */
export const isReviewableNode = (node: Milestone): boolean =>
  getNodeType(node) === NodeType.MILESTONE || isActionNode(node);
