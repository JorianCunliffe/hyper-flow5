import { cert, getApp, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { ActivityLog, Project } from '../types';
import { normalizeNodeAsks } from './humanAsk';

/**
 * Server-side persistence via the Firebase Admin SDK.
 *
 * The browser client owns the whole `projects/{orgId}` document and rewrites it
 * wholesale on every save. To coexist with that, every write here is
 * *path-scoped*: we update exactly the sub-path we changed and bump
 * `lastUpdated`, so a concurrent client save clobbers as little as possible.
 *
 * Known limitation: the client's echo-suppression window (App.tsx) ignores any
 * remote update landing within 2s of its own save, and its next save will
 * overwrite a server write it never observed. Webhook-driven writes are rare
 * enough that this is acceptable for now; the durable fix is moving the client
 * off whole-document set().
 */

const APP_NAME = 'hyperflow-server';

export class ServerStoreUnavailable extends Error {}

const parseServiceAccount = (raw: string): ServiceAccount => {
  // Accept either raw JSON or base64-encoded JSON, since env vars in some hosts
  // mangle embedded newlines in the private key.
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const parsed = JSON.parse(text);
  if (parsed.private_key) parsed.private_key = String(parsed.private_key).replace(/\\n/g, '\n');
  return {
    projectId: parsed.project_id || parsed.projectId,
    clientEmail: parsed.client_email || parsed.clientEmail,
    privateKey: parsed.private_key || parsed.privateKey
  };
};

/**
 * Must match the database the browser uses (services/firebaseService.ts). Kept in
 * step by defaulting to the same URL: if these two diverge, a review answered in
 * the app and one answered by webhook write to different databases, and nothing
 * reports an error.
 */
const DEFAULT_DATABASE_URL = 'https://hyper-flow-a459b-default-rtdb.asia-southeast1.firebasedatabase.app';

export const getDatabaseUrl = (): string => process.env.FIREBASE_DATABASE_URL || DEFAULT_DATABASE_URL;

/**
 * Only the service-account key is genuinely required — it is the one real
 * secret, and there is no sensible default for it.
 */
export const isServerStoreConfigured = (): boolean => !!process.env.FIREBASE_SERVICE_ACCOUNT;

const getDb = () => {
  if (!isServerStoreConfigured()) {
    throw new ServerStoreUnavailable(
      'Server-side persistence is not configured. Set FIREBASE_SERVICE_ACCOUNT.'
    );
  }
  const existing = getApps().find(a => a.name === APP_NAME);
  const app =
    existing ||
    initializeApp(
      {
        credential: cert(parseServiceAccount(process.env.FIREBASE_SERVICE_ACCOUNT!)),
        databaseURL: getDatabaseUrl()
      },
      APP_NAME
    );
  return getDatabase(app);
};

/** Mirrors the sanitizing the client does on load: RTDB turns sparse arrays into objects. */
const toArray = <T>(value: any): T[] =>
  Array.isArray(value) ? value : value && typeof value === 'object' ? (Object.values(value) as T[]) : [];

export interface LocatedProject {
  project: Project;
  /** Index within `projects/{orgId}/projects`, which is the RTDB write path. */
  index: number;
}

export const findProject = async (orgId: string, projectId: string): Promise<LocatedProject | null> => {
  const snap = await getDb().ref(`projects/${orgId}/projects`).get();
  if (!snap.exists()) return null;

  const list = toArray<Project>(snap.val());
  const index = list.findIndex(p => p && p.id === projectId);
  if (index === -1) return null;

  const project = list[index];
  return {
    index,
    project: {
      ...project,
      milestones: toArray(project.milestones).map((m: any) =>
        normalizeNodeAsks({
          ...m,
          dependsOn: toArray(m.dependsOn),
          subtasks: toArray(m.subtasks),
          // RTDB drops empty arrays, so a node whose only run history is empty
          // comes back without the key at all.
          ...(m.actionConfig
            ? { actionConfig: { ...m.actionConfig, runHistory: m.actionConfig.runHistory ? toArray(m.actionConfig.runHistory) : undefined } }
            : {}),
          ...(m.decisionConfig
            ? { decisionConfig: { ...m.decisionConfig, branches: toArray(m.decisionConfig.branches) } }
            : {})
        })
      )
    }
  };
};

/**
 * Writes a single project back, leaving settings / scratchTasks / activityLogs
 * untouched. `undefined` is not a legal RTDB value, so strip it the same way the
 * client's save path does.
 */
export const writeProject = async (orgId: string, index: number, project: Project): Promise<void> => {
  const clean = JSON.parse(JSON.stringify({ ...project, updatedAt: Date.now() }));
  await getDb().ref(`projects/${orgId}`).update({
    [`projects/${index}`]: clean,
    lastUpdated: Date.now()
  });
};

export const appendActivityLog = async (orgId: string, log: ActivityLog): Promise<void> => {
  // Written under its own key so it never collides with the client's array rewrite.
  await getDb().ref(`serverActivity/${orgId}`).push(JSON.parse(JSON.stringify(log)));
};

/**
 * Claims a provider event id exactly once. Returns false when the event was
 * already processed — every inbound webhook provider retries on non-2xx and on
 * timeouts, and replaying a flow advance can reset subtask state via loops.
 */
export const claimWebhookEvent = async (provider: string, eventId: string): Promise<boolean> => {
  const safeId = encodeURIComponent(eventId).replace(/[.#$/[\]]/g, '_');
  const ref = getDb().ref(`webhookEvents/${provider}/${safeId}`);
  const result = await ref.transaction(current => (current === null ? { at: Date.now() } : undefined));
  return result.committed;
};

/** Best-effort release, so a failed handler can be retried by the provider. */
export const releaseWebhookEvent = async (provider: string, eventId: string): Promise<void> => {
  const safeId = encodeURIComponent(eventId).replace(/[.#$/[\]]/g, '_');
  try {
    await getDb().ref(`webhookEvents/${provider}/${safeId}`).remove();
  } catch {
    /* non-fatal: worst case the retry is treated as a duplicate */
  }
};
