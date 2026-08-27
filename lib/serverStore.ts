import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { randomUUID } from 'node:crypto';
import { ActivityLog, AppSettings, CommunicationsSettings, Project, TeamMemberDetails } from '../types.js';
import { normalizeNodeAsks } from './humanAsk.js';
import type { ExternalEventProcessingStatus, ExternalEventRecord } from './externalEvents.js';

/**
 * Server-side persistence via the Firebase Admin SDK.
 *
 * Browser and server writes use RTDB transactions with optimistic revisions.
 * A stale writer fails rather than overwriting a concurrent flow or Ask update.
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

const getServerApp = () => {
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
  return app;
};

const getDb = () => getDatabase(getServerApp());

export interface AuthenticatedMember {
  uid: string;
  email?: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
}

export const verifyFirebaseIdToken = async (token: string): Promise<{ uid: string; email?: string }> => {
  if (!token) throw new Error('Missing Firebase ID token');
  const decoded = await getAuth(getServerApp()).verifyIdToken(token, true);
  return { uid: decoded.uid, email: decoded.email };
};

export const readUserOrganization = async (uid: string): Promise<AuthenticatedMember | null> => {
  const userSnap = await getDb().ref(`users/${uid}`).get();
  if (!userSnap.exists()) return null;
  const user = userSnap.val() || {};
  const orgId = typeof user.orgId === 'string' ? user.orgId : '';
  if (!orgId) return null;
  const memberSnap = await getDb().ref(`organizations/${orgId}/members/${uid}`).get();
  if (!memberSnap.exists()) return null;
  const member = memberSnap.val() || {};
  const role = ['owner', 'admin', 'member'].includes(member.role) ? member.role : 'member';
  return { uid, email: typeof user.email === 'string' ? user.email : undefined, orgId, role };
};

export const requireOrganizationMember = async (uid: string, orgId?: string): Promise<AuthenticatedMember> => {
  const member = await readUserOrganization(uid);
  if (!member || (orgId && member.orgId !== orgId)) throw new Error('Organization membership required');
  return member;
};

export const createOrganizationForUser = async (
  uid: string,
  email: string | undefined,
  name: string
): Promise<string> => {
  const existingMembership = await readUserOrganization(uid);
  if (existingMembership) throw new Error('This account already belongs to an organization');
  const orgId = `org_${randomUUID().replace(/-/g, '')}`;
  const now = Date.now();
  await getDb().ref().update({
    [`organizations/${orgId}/name`]: name,
    [`organizations/${orgId}/createdAt`]: now,
    [`organizations/${orgId}/members/${uid}`]: { role: 'owner', joinedAt: now, email: email || null },
    [`users/${uid}`]: { email: email || null, orgId, role: 'owner' }
  });
  return orgId;
};

export const createOrganizationInvite = async (
  member: AuthenticatedMember,
  email: string
): Promise<string> => {
  if (!['owner', 'admin'].includes(member.role)) throw new Error('Administrator membership required');
  const token = `invite_${randomUUID().replace(/-/g, '')}`;
  await getDb().ref(`invites/${token}`).set({
    orgId: member.orgId,
    invitedBy: member.uid,
    email,
    createdAt: Date.now()
  });
  return token;
};

export const consumeOrganizationInvite = async (
  uid: string,
  authenticatedEmail: string | undefined,
  token: string
): Promise<string> => {
  const inviteRef = getDb().ref(`invites/${token}`);
  const preview = await inviteRef.get();
  const previewOrgId = preview.exists() ? String(preview.val()?.orgId || '') : '';
  const existingMembership = await readUserOrganization(uid);
  if (existingMembership && existingMembership.orgId !== previewOrgId) {
    throw new Error('This account already belongs to another organization');
  }
  let orgId = '';
  const result = await inviteRef.transaction(current => {
    if (!current) return undefined;
    if (current.consumedAt) {
      if (current.consumedBy !== uid) return undefined;
      orgId = String(current.orgId || '');
      return current; // idempotent retry after a partial network failure
    }
    if (Date.now() - Number(current.createdAt || 0) > 7 * 24 * 60 * 60 * 1000) return undefined;
    const intended = String(current.email || '').trim().toLowerCase();
    if (intended && intended !== String(authenticatedEmail || '').trim().toLowerCase()) return undefined;
    orgId = String(current.orgId || '');
    if (!orgId) return undefined;
    return { ...current, consumedAt: Date.now(), consumedBy: uid };
  });
  if (!result.committed || !orgId) throw new Error('Invite is invalid, expired, already used, or belongs to another email');
  const now = Date.now();
  await getDb().ref().update({
    [`organizations/${orgId}/members/${uid}`]: { role: 'member', joinedAt: now, email: authenticatedEmail || null },
    [`users/${uid}`]: { email: authenticatedEmail || null, orgId, role: 'member' }
  });
  return orgId;
};

export interface LegacyMembershipCandidate {
  uid: string;
  orgId: string;
  role: 'owner' | 'admin' | 'member';
  alreadyMigrated: boolean;
}

/** Audits, and optionally migrates, legacy users/{uid}.orgId records. */
export const migrateLegacyMemberships = async (apply = false): Promise<LegacyMembershipCandidate[]> => {
  const [usersSnap, organizationsSnap] = await Promise.all([
    getDb().ref('users').get(),
    getDb().ref('organizations').get()
  ]);
  const users = usersSnap.exists() ? usersSnap.val() || {} : {};
  const organizations = organizationsSnap.exists() ? organizationsSnap.val() || {} : {};
  const candidates: LegacyMembershipCandidate[] = [];
  const updates: Record<string, unknown> = {};
  for (const [uid, raw] of Object.entries<any>(users)) {
    const orgId = typeof raw?.orgId === 'string' ? raw.orgId : '';
    if (!orgId || !organizations[orgId]) continue;
    const existing = Boolean(organizations[orgId]?.members?.[uid]);
    const role = ['owner', 'admin', 'member'].includes(raw?.role) ? raw.role : 'member';
    candidates.push({ uid, orgId, role, alreadyMigrated: existing });
    if (apply && !existing) {
      updates[`organizations/${orgId}/members/${uid}`] = {
        role,
        email: typeof raw?.email === 'string' ? raw.email : null,
        joinedAt: Date.now(),
        migratedFromLegacyUser: true
      };
    }
  }
  if (apply && Object.keys(updates).length) await getDb().ref().update(updates);
  return candidates;
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

export const resolveReviewerActor = async (orgId: string, email: string | undefined, uid: string): Promise<string> => {
  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) return uid;
  const snap = await getDb().ref(`projects/${orgId}/settings/teamMemberDetails`).get();
  const details = snap.exists() && snap.val() && typeof snap.val() === 'object' ? snap.val() : {};
  const matches = Object.entries<any>(details)
    .filter(([, value]) => String(value?.email || '').trim().toLowerCase() === normalizedEmail)
    .map(([name]) => name);
  return matches.length === 1 ? matches[0] : normalizedEmail;
};

