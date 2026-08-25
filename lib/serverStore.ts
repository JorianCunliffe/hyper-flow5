import { cert, getApp, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { ActivityLog, AppSettings, CommunicationsSettings, Project, TeamMemberDetails } from '../types.js';
import { normalizeNodeAsks } from './humanAsk.js';
import type { ExternalEventProcessingStatus, ExternalEventRecord } from './externalEvents.js';

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

export class ServiceAccountError extends Error {}

/** Paste artifacts: some UIs and shells wrap a pasted value in quotes. */
const stripWrappingQuotes = (s: string): string => {
  const t = s.trim();
  const quoted = (t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"));
  return quoted && t.length > 1 ? t.slice(1, -1) : t;
};

/** Parses JSON, unwrapping a value that was JSON-encoded twice. */
const tryJson = (s: string, depth = 0): any => {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === 'object') return v;
    if (typeof v === 'string' && depth < 2) return tryJson(v, depth + 1);
    return null;
  } catch {
    return null;
  }
};

const tryBase64 = (s: string): any => {
  const compact = s.replace(/\s+/g, '');
  // Only attempt a decode when the value really is base64. Node's decoder
  // silently discards anything outside the alphabet, so feeding it arbitrary
  // text yields binary noise and a JSON error that describes the noise rather
  // than the actual problem.
  if (compact.length < 40 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(compact)) return null;
  try {
    const standard = compact.replace(/-/g, '+').replace(/_/g, '/'); // tolerate base64url
    return tryJson(Buffer.from(standard, 'base64').toString('utf8'));
  } catch {
    return null;
  }
};

/** Describes a bad value without ever echoing key material. */
const describeValue = (raw: string): string => {
  const t = raw.trim();
  const shape =
    t.startsWith('{') ? 'looks like JSON but did not parse'
    : t.startsWith('"') || t.startsWith("'") ? 'is wrapped in quotes'
    : t.startsWith('-----BEGIN') ? 'looks like a bare private key, not the whole service-account JSON'
    : /^[A-Za-z0-9+/_\-\s]+={0,2}$/.test(t) ? 'looks like base64 but did not decode to JSON'
    : t.includes('/') || t.includes('\\') ? 'looks like a file path — paste the file contents, not its location'
    : 'is not recognisable as JSON or base64';
  return `${shape} (${t.length} characters, starts with ${JSON.stringify(t.slice(0, 2))})`;
};

const parseServiceAccount = (raw: string): ServiceAccount => {
  const trimmed = raw.trim();
  const cleaned = stripWrappingQuotes(raw);
  // Try the value as given before stripping quotes: a properly JSON-encoded
  // string parses via tryJson's unwrapping, and stripping first would corrupt
  // its escapes. Stripping only helps for shell-style or unescaped wrapping.
  const parsed =
    tryJson(trimmed) ?? tryJson(cleaned) ?? tryBase64(trimmed) ?? tryBase64(cleaned);

  if (!parsed) {
    throw new ServiceAccountError(
      `FIREBASE_SERVICE_ACCOUNT could not be read: it ${describeValue(raw)}. ` +
        `Paste the service-account JSON exactly as downloaded from the Firebase console, ` +
        `or its base64 encoding.`
    );
  }

  const projectId = parsed.project_id || parsed.projectId;
  const clientEmail = parsed.client_email || parsed.clientEmail;
  let privateKey = parsed.private_key || parsed.privateKey;

  const missing = [
    !projectId && 'project_id',
    !clientEmail && 'client_email',
    !privateKey && 'private_key'
  ].filter(Boolean);
  if (missing.length) {
    throw new ServiceAccountError(
      `FIREBASE_SERVICE_ACCOUNT parsed but is missing ${missing.join(', ')}. ` +
        `Use the service-account key file, not the web app config.`
    );
  }

  // Hosts that store the value as a single line turn real newlines into "\n".
  privateKey = String(privateKey).replace(/\\n/g, '\n');
  if (!privateKey.includes('BEGIN') || !privateKey.includes('PRIVATE KEY')) {
    throw new ServiceAccountError(
      'FIREBASE_SERVICE_ACCOUNT has a private_key that is not a PEM block — it was probably truncated in transit.'
    );
  }

  return { projectId, clientEmail, privateKey };
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
 *
 * Validates that the value can actually be parsed, not merely that it is set. A
 * malformed key otherwise surfaces as a JSON parse stack trace from deep inside
 * a webhook, which says nothing about which environment variable is at fault.
 */
let configCheck: { ok: boolean; reason?: string } | null = null;

export const serverStoreStatus = (): { ok: boolean; reason?: string } => {
  if (configCheck) return configCheck;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) {
    configCheck = { ok: false, reason: 'FIREBASE_SERVICE_ACCOUNT is not set.' };
  } else {
    try {
      parseServiceAccount(raw);
      configCheck = { ok: true };
    } catch (e: any) {
      configCheck = { ok: false, reason: e?.message || 'FIREBASE_SERVICE_ACCOUNT is invalid.' };
    }
  }
  return configCheck;
};

export const isServerStoreConfigured = (): boolean => serverStoreStatus().ok;

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

export class ProjectConflictError extends Error {}

export const projectIdsMatch = (storedId: unknown, requestedId: unknown): boolean =>
  storedId !== null && storedId !== undefined
  && requestedId !== null && requestedId !== undefined
  && String(storedId) === String(requestedId);

export const projectRevisionsMatch = (storedRevision: unknown, expectedRevision: unknown): boolean =>
  Number(storedRevision || 0) === Number(expectedRevision || 0);

