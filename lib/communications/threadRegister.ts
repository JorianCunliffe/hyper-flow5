import { createCommunicationsClient } from './client.js';
import { CommunicationsApiError } from './errors.js';
import { listTenantProjects } from '../serverStore.js';
import type { CommunicationsClient, ThreadCorrectionRequest, ThreadRegisterPatch, ThreadStatus } from './types.js';

export const THREAD_REGISTER_ACTIONS = ['thread_register', 'thread_candidates', 'thread_correction', 'thread_update'] as const;
const REASONS = ['wrong_person', 'wrong_project', 'wrong_topic', 'time_gap', 'channel_boundary', 'duplicate_thread', 'other'];
const STATUSES = ['open', 'resolved', 'closed'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type RegisterClient = Pick<CommunicationsClient, 'listThreadRegister' | 'getThreadCandidates' | 'correctThread' | 'updateThread' | 'getCommunication' | 'getThread'>;

export class ThreadRegisterRequestError extends Error {
  constructor(public readonly status: number, message: string) { super(message); }
}

const text = (value: unknown, max = 500): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
const required = (value: unknown, name: string): string => {
  const result = text(value);
  if (!result) throw new ThreadRegisterRequestError(400, `${name} is required`);
  return result;
};

export const threadRegisterErrorStatus = (error: unknown): number => {
  if (error instanceof ThreadRegisterRequestError) return error.status;
  if (error instanceof CommunicationsApiError) return error.status && error.status >= 400 && error.status < 500 ? error.status : 502;
  return 500;
};

async function saveAttributedChange(change: () => Promise<unknown>): Promise<unknown> {
  try {
    return await change();
  } catch (error) {
    if (error instanceof CommunicationsApiError && error.status === 403
      && error.message.includes('API client lacks required capability: threads:actor:assert')) {
      throw new ThreadRegisterRequestError(403,
        'Conversation changes are unavailable because the HyperFlow service credential lacks threads:actor:assert. '
        + 'Ask an administrator to review that credential in Communications Service. '
        + 'Your change was not saved; user attribution must remain enabled.');
    }
    throw error;
  }
}

/** Shared by Vercel and the local server. Tenant and actor come only from verified membership. */
export async function handleThreadRegisterRequest(
  action: string,
  request: { method?: string; query?: Record<string, unknown>; body?: unknown },
  member: { orgId: string; uid: string },
  dependencies: { client?: RegisterClient; listProjects?: (tenantId: string) => Promise<Array<{ id: string | number }>> } = {}
): Promise<unknown> {
  const expectedMethod = action === 'thread_correction' ? 'POST' : action === 'thread_update' ? 'PATCH' : 'GET';
  if (!(THREAD_REGISTER_ACTIONS as readonly string[]).includes(action)) throw new ThreadRegisterRequestError(404, 'Unknown thread register action');
  if (request.method !== expectedMethod) throw new ThreadRegisterRequestError(405, 'Method not allowed');
  const query = request.query || {};
  const body = request.body && typeof request.body === 'object' && !Array.isArray(request.body) ? request.body as Record<string, unknown> : {};
  const client = dependencies.client || createCommunicationsClient();

  if (action === 'thread_register') {
    const status = text(query.status) || 'open';
    if (status !== 'all' && !STATUSES.includes(status)) throw new ThreadRegisterRequestError(400, 'Unknown thread status');
    const requestedLimit = Number(query.limit || 100);
    if (!Number.isFinite(requestedLimit)) throw new ThreadRegisterRequestError(400, 'limit must be a number');
    const paging: { offset?: number; communicationOffset?: number; threadId?: string } = {};
    for (const key of ['offset', 'communicationOffset'] as const) {
      if (query[key] === undefined) continue;
      const value = Number(query[key]);
      if (!Number.isSafeInteger(value) || value < 0 || value > 2147483647) throw new ThreadRegisterRequestError(400, `${key} must be a non-negative integer`);
      paging[key] = value;
    }
    if (query.threadId !== undefined) paging.threadId = required(query.threadId, 'threadId');
    return client.listThreadRegister(member.orgId, {
      ...paging,
      status: status as ThreadStatus | 'all', personId: text(query.personId) || undefined,
      externalProjectId: text(query.projectId) || undefined,
      limit: Math.min(200, Math.max(1, Math.floor(requestedLimit)))
    });
  }
  if (action === 'thread_candidates') {
    return client.getThreadCandidates(member.orgId, required(query.communicationId, 'communicationId'));
  }

  const projects = await (dependencies.listProjects || listTenantProjects)(member.orgId);
  const assertProject = (projectId: unknown) => {
    if (projectId && !projects.some(project => String(project.id) === projectId)) {
      throw new ThreadRegisterRequestError(403, 'Thread project does not belong to this organization');
    }
  };

  let externalProjectId: string | null | undefined;
  if (Object.hasOwn(body, 'external_project_id')) {
    if (body.external_project_id === null) externalProjectId = null;
    else {
      externalProjectId = required(body.external_project_id, 'external_project_id');
      if (!projects.some(project => String(project.id) === externalProjectId)) {
        throw new ThreadRegisterRequestError(400, 'Project does not belong to this organization');
      }
    }
  }

  if (action === 'thread_correction') {
    const communicationId = required(body.communicationId, 'communicationId');
    const reason = text(body.reason_code);
    if (!REASONS.includes(reason)) throw new ThreadRegisterRequestError(400, 'A valid correction reason is required');
    const threadId = text(body.thread_id);
    const createNew = body.create_new === true;
    if (Boolean(threadId) === createNew) throw new ThreadRegisterRequestError(400, 'Choose an existing thread or create a new one');
    const personId = text(body.person_id);
    if (personId && !UUID.test(personId)) throw new ThreadRegisterRequestError(400, 'person_id must be a Communications contact UUID');
    if (body.update_identity === true && !personId) throw new ThreadRegisterRequestError(400, 'Choose a person before updating the identity map');
    const correction: ThreadCorrectionRequest = {
      ...(threadId ? { thread_id: threadId } : { create_new: true }),
      reason_code: reason as ThreadCorrectionRequest['reason_code'],
      reason_detail: text(body.reason_detail, 1000) || undefined,
      person_id: personId || undefined,
      update_identity: body.update_identity === true,
      ...(externalProjectId !== undefined ? { external_project_id: externalProjectId } : {}),
      initiator_id: member.uid
    };
    const source = await client.getCommunication(member.orgId, communicationId);
    assertProject(source.correlation?.external_project_id);
    if (threadId) {
      const destination = await client.getThread(member.orgId, threadId);
      assertProject(destination.external_project_id || destination.correlation?.external_project_id);
    }
    return saveAttributedChange(() => client.correctThread(member.orgId, communicationId, correction));
  }

  const threadId = required(body.threadId, 'threadId');
  const patch: ThreadRegisterPatch = { initiator_id: member.uid };
  for (const key of ['title', 'summary'] as const) {
    if (!Object.hasOwn(body, key)) continue;
    if (body[key] !== null && typeof body[key] !== 'string') throw new ThreadRegisterRequestError(400, `${key} must be text or null`);
    patch[key] = text(body[key], key === 'title' ? 500 : 5000) || null;
  }
  if (Object.hasOwn(body, 'status')) {
    if (!STATUSES.includes(String(body.status))) throw new ThreadRegisterRequestError(400, 'Unknown thread status');
    patch.status = body.status as ThreadStatus;
  }
  if (externalProjectId !== undefined) patch.external_project_id = externalProjectId;
  if (Object.keys(patch).length === 1) throw new ThreadRegisterRequestError(400, 'Supply an editable thread field');
  const thread = await client.getThread(member.orgId, threadId);
  assertProject(thread.external_project_id || thread.correlation?.external_project_id);
  return saveAttributedChange(() => client.updateThread(member.orgId, threadId, patch));
}