/**
 * Writes a single project back, leaving settings / scratchTasks / activityLogs
 * untouched. `undefined` is not a legal RTDB value, so strip it the same way the
 * client's save path does.
 */
export const writeProject = async (orgId: string, index: number, project: Project): Promise<void> => {
  const expectedRevision = Number(project.revision || 0);
  const clean = JSON.parse(JSON.stringify({
    ...project,
    revision: expectedRevision + 1,
    updatedAt: Date.now()
  }));
  let conflictReason = 'transaction_not_committed';
  const tenantRef = getDb().ref(`projects/${orgId}`);
  const projectRef = tenantRef.child(`projects/${index}`);
  const result = await projectRef.transaction(stored => {
    // Firebase can invoke the update function with an empty local cache before
    // it has read the server. Propose the value: if the project exists remotely,
    // Firebase retries this function with the real value before committing.
    if (!stored) return clean;
    if (!projectIdsMatch(stored.id, project.id)) {
      conflictReason = 'project_id_mismatch';
      return undefined;
    }
    if (!projectRevisionsMatch(stored.revision, expectedRevision)) {
      conflictReason = `revision_mismatch:stored=${Number(stored.revision || 0)},expected=${expectedRevision}`;
      return undefined;
    }
    return clean;
  });
  if (!result.committed) throw new ProjectConflictError(`Project ${project.id} write conflict (${conflictReason}); retry the operation`);
  await tenantRef.child('dataRevision').transaction(current => Number(current || 0) + 1);
  await tenantRef.update({ lastUpdated: Date.now() });
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
  const now = Date.now();
  const leaseExpiresAt = new Date(now + 2 * 60 * 1000).toISOString();
  const result = await externalEventRef(eventId).transaction(current => {
    if (!current) return undefined;
    const leaseExpired = current.processing_status === 'processing' &&
      (!current.lease_expires_at || new Date(current.lease_expires_at).getTime() <= now);
    if (!['received', 'processing_failed'].includes(current.processing_status) && !leaseExpired) return undefined;
    return {
      ...current,
      processing_status: 'processing',
      processing_error: null,
      attempt_count: Number(current.attempt_count || 0) + 1,
      claimed_at: new Date(now).toISOString(),
      lease_expires_at: leaseExpiresAt
    };
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
    processing_error: error || null,
    lease_expires_at: null
  });
};

export const readExternalEventProcessingStatus = async (eventId: string): Promise<ExternalEventProcessingStatus | null> => {
  const snap = await externalEventRef(eventId).child('processing_status').get();
  return snap.exists() ? snap.val() as ExternalEventProcessingStatus : null;
};

const askResolutionRef = (askId: string, communicationId: string) => {
  const key = encodeURIComponent(`${askId}:${communicationId}`).replace(/\./g, '%2E');
  return getDb().ref(`ask_resolution_outbox/${key}`);
};

export const enqueueAskResolution = async (askId: string, communicationId: string): Promise<void> => {
  await askResolutionRef(askId, communicationId).transaction(current => current || {
    ask_id: askId,
    communication_id: communicationId,
    status: 'pending',
    attempt_count: 0,
    created_at: new Date().toISOString()
  });
};

export const claimAskResolution = async (askId: string, communicationId: string): Promise<boolean> => {
  const now = Date.now();
  const result = await askResolutionRef(askId, communicationId).transaction(current => {
    if (!current || current.status === 'resolved') return undefined;
    const stale = current.status === 'processing' &&
      (!current.lease_expires_at || new Date(current.lease_expires_at).getTime() <= now);
    if (!['pending', 'failed'].includes(current.status) && !stale) return undefined;
    return {
      ...current,
      status: 'processing',
      attempt_count: Number(current.attempt_count || 0) + 1,
      claimed_at: new Date(now).toISOString(),
      lease_expires_at: new Date(now + 2 * 60 * 1000).toISOString(),
      error: null
    };
  });
  return result.committed;
};

export const finishAskResolution = async (
  askId: string,
  communicationId: string,
  status: 'resolved' | 'failed',
  error?: string
): Promise<void> => {
  await askResolutionRef(askId, communicationId).update({
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    lease_expires_at: null,
    error: error || null
  });
};
