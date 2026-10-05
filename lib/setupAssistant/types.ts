import type { Change } from '../configuration/model.js';

export type SetupScope = { kind: 'new' | 'workflow' | 'element'; projectId: string; nodeId?: string; workspaceContactPolicy?: boolean };
export type SetupQuestion = { text: string; options?: string[]; resourceKind?: 'people' | 'mailboxes' | 'workspaces' | 'resources' | 'schedules' | 'calendars' | 'diaries' };
export type SetupExtras = { resources?: any[]; schedules?: any[]; reception?: any; contactPolicy?: any };
export type SetupProposal = {
  id: string; expectedRevision: number; changes: Change[]; extras: SetupExtras;
  planHash: string; reviewHash: string; valid: boolean; diff: any[]; effects: any[];
  preflight: any; preview: any; before: any; fixtures?: any; assertions?: any[]; inputs?: any;
  pauseSchedules: any[]; resourcesBefore?: any[]; applied?: boolean; operations: Record<string, { status: 'started' | 'completed' | 'failed' | 'unknown'; receipt?: any; error?: string }>;
};
export type SetupSession = {
  id: string; orgId: string; actor: string; scope: SetupScope; revision: number; createdAt: number; updatedAt: number;
  messages: Array<{ role: 'user' | 'assistant'; text: string }>; question?: SetupQuestion;
  proposal?: SetupProposal; simulation?: any; liveReview?: any; activationReview?: any;
  requests: Record<string, { fingerprint: string; status: 'started' | 'completed' | 'failed'; error?: string }>;
  lease?: { id: string; until: number }; error?: string;
};
export type SetupReply = { message: string; question?: SetupQuestion; toolCalls?: Array<{ name: string; arguments?: any }>; proposal?: { changes: Change[]; extras?: SetupExtras; fixtures?: any; assertions?: any[]; inputs?: any } };
