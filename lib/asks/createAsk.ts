import type {
  AskChannel,
  AskField,
  AskKind,
  HumanAsk,
  OutputVariable
} from '../../types.js';

export const newAskId = (): string => {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `ask_${g.crypto.randomUUID().replace(/-/g, '')}`;
  if (g.crypto?.getRandomValues) {
    const bytes = g.crypto.getRandomValues(new Uint8Array(16));
    return `ask_${Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return `ask_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
};

export const newAskToken = (): string => {
  const g: any = globalThis as any;
  if (g.crypto?.randomUUID) return `t_${g.crypto.randomUUID().replace(/-/g, '')}`;
  if (g.crypto?.getRandomValues) {
    const bytes = g.crypto.getRandomValues(new Uint8Array(24));
    return `t_${Array.from(bytes, (b: number) => b.toString(16).padStart(2, '0')).join('')}`;
  }
  return `t_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
};

export interface CreateAskInput {
  taskId: string;
  projectId?: string;
  runId?: string;
  personId?: string;
  question: string;
  responseType: AskKind;
  assignees?: string[];
  channels?: AskChannel[];
  fields?: AskField[];
  writeBack?: OutputVariable[];
  expiresAt?: number;
  now?: number;
  askId?: string;
  askToken?: string;
  responsePolicy?: HumanAsk['responsePolicy'];
  quorum?: number;
}

/** Creates the durable, channel-independent identity shared by every ask. */
export const createAsk = (input: CreateAskInput): HumanAsk => ({
  id: input.askId || newAskId(),
  token: input.askToken || newAskToken(),
  kind: input.responseType,
  responseType: input.responseType,
  status: 'open',
  prompt: input.question,
  nodeId: input.taskId,
  projectId: input.projectId,
  runId: input.runId,
  personId: input.personId,
  fields: input.fields,
  assignees: input.assignees || (input.personId ? [input.personId] : []),
  channels: input.channels?.length ? input.channels : ['web'],
  responsePolicy: input.responsePolicy || 'any',
  quorum: input.quorum,
  createdAt: input.now ?? Date.now(),
  dueAt: input.expiresAt,
  responses: [],
  writeBack: input.writeBack
});

export interface AskIdentity {
  ask_id: string;
  ask_token: string;
  status: HumanAsk['status'];
}

export const askIdentity = (ask: HumanAsk): AskIdentity => ({
  ask_id: ask.id,
  ask_token: ask.token,
  status: ask.status
});