export const findProject = async (orgId: string, projectId: string): Promise<LocatedProject | null> => {
  const snap = await getDb().ref(`projects/${orgId}/projects`).get();
  if (!snap.exists()) return null;

  const list = toArray<Project>(snap.val());
  const index = list.findIndex(p => p && projectIdsMatch(p.id, projectId));
  if (index === -1) return null;

  const project = list[index];
  return {
    index,
    project: {
      ...project,
      revision: Number(project.revision || 0),
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

export const readTenantCommunicationsSettings = async (orgId: string): Promise<CommunicationsSettings> => {
  const snap = await getDb().ref(`projects/${orgId}/settings/communications`).get();
  const value = snap.exists() && snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
  return { fromNumber: typeof value.fromNumber === 'string' ? value.fromNumber.trim() : undefined };
};

export const resolveIdentityFromSettings = (
  details: Record<string, TeamMemberDetails>,
  personId: string,
  channel: 'email' | 'sms' | 'voice'
): string => {
  const direct = personId.trim();
  if (channel === 'email' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(direct)) return direct;
  if (channel !== 'email' && /^\+[1-9]\d{7,14}$/.test(direct)) return direct;

  const exact = details[personId];
  const matches = exact
    ? [exact]
    : Object.entries(details)
        .filter(([name]) => name.trim().toLowerCase() === direct.toLowerCase())
        .map(([, value]) => value);
  if (matches.length !== 1) {
    throw new Error(matches.length > 1
      ? `Person identity "${personId}" is ambiguous in tenant settings`
      : `Person identity "${personId}" has no configured ${channel === 'email' ? 'email address' : 'phone number'}`);
  }
  const identity = channel === 'email' ? matches[0].email?.trim() : matches[0].phone?.trim();
  if (!identity) throw new Error(`Person identity "${personId}" has no configured ${channel === 'email' ? 'email address' : 'phone number'}`);
  if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identity)) {
    throw new Error(`Person identity "${personId}" has an invalid email address`);
  }
  if (channel !== 'email' && !/^\+[1-9]\d{7,14}$/.test(identity)) {
    throw new Error(`Person identity "${personId}" phone number must use E.164 format`);
  }
  return identity;
};

export const resolveTeamMemberIdentity = async (
  orgId: string,
  personId: string,
  channel: 'email' | 'sms' | 'voice'
): Promise<string> => {
  const snap = await getDb().ref(`projects/${orgId}/settings`).get();
  const settings = (snap.exists() ? snap.val() : {}) as Partial<AppSettings>;
  const details = settings.teamMemberDetails && typeof settings.teamMemberDetails === 'object'
    ? settings.teamMemberDetails as Record<string, TeamMemberDetails>
    : {};
  return resolveIdentityFromSettings(details, personId, channel);
};

/**
 * Writes a single project back, leaving settings / scratchTasks / activityLogs
 * untouched. `undefined` is not a legal RTDB value, so strip it the same way the
 * client's save path does.
 */
export const writeProject = async (orgId: string, index: number, project: Project): Promise<void> => {
  const expectedRevision = Number(project.revision || 0);
  let conflictReason = 'transaction_not_committed';
  const clean = JSON.parse(JSON.stringify({
    ...project,
    revision: expectedRevision + 1,
    updatedAt: Date.now()
  }));
  const result = await getDb().ref(`projects/${orgId}`).transaction(current => {
    if (!current) {
      conflictReason = 'tenant_data_missing';
      return undefined;
    }
    const projects = toArray<Project>(current.projects);
    const stored = projects[index];
    if (!stored) {
      conflictReason = `project_index_missing:${index}`;
      return undefined;
    }
    if (!projectIdsMatch(stored.id, project.id)) {
      conflictReason = 'project_id_mismatch';
      return undefined;
    }
    if (!projectRevisionsMatch(stored.revision, expectedRevision)) {
      conflictReason = `revision_mismatch:stored=${Number(stored.revision || 0)},expected=${expectedRevision}`;
      return undefined;
    }
    projects[index] = clean;
    return {
      ...current,
      projects,
      dataRevision: Number(current.dataRevision || 0) + 1,
      lastUpdated: Date.now()
    };
  });
  if (!result.committed) throw new ProjectConflictError(`Project ${project.id} write conflict (${conflictReason}); retry the operation`);
};

export const appendActivityLog = async (orgId: string, log: ActivityLog): Promise<void> => {
  // Written under its own key so it never collides with the client's array rewrite.
  await getDb().ref(`serverActivity/${orgId}`).push(JSON.parse(JSON.stringify(log)));
};

const externalEventRef = (eventId: string) => {
  // encodeURIComponent covers every RTDB-forbidden key character except dot.
  // Encode dot instead of replacing with '_' so distinct event ids cannot collide.
  const safeId = encodeURIComponent(eventId).replace(/\./g, '%2E');
  return getDb().ref(`external_events/${safeId}`);
};

/** Durable event inbox insert. The transaction makes event_id the idempotency key. */
export const persistExternalEvent = async (event: ExternalEventRecord): Promise<boolean> => {
  const result = await externalEventRef(event.event_id).transaction(current =>
    current === null ? JSON.parse(JSON.stringify(event)) : undefined
  );
  return result.committed;
};

/** Claims a received or previously-failed event for one processing attempt. */
export const claimExternalEventProcessing = async (eventId: string): Promise<boolean> => {
  const result = await externalEventRef(eventId).transaction(current => {
    if (!current || !['received', 'processing_failed'].includes(current.processing_status)) return undefined;
    return { ...current, processing_status: 'processing', processing_error: null };
  });
  return result.committed;
};

export const finishExternalEventProcessing = async (
  eventId: string,
  status: Extract<ExternalEventProcessingStatus, 'processed' | 'processing_failed'>,
  error?: string
): Promise<void> => {
  await externalEventRef(eventId).update({
    processing_status: status,
    processed_at: new Date().toISOString(),
    processing_error: error || null
  });
};
