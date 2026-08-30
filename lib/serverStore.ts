import { cert, getApps, initializeApp, ServiceAccount } from 'firebase-admin/app';
import { getDatabase } from 'firebase-admin/database';
import { getAuth } from 'firebase-admin/auth';
import { getStorage } from 'firebase-admin/storage';
import { randomUUID } from 'node:crypto';
import {
  ActivityLog,
  AgentActionProposal,
  AgentInboxJob,
  Attachment,
  AppSettings,
  CommunicationsSettings,
  ConversationContext,
  CoachingSession,
  ExternalActionReceipt,
  MailboxConnectionRef,
  Project,
  ScheduleRun,
  TeamMemberDetails,
  TenantAgentProfile,
  TenantSchedule,
  TenantScheduleInput,
  TriageDigest,
  TriageDisposition,
  TriageItem,
  WorkspaceConnectionRef,
  WorkspaceResourceGrant
} from '../types.js';
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
        databaseURL: getDatabaseUrl(),
        ...(process.env.FIREBASE_STORAGE_BUCKET ? { storageBucket: process.env.FIREBASE_STORAGE_BUCKET } : {})
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
  const allowedActions = new Set(['classify', 'link_workflow', 'progress_ask', 'create_draft', 'send_reply']);
  return {
    fromNumber: typeof value.fromNumber === 'string' ? value.fromNumber.trim() : undefined,
    defaultEmailIdentity: typeof value.defaultEmailIdentity === 'string' ? value.defaultEmailIdentity.trim() : undefined,
    replyServiceIdentity: typeof value.replyServiceIdentity === 'string' ? value.replyServiceIdentity.trim() : undefined,
    connectionId: typeof value.connectionId === 'string' ? value.connectionId.trim() : undefined,
    mailboxConnectionId: typeof value.mailboxConnectionId === 'string' ? value.mailboxConnectionId.trim() : undefined,
    timezone: typeof value.timezone === 'string' ? value.timezone.trim() : undefined,
    triagePolicy: ['all_inbound', 'human_only', 'correlated_only'].includes(value.triagePolicy)
      ? value.triagePolicy : undefined,
    sendPolicy: ['draft_only', 'allow_approved_send', 'automatic'].includes(value.sendPolicy)
      ? value.sendPolicy : undefined,
    allowedAutomaticActions: Array.isArray(value.allowedAutomaticActions)
      ? value.allowedAutomaticActions.filter((action: unknown) => typeof action === 'string' && allowedActions.has(action))
      : undefined
  } as CommunicationsSettings;
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

const safeRtdbKey = (value: string): string => encodeURIComponent(value).replace(/\./g, '%2E');

const MAX_ASK_UPLOAD_BYTES = 2 * 1024 * 1024;
const ALLOWED_ASK_UPLOAD_MIME = new Set([
  'application/pdf', 'text/plain', 'text/csv',
  'image/png', 'image/jpeg', 'image/webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

export interface AskUploadInput {
  field: string;
  name: string;
  mime: string;
  base64: string;
}

export const validateAskUpload = (input: AskUploadInput, allowedFields: string[]): { field: string; name: string; mime: string; bytes: Buffer } => {
  const field = String(input?.field || '').trim();
  if (!allowedFields.includes(field)) throw new Error('Upload field is not declared by this Ask');
  const name = String(input?.name || '').replace(/[\r\n]/g, '').trim().slice(0, 180);
  if (!name || /[\\/]/.test(name)) throw new Error('Upload filename is invalid');
  const mime = String(input?.mime || '').trim().toLowerCase();
  if (!ALLOWED_ASK_UPLOAD_MIME.has(mime)) throw new Error('Upload file type is not allowed');
  if (typeof input.base64 !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) throw new Error('Upload body is not valid base64');
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_ASK_UPLOAD_BYTES) throw new Error('Upload must be between 1 byte and 2 MB');
  if (bytes.toString('base64').replace(/=+$/, '') !== input.base64.replace(/=+$/, '')) throw new Error('Upload body is not canonical base64');
  return { field, name, mime, bytes };
};

export const listTenantProjects = async (orgId: string): Promise<Project[]> => {
  const snap = await getDb().ref(`projects/${orgId}/projects`).get();
  if (!snap.exists()) return [];
  return toArray<Project>(snap.val()).filter(project => Boolean(project?.id));
};

export const storeAskUploads = async (input: {
  orgId: string;
  projectId: string;
  askId: string;
  allowedFields: string[];
  uploads: AskUploadInput[];
}): Promise<Attachment[]> => {
  if (!process.env.FIREBASE_STORAGE_BUCKET) throw new Error('FIREBASE_STORAGE_BUCKET is required for Ask uploads');
  if (!Array.isArray(input.uploads) || input.uploads.length > 3) throw new Error('At most three files may be uploaded');
  const bucket = getStorage(getServerApp()).bucket();
  const attachments: Attachment[] = [];
  const storedFiles: Array<{ delete: () => Promise<unknown> }> = [];
  try {
    for (const upload of input.uploads) {
      const valid = validateAskUpload(upload, input.allowedFields);
      const id = `attachment_${randomUUID().replace(/-/g, '')}`;
      const storagePath = `ask_uploads/${safeRtdbKey(input.orgId)}/${safeRtdbKey(input.projectId)}/${safeRtdbKey(input.askId)}/${id}/${valid.name}`;
      const file = bucket.file(storagePath);
      await file.save(valid.bytes, {
        resumable: false,
        validation: 'crc32c',
        metadata: { contentType: valid.mime, contentDisposition: `attachment; filename="${valid.name.replace(/"/g, '')}"` }
      });
      storedFiles.push(file);
      const [url] = await file.getSignedUrl({ action: 'read', expires: Date.now() + 7 * 24 * 60 * 60 * 1000, version: 'v4' });
      const kind: Attachment['kind'] = valid.mime.startsWith('image/') ? 'image' : 'document';
      attachments.push({
        id, url, storagePath, name: valid.name, mime: valid.mime, bytes: valid.bytes.length,
        kind, source: 'web', capturedAt: Date.now()
      });
    }
  } catch (error) {
    await Promise.allSettled(storedFiles.map(file => file.delete()));
    throw error;
  }
  return attachments;
};

export const deleteStoredAskAttachments = async (attachments: Attachment[]): Promise<void> => {
  if (!attachments.length || !process.env.FIREBASE_STORAGE_BUCKET) return;
  const bucket = getStorage(getServerApp()).bucket();
  await Promise.allSettled(attachments
    .filter(attachment => attachment.storagePath?.startsWith('ask_uploads/'))
    .map(attachment => bucket.file(attachment.storagePath!).delete()));
};

const externalEventRef = (orgId: string, eventId: string) => {
  // encodeURIComponent covers every RTDB-forbidden key character except dot.
  // Encode dot instead of replacing with '_' so distinct event ids cannot collide.
  return getDb().ref(`external_events/${safeRtdbKey(orgId)}/${safeRtdbKey(eventId)}`);
};

type ExternalEventInboxRef = {
  transaction: (update: (current: any) => any) => Promise<{
    committed: boolean;
    snapshot: { val: () => any };
  }>;
};

export interface ExternalEventProcessingClaim {
  claimed: boolean;
  record?: ExternalEventRecord;
}

const EXTERNAL_EVENT_CLAIM_LEASE_MS = 5 * 60 * 1000;

/** Atomically inserts and claims an event, using event_id as the idempotency key. */
export const beginExternalEventProcessingAtRef = async (
  ref: ExternalEventInboxRef,
  event: ExternalEventRecord,
  claimId: string,
  now = new Date(),
  leaseMs = EXTERNAL_EVENT_CLAIM_LEASE_MS
): Promise<ExternalEventProcessingClaim> => {
  const startedAt = now.toISOString();
  const nowMs = now.getTime();
  const result = await ref.transaction(current => {
    // Firebase Admin may initially invoke this updater with `null` before it
    // has read the server value. Propose the insert instead of aborting; if a
    // row already exists Firebase reruns the updater with that canonical row.
    if (current === null) {
      return {
        ...JSON.parse(JSON.stringify(event)),
        processing_status: 'processing',
        processing_claim_id: claimId,
        processing_started_at: startedAt,
        processing_error: null,
        processed_at: null
      };
    }

    const startedMs = Date.parse(current.processing_started_at || '');
    const staleProcessing = current.processing_status === 'processing'
      && (!Number.isFinite(startedMs) || nowMs - startedMs >= leaseMs);
    if (!['received', 'processing_failed'].includes(current.processing_status) && !staleProcessing) return undefined;
    return {
      ...current,
      processing_status: 'processing',
      processing_claim_id: claimId,
      processing_started_at: startedAt,
      processing_error: null,
      processed_at: null
    };
  });
  const stored = result.snapshot.val() as ExternalEventRecord | null;
  const claimed = Boolean(result.committed && stored?.processing_claim_id === claimId);
  return { claimed, record: claimed && stored ? stored : undefined };
};

export const beginExternalEventProcessing = async (
  event: ExternalEventRecord
): Promise<ExternalEventProcessingClaim> => {
  const orgId = event.payload.correlation.tenant_id;
  if (!orgId) throw new Error('tenant_id is required before an external event can be persisted');
  return beginExternalEventProcessingAtRef(externalEventRef(orgId, event.event_id), event, randomUUID());
};

export const finishExternalEventProcessing = async (
  orgId: string,
  eventId: string,
  status: Extract<ExternalEventProcessingStatus, 'processed' | 'processing_failed'>,
  error?: string
): Promise<void> => {
  await externalEventRef(orgId, eventId).update({
    processing_status: status,
    processed_at: new Date().toISOString(),
    processing_error: error || null,
    processing_claim_id: null,
    processing_started_at: null
  });
};

const askResolutionRef = (orgId: string, askId: string, communicationId: string) => {
  return getDb().ref(
    `ask_resolutions/${safeRtdbKey(orgId)}/${safeRtdbKey(askId)}/${safeRtdbKey(communicationId)}`
  );
};

export const enqueueAskResolution = async (orgId: string, askId: string, communicationId: string): Promise<void> => {
  await askResolutionRef(orgId, askId, communicationId).transaction(current => current || {
    org_id: orgId,
    ask_id: askId,
    communication_id: communicationId,
    status: 'pending',
    attempt_count: 0,
    created_at: new Date().toISOString()
  });
};

export const claimAskResolution = async (orgId: string, askId: string, communicationId: string): Promise<boolean> => {
  const now = Date.now();
  const result = await askResolutionRef(orgId, askId, communicationId).transaction(current => {
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
  orgId: string,
  askId: string,
  communicationId: string,
  status: 'resolved' | 'failed',
  error?: string
): Promise<void> => {
  await askResolutionRef(orgId, askId, communicationId).update({
    status,
    resolved_at: status === 'resolved' ? new Date().toISOString() : null,
    lease_expires_at: null,
    error: error || null
  });
};

const triageItemRef = (orgId: string, itemId: string) =>
  getDb().ref(`triage_items/${safeRtdbKey(orgId)}/${safeRtdbKey(itemId)}`);

export const upsertTriageItem = async (item: TriageItem): Promise<TriageItem> => {
  const result = await triageItemRef(item.orgId, item.id).transaction(current => {
    if (!current) return JSON.parse(JSON.stringify(item));
    const existingAudit = Array.isArray(current.audit) ? current.audit : Object.values(current.audit || {});
    const incomingAudit = Array.isArray(item.audit) ? item.audit : [];
    return {
      ...current,
      ...JSON.parse(JSON.stringify(item)),
      createdAt: Number(current.createdAt || item.createdAt),
      audit: [...existingAudit, ...incomingAudit].slice(-100)
    };
  });
  return result.snapshot.val() as TriageItem;
};

export const listTenantTriageItems = async (orgId: string, limit = 100): Promise<TriageItem[]> => {
  const snap = await getDb().ref(`triage_items/${safeRtdbKey(orgId)}`)
    .orderByChild('updatedAt').limitToLast(Math.min(Math.max(limit, 1), 500)).get();
  if (!snap.exists()) return [];
  return Object.values(snap.val() || {}).sort((a: any, b: any) => Number(b.updatedAt) - Number(a.updatedAt)) as TriageItem[];
};

const triageDigestRef = (orgId: string, digestId: string) =>
  getDb().ref(`triage_digests/${safeRtdbKey(orgId)}/${safeRtdbKey(digestId)}`);

export const saveTriageDigest = async (digest: TriageDigest): Promise<TriageDigest> => {
  const result = await triageDigestRef(digest.orgId, digest.id).transaction(current => ({
    ...(current || {}),
    ...JSON.parse(JSON.stringify(digest)),
    createdAt: Number(current?.createdAt || digest.createdAt),
    updatedAt: Date.now()
  }));
  if (!result.committed) throw new Error('Triage digest could not be saved');
  return result.snapshot.val() as TriageDigest;
};

export const listTenantTriageDigests = async (orgId: string, limit = 30): Promise<TriageDigest[]> => {
  const snap = await getDb().ref(`triage_digests/${safeRtdbKey(orgId)}`)
    .orderByChild('scheduledFor').limitToLast(Math.min(Math.max(limit, 1), 100)).get();
  if (!snap.exists()) return [];
  return (Object.values(snap.val() || {}) as TriageDigest[])
    .sort((a, b) => Number(b.scheduledFor) - Number(a.scheduledFor));
};

export const readTenantTriageItem = async (orgId: string, itemId: string): Promise<TriageItem | null> => {
  const snap = await triageItemRef(orgId, itemId).get();
  return snap.exists() ? snap.val() as TriageItem : null;
};

export const patchTenantTriageItem = async (
  orgId: string,
  itemId: string,
  patch: Partial<Pick<TriageItem, 'projectId' | 'askId' | 'proposedAction' | 'interpretation' | 'agentProposal'>>,
  actor: string,
  action: string
): Promise<TriageItem | null> => {
  const now = Date.now();
  const result = await triageItemRef(orgId, itemId).transaction(current => {
    if (!current) return undefined;
    const audit = Array.isArray(current.audit) ? current.audit : Object.values(current.audit || {});
    return {
      ...current,
      ...JSON.parse(JSON.stringify(patch)),
      updatedAt: now,
      audit: [...audit, { at: now, action, actor }].slice(-100)
    };
  });
  return result.committed ? result.snapshot.val() as TriageItem : null;
};

export const setTenantTriageDisposition = async (
  orgId: string,
  itemId: string,
  disposition: TriageDisposition,
  actor: string,
  detail?: string
): Promise<TriageItem | null> => {
  const now = Date.now();
  const result = await triageItemRef(orgId, itemId).transaction(current => {
    if (!current) return undefined;
    const audit = Array.isArray(current.audit) ? current.audit : Object.values(current.audit || {});
    return {
      ...current,
      disposition,
      updatedAt: now,
      audit: [...audit, { at: now, action: `disposition:${disposition}`, actor, detail: detail || null }].slice(-100)
    };
  });
  return result.committed ? result.snapshot.val() as TriageItem : null;
};

export const writeCommunicationDeliveryState = async (
  orgId: string,
  communicationId: string,
  state: Record<string, unknown>
): Promise<void> => {
  await getDb().ref(
    `communication_delivery/${safeRtdbKey(orgId)}/${safeRtdbKey(communicationId)}`
  ).update({ ...JSON.parse(JSON.stringify(state)), updatedAt: Date.now() });
};

const scheduleRef = (orgId: string, scheduleId: string) =>
  getDb().ref(`schedules/${safeRtdbKey(orgId)}/${safeRtdbKey(scheduleId)}`);

export const listTenantSchedules = async (orgId: string): Promise<TenantSchedule[]> => {
  const snap = await getDb().ref(`schedules/${safeRtdbKey(orgId)}`).get();
  return snap.exists() ? Object.values(snap.val() || {}) as TenantSchedule[] : [];
};

export const saveTenantSchedule = async (
  orgId: string,
  input: TenantScheduleInput
): Promise<TenantSchedule> => {
  const now = Date.now();
  const id = String(input.id || `schedule_${randomUUID().replace(/-/g, '')}`);
  const existing = (await scheduleRef(orgId, id).get()).val() as TenantSchedule | null;
  const schedule = normalizeTenantSchedule(orgId, id, input, existing, now);
  if (!schedule.name) throw new Error('Schedule name is required');
  if (schedule.activity === 'flow_start' && !schedule.projectId) {
    throw new Error('projectId is required for a flow_start schedule');
  }
  await scheduleRef(orgId, id).set(JSON.parse(JSON.stringify(schedule)));
  return schedule;
};

export const normalizeTenantSchedule = (
  orgId: string,
  id: string,
  input: TenantScheduleInput,
  existing: TenantSchedule | null,
  now: number
): TenantSchedule => {
  const activity = input.activity ?? existing?.activity ?? 'communications_triage';
  const requestedInterval = Number(
    input.recurrence?.kind === 'interval'
      ? input.recurrence.intervalMinutes
      : input.intervalMinutes ?? existing?.intervalMinutes ?? 15
  );
  const intervalMinutes = Number.isFinite(requestedInterval)
    ? Math.min(Math.max(requestedInterval, 5), 1440)
    : 15;
  const timezone = normalizeTimeZone(input.timezone ?? existing?.timezone ?? 'Australia/Brisbane');
  const existingRecurrence = existing?.recurrence;
  const recurrence = normalizeScheduleRecurrence(input.recurrence ?? existingRecurrence, intervalMinutes);
  const defaultNextRun = recurrence.kind === 'daily'
    ? nextDailyScheduleOccurrence(now, recurrence.localTime, timezone)
    : now;
  const requestedNextRun = Number(input.nextRunAt ?? existing?.nextRunAt ?? defaultNextRun);
  const misfirePolicy = ['run_once', 'catch_up', 'skip'].includes(String(input.misfirePolicy ?? existing?.misfirePolicy))
    ? (input.misfirePolicy ?? existing?.misfirePolicy) as TenantSchedule['misfirePolicy']
    : 'run_once';
  const base = {
    id,
    orgId,
    name: String(input.name ?? existing?.name ?? '').trim().slice(0, 120),
    enabled: input.enabled ?? existing?.enabled ?? true,
    intervalMinutes: recurrence.kind === 'interval' ? recurrence.intervalMinutes : 1440,
    recurrence,
    misfirePolicy,
    timezone,
    nextRunAt: Number.isFinite(requestedNextRun) ? requestedNextRun : now,
    createdAt: Number(existing?.createdAt || now),
    updatedAt: now
  };
  if (activity === 'flow_start') {
    const prior = existing?.activity === 'flow_start' ? existing : undefined;
    return {
      ...base,
      activity,
      projectId: String(input.projectId ?? prior?.projectId ?? '').trim(),
      flowId: cleanOptionalString(input.flowId ?? prior?.flowId),
      input: normalizeScheduleInput(input.input ?? prior?.input),
      resetPolicy: input.resetPolicy === 'flow' || input.resetPolicy === 'none'
        ? input.resetPolicy : prior?.resetPolicy || 'none',
      clearProjectDataKeys: cleanStringList(input.clearProjectDataKeys ?? prior?.clearProjectDataKeys, 200)
    };
  }
  const prior = existing?.activity === 'communications_triage' ? existing : undefined;
  const policy = input.policy ?? prior?.policy ?? 'draft_only';
  return {
    ...base,
    activity: 'communications_triage',
    connectionId: cleanOptionalString(input.connectionId ?? prior?.connectionId),
    policy: ['draft_only', 'allow_approved_send', 'automatic'].includes(policy) ? policy : 'draft_only',
    digestChannel: ['web', 'email', 'sms'].includes(String(input.digestChannel ?? prior?.digestChannel))
      ? (input.digestChannel ?? prior?.digestChannel) as 'web' | 'email' | 'sms'
      : 'web',
    digestRecipient: cleanOptionalString(input.digestRecipient ?? prior?.digestRecipient)
  };
};

export const claimTriageAgentProposal = async (
  orgId: string,
  itemId: string,
  actor: string
): Promise<TriageItem | null> => {
  const now = Date.now();
  const result = await triageItemRef(orgId, itemId).transaction(current => {
    const proposal = current?.agentProposal as AgentActionProposal | undefined;
    if (!proposal || !['pending', 'failed'].includes(proposal.status)) return undefined;
    const audit = Array.isArray(current.audit) ? current.audit : Object.values(current.audit || {});
    return {
      ...current,
      agentProposal: { ...proposal, status: 'processing', reviewedBy: actor, reviewedAt: now, error: null },
      updatedAt: now,
      audit: [...audit, { at: now, action: 'agent_proposal.claimed', actor }].slice(-100)
    };
  });
  return result.committed ? result.snapshot.val() as TriageItem : null;
};

export const finishTriageAgentProposal = async (
  orgId: string,
  itemId: string,
  status: 'applied' | 'rejected' | 'failed',
  actor: string,
  error?: string
): Promise<TriageItem | null> => {
  const now = Date.now();
  const result = await triageItemRef(orgId, itemId).transaction(current => {
    const proposal = current?.agentProposal as AgentActionProposal | undefined;
    if (!proposal || (status !== 'rejected' && proposal.status !== 'processing')) return undefined;
    if (status === 'rejected' && !['pending', 'failed'].includes(proposal.status)) return undefined;
    const audit = Array.isArray(current.audit) ? current.audit : Object.values(current.audit || {});
    return {
      ...current,
      agentProposal: { ...proposal, status, reviewedBy: actor, reviewedAt: now, error: error || null },
      disposition: status === 'applied' || status === 'rejected' ? 'resolved' : 'needs_review',
      updatedAt: now,
      audit: [...audit, { at: now, action: `agent_proposal.${status}`, actor, detail: error || null }].slice(-100)
    };
  });
  return result.committed ? result.snapshot.val() as TriageItem : null;
};

const cleanStringList = (value: unknown, limit = 100): string[] | undefined => {
  const clean = toArray<unknown>(value)
    .filter(item => typeof item === 'string')
    .map(item => String(item).trim())
    .filter(Boolean)
    .slice(0, limit);
  return clean.length ? [...new Set(clean)] : undefined;
};

export const normalizeTenantAgentProfile = (
  input: Partial<TenantAgentProfile>,
  existing?: TenantAgentProfile | null
): TenantAgentProfile => {
  const timezone = normalizeTimeZone(input.timezone ?? existing?.timezone ?? 'Australia/Brisbane');
  const automaticActions = cleanStringList(input.automaticActions ?? existing?.automaticActions)
    ?.filter(action => ['draft', 'send', 'call', 'sheet_write'].includes(action)) as TenantAgentProfile['automaticActions'];
  const phone = cleanOptionalString(input.serviceIdentities?.phone ?? existing?.serviceIdentities?.phone);
  const sms = cleanOptionalString(input.serviceIdentities?.sms ?? existing?.serviceIdentities?.sms);
  const email = cleanOptionalString(input.serviceIdentities?.email ?? existing?.serviceIdentities?.email);
  const rawPersonAccess = Array.isArray(input.personProjectAccess)
    ? input.personProjectAccess
    : Array.isArray(existing?.personProjectAccess) ? existing.personProjectAccess : [];
  const personProjectAccess = rawPersonAccess
    .filter(item => item && typeof item === 'object')
    .map(item => ({
      personId: cleanOptionalString(item.personId),
      projectIds: cleanStringList(item.projectIds) || []
    }))
    .filter((item): item is { personId: string; projectIds: string[] } => Boolean(item.personId))
    .slice(0, 100)
    .reduce<Array<{ personId: string; projectIds: string[] }>>((items, item) => {
      const existingIndex = items.findIndex(candidate => candidate.personId === item.personId);
      if (existingIndex >= 0) items[existingIndex] = item;
      else items.push(item);
      return items;
    }, []);
  return {
    agentId: cleanOptionalString(input.agentId ?? existing?.agentId) || `agent_${randomUUID().replace(/-/g, '')}`,
    displayName: String(input.displayName ?? existing?.displayName ?? 'HyperFlow Agent').trim().slice(0, 120) || 'HyperFlow Agent',
    timezone,
    primaryPersonId: cleanOptionalString(input.primaryPersonId ?? existing?.primaryPersonId),
    defaultProjectId: cleanOptionalString(input.defaultProjectId ?? existing?.defaultProjectId),
    allowedProjectIds: cleanStringList(input.allowedProjectIds ?? existing?.allowedProjectIds),
    personProjectAccess: personProjectAccess.length ? personProjectAccess : undefined,
    serviceIdentities: {
      ...(phone && /^\+[1-9]\d{7,14}$/.test(phone) ? { phone } : {}),
      ...(sms && /^\+[1-9]\d{7,14}$/.test(sms) ? { sms } : {}),
      ...(email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? { email: email.toLowerCase() } : {})
    },
    clarificationPolicy: input.clarificationPolicy === 'always' || input.clarificationPolicy === 'when_ambiguous'
      ? input.clarificationPolicy
      : existing?.clarificationPolicy || 'when_ambiguous',
    automaticActions
  };
};

export const readTenantAgentProfile = async (orgId: string): Promise<TenantAgentProfile | null> => {
  const snap = await getDb().ref(`agent_profiles/${safeRtdbKey(orgId)}`).get();
  return snap.exists() ? normalizeTenantAgentProfile(snap.val()) : null;
};

export const saveTenantAgentProfile = async (
  orgId: string,
  input: Partial<TenantAgentProfile>
): Promise<TenantAgentProfile> => {
  const existing = await readTenantAgentProfile(orgId);
  const profile = normalizeTenantAgentProfile(input, existing);
  await getDb().ref(`agent_profiles/${safeRtdbKey(orgId)}`).set(JSON.parse(JSON.stringify(profile)));
  return profile;
};

const agentInboxJobRef = (orgId: string, jobId: string) =>
  getDb().ref(`agent_inbox_jobs/${safeRtdbKey(orgId)}/${safeRtdbKey(jobId)}`);

const agentInboxIndexRef = (orgId: string, jobId: string) =>
  getDb().ref(`agent_inbox_pending/${safeRtdbKey(`${orgId}:${jobId}`)}`);

export const enqueueAgentInboxJob = async (
  input: Omit<AgentInboxJob, 'status' | 'attemptCount' | 'createdAt' | 'updatedAt'>
): Promise<AgentInboxJob> => {
  const now = Date.now();
  const result = await agentInboxJobRef(input.orgId, input.id).transaction(current => current || {
    ...JSON.parse(JSON.stringify(input)), status: 'pending', attemptCount: 0, createdAt: now, updatedAt: now
  });
  const job = result.snapshot.val() as AgentInboxJob;
  if (job.status === 'pending' || job.status === 'failed') {
    await agentInboxIndexRef(job.orgId, job.id).set({ orgId: job.orgId, jobId: job.id, availableAt: now, createdAt: job.createdAt });
  }
  return job;
};

export const claimAgentInboxJobs = async (limit = 10, now = Date.now()): Promise<AgentInboxJob[]> => {
  const max = Math.min(Math.max(limit, 1), 25);
  const pending = await getDb().ref('agent_inbox_pending')
    .orderByChild('availableAt').endAt(now).limitToFirst(max * 3).get();
  if (!pending.exists()) return [];
  const candidates = Object.values<any>(pending.val() || {})
    .sort((a, b) => Number(a.availableAt || 0) - Number(b.availableAt || 0))
    .slice(0, max);
  const claimed: AgentInboxJob[] = [];
  for (const candidate of candidates) {
    const orgId = String(candidate.orgId);
    const jobId = String(candidate.jobId);
    const result = await agentInboxJobRef(orgId, jobId).transaction(current => {
      if (!current) return undefined;
      const recoverable = current.status === 'pending' || current.status === 'failed' ||
        (current.status === 'processing' && Number(current.leaseExpiresAt || 0) <= now);
      if (!recoverable || Number(current.attemptCount || 0) >= 5) return undefined;
      return {
        ...current,
        status: 'processing',
        attemptCount: Number(current.attemptCount || 0) + 1,
        claimedAt: now,
        leaseExpiresAt: now + 2 * 60_000,
        updatedAt: now,
        error: null
      };
    });
    if (result.committed) {
      const job = result.snapshot.val() as AgentInboxJob;
      claimed.push(job);
      await agentInboxIndexRef(orgId, jobId).set({
        orgId, jobId, availableAt: job.leaseExpiresAt, createdAt: job.createdAt
      });
    } else {
      await agentInboxIndexRef(orgId, jobId).remove();
    }
  }
  return claimed;
};

export const finishAgentInboxJob = async (
  job: AgentInboxJob,
  patch: Pick<AgentInboxJob, 'status'> & Partial<Pick<AgentInboxJob, 'routing' | 'responseCommunicationId' | 'responseDraftId' | 'error'>>
): Promise<void> => {
  const now = Date.now();
  await agentInboxJobRef(job.orgId, job.id).update({
    ...JSON.parse(JSON.stringify(patch)),
    updatedAt: now,
    leaseExpiresAt: null
  });
  if (patch.status === 'failed' && job.attemptCount < 5) {
    const delay = Math.min(5 * 60_000, 15_000 * Math.max(job.attemptCount, 1));
    await agentInboxIndexRef(job.orgId, job.id).set({
      orgId: job.orgId, jobId: job.id, availableAt: now + delay, createdAt: job.createdAt
    });
  } else {
    await agentInboxIndexRef(job.orgId, job.id).remove();
  }
};

export const listAgentInboxJobs = async (orgId: string, limit = 100): Promise<AgentInboxJob[]> => {
  const snap = await getDb().ref(`agent_inbox_jobs/${safeRtdbKey(orgId)}`).get();
  if (!snap.exists()) return [];
  return Object.values<AgentInboxJob>(snap.val() || {})
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, Math.min(Math.max(limit, 1), 250));
};

export const replayAgentInboxJob = async (orgId: string, jobId: string): Promise<AgentInboxJob> => {
  const now = Date.now();
  const result = await agentInboxJobRef(orgId, jobId).transaction(current => {
    if (!current || current.orgId !== orgId) return undefined;
    if (!['failed', 'needs_review'].includes(current.status)) return undefined;
    return {
      ...current,
      status: 'pending',
      attemptCount: 0,
      updatedAt: now,
      claimedAt: null,
      leaseExpiresAt: null,
      error: null
    };
  });
  if (!result.committed) throw new Error('Only failed or review-held agent jobs can be replayed');
  const job = result.snapshot.val() as AgentInboxJob;
  await agentInboxIndexRef(orgId, jobId).set({ orgId, jobId, availableAt: now, createdAt: job.createdAt });
  return job;
};

export const listExternalActionReceipts = async (orgId: string, limit = 100): Promise<ExternalActionReceipt[]> => {
  const snap = await getDb().ref(`external_action_receipts/${safeRtdbKey(orgId)}`).get();
  if (!snap.exists()) return [];
  return Object.values<ExternalActionReceipt>(snap.val() || {})
    .sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0))
    .slice(0, Math.min(Math.max(limit, 1), 250));
};

export const listTenantCoachingSessions = async (orgId: string, limit = 100): Promise<CoachingSession[]> => {
  const snap = await getDb().ref(`coaching_sessions/${safeRtdbKey(orgId)}`).get();
  if (!snap.exists()) return [];
  return Object.values<any>(snap.val() || {})
    .flatMap(project => Object.values<CoachingSession>(project || {}))
    .sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0))
    .slice(0, Math.min(Math.max(limit, 1), 250));
};

const conversationContextRef = (orgId: string, threadId: string) =>
  getDb().ref(`conversation_contexts/${safeRtdbKey(orgId)}/${safeRtdbKey(threadId)}`);

export const readConversationContext = async (orgId: string, threadId: string): Promise<ConversationContext | null> => {
  const snap = await conversationContextRef(orgId, threadId).get();
  if (!snap.exists()) return null;
  const context = snap.val() as ConversationContext;
  return Number(context.expiresAt || 0) > Date.now() ? context : null;
};

export const saveConversationContext = async (context: ConversationContext): Promise<void> => {
  if (context.orgId !== context.orgId.trim() || !context.threadId.trim()) throw new Error('Conversation context identity is invalid');
  await conversationContextRef(context.orgId, context.threadId).set(JSON.parse(JSON.stringify(context)));
};

export const readVoiceContextResponse = async (
  orgId: string,
  requestId: string,
  requestHash: string
): Promise<Record<string, unknown> | null> => {
  const ref = getDb().ref(`agent_voice_context_requests/${safeRtdbKey(orgId)}/${safeRtdbKey(requestId)}`);
  const snap = await ref.get();
  if (!snap.exists()) return null;
  const value = snap.val();
  if (value.requestHash !== requestHash) throw new Error('Voice context request id was reused with different content');
  return value.response && typeof value.response === 'object' ? value.response : null;
};

export const saveVoiceContextResponse = async (
  orgId: string,
  requestId: string,
  requestHash: string,
  response: Record<string, unknown>
): Promise<Record<string, unknown>> => {
  const now = Date.now();
  const ref = getDb().ref(`agent_voice_context_requests/${safeRtdbKey(orgId)}/${safeRtdbKey(requestId)}`);
  const result = await ref.transaction(current => {
    if (current?.requestHash && current.requestHash !== requestHash) return undefined;
    if (current?.response) return current;
    return { requestHash, response: JSON.parse(JSON.stringify(response)), createdAt: current?.createdAt || now, expiresAt: now + 10 * 60_000 };
  });
  if (!result.committed) throw new Error('Voice context request id was reused with different content');
  return result.snapshot.val().response as Record<string, unknown>;
};

export const normalizeMailboxConnectionRef = (input: Partial<MailboxConnectionRef>): MailboxConnectionRef => {
  const id = cleanOptionalString(input.id);
  const mailboxAddress = cleanOptionalString(input.mailboxAddress)?.toLowerCase();
  if (!id) throw new Error('Mailbox connection id is required');
  if (!mailboxAddress || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mailboxAddress)) {
    throw new Error('A valid mailbox address is required');
  }
  const provider = ['gmail', 'outlook', 'resend'].includes(String(input.provider))
    ? input.provider as MailboxConnectionRef['provider']
    : undefined;
  if (!provider) throw new Error('Mailbox provider must be gmail, outlook, or resend');
  const state = ['connected', 'degraded', 'expired', 'revoked', 'pending'].includes(String(input.state))
    ? input.state as MailboxConnectionRef['state']
    : 'pending';
  return {
    id, provider, mailboxAddress, state,
    scopes: cleanStringList(input.scopes),
    lastSuccessfulSyncAt: Number.isFinite(Number(input.lastSuccessfulSyncAt)) ? Number(input.lastSuccessfulSyncAt) : undefined,
    updatedAt: Number(input.updatedAt || Date.now())
  };
};

export const normalizeWorkspaceConnectionRef = (input: Partial<WorkspaceConnectionRef>): WorkspaceConnectionRef => {
  const id = cleanOptionalString(input.id);
  const accountEmail = cleanOptionalString(input.accountEmail)?.toLowerCase();
  if (!id) throw new Error('Workspace connection id is required');
  if (!accountEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accountEmail)) {
    throw new Error('A valid Workspace account email is required');
  }
  const state = ['connected', 'degraded', 'expired', 'revoked', 'pending'].includes(String(input.state))
    ? input.state as WorkspaceConnectionRef['state']
    : 'pending';
  return {
    id, provider: 'google', accountEmail, state,
    scopes: cleanStringList(input.scopes),
    updatedAt: Number(input.updatedAt || Date.now())
  };
};

export const listMailboxConnectionRefs = async (orgId: string): Promise<MailboxConnectionRef[]> => {
  const snap = await getDb().ref(`integration_connections/${safeRtdbKey(orgId)}/mailbox`).get();
  return snap.exists() ? Object.values(snap.val() || {}).map(value => normalizeMailboxConnectionRef(value as any)) : [];
};

export const saveMailboxConnectionRef = async (
  orgId: string,
  input: Partial<MailboxConnectionRef>
): Promise<MailboxConnectionRef> => {
  const connection = normalizeMailboxConnectionRef({ ...input, updatedAt: Date.now() });
  await getDb().ref(`integration_connections/${safeRtdbKey(orgId)}/mailbox/${safeRtdbKey(connection.id)}`)
    .set(JSON.parse(JSON.stringify(connection)));
  return connection;
};

export const listWorkspaceConnectionRefs = async (orgId: string): Promise<WorkspaceConnectionRef[]> => {
  const snap = await getDb().ref(`integration_connections/${safeRtdbKey(orgId)}/workspace`).get();
  return snap.exists() ? Object.values(snap.val() || {}).map(value => normalizeWorkspaceConnectionRef(value as any)) : [];
};

export const saveWorkspaceConnectionRef = async (
  orgId: string,
  input: Partial<WorkspaceConnectionRef>
): Promise<WorkspaceConnectionRef> => {
  const connection = normalizeWorkspaceConnectionRef({ ...input, updatedAt: Date.now() });
  await getDb().ref(`integration_connections/${safeRtdbKey(orgId)}/workspace/${safeRtdbKey(connection.id)}`)
    .set(JSON.parse(JSON.stringify(connection)));
  return connection;
};

export const writeWorkspaceCredential = async (
  orgId: string,
  connectionId: string,
  sealedCredential: Record<string, unknown>
): Promise<void> => {
  await getDb().ref(`integration_credentials/${safeRtdbKey(orgId)}/workspace/${safeRtdbKey(connectionId)}`)
    .set({ ...JSON.parse(JSON.stringify(sealedCredential)), updatedAt: Date.now() });
};

export const readWorkspaceCredential = async (
  orgId: string,
  connectionId: string
): Promise<Record<string, unknown> | null> => {
  const snap = await getDb().ref(
    `integration_credentials/${safeRtdbKey(orgId)}/workspace/${safeRtdbKey(connectionId)}`
  ).get();
  if (!snap.exists()) return null;
  const { updatedAt: _updatedAt, ...sealed } = snap.val() || {};
  return sealed;
};

export const registerOAuthStateNonce = async (
  orgId: string,
  nonce: string,
  uid: string,
  expiresAt: number
): Promise<void> => {
  await getDb().ref(`oauth_states/${safeRtdbKey(orgId)}/${safeRtdbKey(nonce)}`)
    .set({ uid, expiresAt, createdAt: Date.now() });
};

export const consumeOAuthStateNonce = async (
  orgId: string,
  nonce: string,
  uid: string
): Promise<boolean> => {
  const now = Date.now();
  const ref = getDb().ref(`oauth_states/${safeRtdbKey(orgId)}/${safeRtdbKey(nonce)}`);
  const result = await ref.transaction(current => {
    if (!current || current.uid !== uid || Number(current.expiresAt) <= now || current.consumedAt) return undefined;
    return { ...current, consumedAt: now };
  });
  return result.committed;
};

const workspaceGrantRef = (orgId: string, projectId: string) =>
  getDb().ref(`workspace_grants/${safeRtdbKey(orgId)}/${safeRtdbKey(projectId)}`);

export const normalizeWorkspaceResourceGrant = (
  projectId: string,
  input: Partial<WorkspaceResourceGrant>
): WorkspaceResourceGrant => {
  const connectionId = cleanOptionalString(input.connectionId);
  if (!projectId.trim()) throw new Error('projectId is required');
  if (!connectionId) throw new Error('connectionId is required');
  const documentId = cleanOptionalString(input.documentId);
  const spreadsheetId = cleanOptionalString(input.spreadsheetId);
  const validId = (value?: string) => !value || /^[A-Za-z0-9_-]{10,200}$/.test(value);
  if (!validId(documentId) || !validId(spreadsheetId)) throw new Error('Invalid Google resource id');
  const sheetRange = cleanOptionalString(input.sheetRange);
  if (sheetRange && (sheetRange.length > 200 || /[\u0000-\u001f]/.test(sheetRange))) throw new Error('Invalid Google Sheet range');
  return {
    projectId: projectId.trim(), connectionId, documentId, spreadsheetId, sheetRange,
    updatedAt: Number.isFinite(Number(input.updatedAt)) ? Number(input.updatedAt) : Date.now()
  };
};

export const readWorkspaceResourceGrant = async (
  orgId: string,
  projectId: string
): Promise<WorkspaceResourceGrant | null> => {
  const snap = await workspaceGrantRef(orgId, projectId).get();
  return snap.exists() ? normalizeWorkspaceResourceGrant(projectId, snap.val()) : null;
};

export const saveWorkspaceResourceGrant = async (
  orgId: string,
  projectId: string,
  input: Partial<WorkspaceResourceGrant>
): Promise<WorkspaceResourceGrant> => {
  const grant = normalizeWorkspaceResourceGrant(projectId, input);
  const connections = await listWorkspaceConnectionRefs(orgId);
  if (!connections.some(connection => connection.id === grant.connectionId && connection.state === 'connected')) {
    throw new Error('Workspace connection is not connected for this tenant');
  }
  await workspaceGrantRef(orgId, projectId).set(JSON.parse(JSON.stringify(grant)));
  return grant;
};

export const claimExternalActionReceipt = async (
  receipt: ExternalActionReceipt
): Promise<{ receipt: ExternalActionReceipt; duplicate: boolean }> => {
  const ref = getDb().ref(
    `external_action_receipts/${safeRtdbKey(receipt.orgId)}/${safeRtdbKey(receipt.idempotencyKey)}`
  );
  let duplicate = false;
  let conflict = false;
  const now = Date.now();
  const result = await ref.transaction(current => {
    if (current?.requestHash && current.requestHash !== receipt.requestHash) {
      conflict = true;
      return undefined;
    }
    if (current?.status === 'completed') {
      duplicate = true;
      return undefined;
    }
    const active = current?.status === 'running' && now - Number(current.startedAt || 0) <= 10 * 60_000;
    if (active) {
      duplicate = true;
      return undefined;
    }
    return { ...receipt, status: 'running', startedAt: now };
  });
  if (conflict) throw new Error('Idempotency key was already used with different action content');
  if (result.committed) return { receipt: result.snapshot.val() as ExternalActionReceipt, duplicate: false };
  const existing = (await ref.get()).val() as ExternalActionReceipt | null;
  if (!existing) throw new Error('External action could not be claimed');
  return { receipt: existing, duplicate };
};

export const finishExternalActionReceipt = async (
  receipt: ExternalActionReceipt,
  result: { status: 'completed' | 'failed'; response?: Record<string, unknown>; error?: string }
): Promise<void> => {
  const ref = getDb().ref(
    `external_action_receipts/${safeRtdbKey(receipt.orgId)}/${safeRtdbKey(receipt.idempotencyKey)}`
  );
  await ref.transaction(current => {
    if (!current || current.id !== receipt.id || current.requestHash !== receipt.requestHash) return undefined;
    return { ...current, ...JSON.parse(JSON.stringify(result)), completedAt: Date.now() };
  });
};

export const upsertCoachingSession = async (
  session: Omit<CoachingSession, 'createdAt' | 'updatedAt'> & Partial<Pick<CoachingSession, 'createdAt' | 'updatedAt'>>
): Promise<CoachingSession> => {
  const ref = getDb().ref(
    `coaching_sessions/${safeRtdbKey(session.orgId)}/${safeRtdbKey(session.projectId)}/${safeRtdbKey(session.id)}`
  );
  const now = Date.now();
  const result = await ref.transaction(current => {
    const next: any = {
      ...(current || {}),
      ...JSON.parse(JSON.stringify(session)),
      createdAt: Number(current?.createdAt || session.createdAt || now),
      updatedAt: now
    };
    if (session.retryStatus !== 'pending') {
      next.nextRetryAt = null;
      next.retryClaimedAt = null;
      next.retryLeaseExpiresAt = null;
    }
    return next;
  });
  if (!result.committed) throw new Error('Coaching session could not be saved');
  const saved = result.snapshot.val() as CoachingSession;
  const index = getDb().ref(`coaching_retry_pending/${safeRtdbKey(`${saved.orgId}:${saved.projectId}:${saved.id}`)}`);
  if (saved.retryStatus === 'pending' && Number(saved.nextRetryAt) > 0) {
    await index.set({
      orgId: saved.orgId, projectId: saved.projectId, sessionId: saved.id,
      availableAt: Number(saved.nextRetryAt), createdAt: saved.createdAt
    });
  } else {
    await index.remove();
  }
  return saved;
};

export const listCoachingSessions = async (
  orgId: string,
  projectId: string,
  limit = 50
): Promise<CoachingSession[]> => {
  const snap = await getDb().ref(
    `coaching_sessions/${safeRtdbKey(orgId)}/${safeRtdbKey(projectId)}`
  ).get();
  return snap.exists()
    ? (Object.values(snap.val() || {}) as CoachingSession[])
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, Math.min(Math.max(limit, 1), 200))
    : [];
};

export const claimDueCoachingRetries = async (now = Date.now(), limit = 10): Promise<CoachingSession[]> => {
  const max = Math.min(Math.max(limit, 1), 25);
  const snap = await getDb().ref('coaching_retry_pending')
    .orderByChild('availableAt').endAt(now).limitToFirst(max * 3).get();
  if (!snap.exists()) return [];
  const candidates = Object.values<any>(snap.val() || {})
    .sort((a, b) => Number(a.availableAt || 0) - Number(b.availableAt || 0))
    .slice(0, max);
  const claimed: CoachingSession[] = [];
  for (const candidate of candidates) {
    const orgId = String(candidate.orgId);
    const projectId = String(candidate.projectId);
    const sessionId = String(candidate.sessionId);
    const index = getDb().ref(`coaching_retry_pending/${safeRtdbKey(`${orgId}:${projectId}:${sessionId}`)}`);
    const ref = getDb().ref(
      `coaching_sessions/${safeRtdbKey(orgId)}/${safeRtdbKey(projectId)}/${safeRtdbKey(sessionId)}`
    );
    const result = await ref.transaction(current => {
      if (!current) return undefined;
      const duePending = current.retryStatus === 'pending' && Number(current.nextRetryAt || 0) <= now;
      const staleProcessing = current.retryStatus === 'processing' && Number(current.retryLeaseExpiresAt || 0) <= now;
      if (!duePending && !staleProcessing) return undefined;
      return {
        ...current, retryStatus: 'processing', retryClaimedAt: now,
        retryLeaseExpiresAt: now + 2 * 60_000, updatedAt: now
      };
    });
    if (result.committed) {
      const session = result.snapshot.val() as CoachingSession;
      claimed.push(session);
      await index.set({ orgId, projectId, sessionId, availableAt: session.retryLeaseExpiresAt, createdAt: session.createdAt });
    } else {
      await index.remove();
    }
  }
  return claimed;
};

export const releaseCoachingRetry = async (session: CoachingSession, error: string): Promise<void> => {
  const ref = getDb().ref(
    `coaching_sessions/${safeRtdbKey(session.orgId)}/${safeRtdbKey(session.projectId)}/${safeRtdbKey(session.id)}`
  );
  const result = await ref.transaction(current => {
    if (!current || current.retryStatus !== 'processing' || current.retryClaimedAt !== session.retryClaimedAt) return undefined;
    return {
      ...current, retryStatus: 'pending', nextRetryAt: Date.now() + 5 * 60_000,
      retryClaimedAt: null, retryLeaseExpiresAt: null,
      failureReason: String(error).slice(0, 1_000), updatedAt: Date.now()
    };
  });
  if (result.committed) {
    const saved = result.snapshot.val() as CoachingSession;
    await getDb().ref(`coaching_retry_pending/${safeRtdbKey(`${saved.orgId}:${saved.projectId}:${saved.id}`)}`).set({
      orgId: saved.orgId, projectId: saved.projectId, sessionId: saved.id,
      availableAt: saved.nextRetryAt, createdAt: saved.createdAt
    });
  }
};

const cleanOptionalString = (value: unknown): string | undefined => {
  const clean = typeof value === 'string' ? value.trim() : '';
  return clean || undefined;
};

const normalizeScheduleInput = (value: unknown): Record<string, unknown> | undefined => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
};

const normalizeTimeZone = (value: unknown): string => {
  const timezone = String(value || '').trim() || 'Australia/Brisbane';
  try {
    new Intl.DateTimeFormat('en-AU', { timeZone: timezone }).format(0);
    return timezone;
  } catch {
    return 'Australia/Brisbane';
  }
};

const normalizeScheduleRecurrence = (
  recurrence: TenantScheduleInput['recurrence'],
  intervalMinutes: number
): TenantSchedule['recurrence'] => {
  if (recurrence?.kind === 'daily') {
    const localTime = /^([01]\d|2[0-3]):[0-5]\d$/.test(recurrence.localTime)
      ? recurrence.localTime
      : '09:00';
    return { kind: 'daily', localTime };
  }
  return { kind: 'interval', intervalMinutes };
};

const zonedParts = (at: number, timezone: string): Record<string, number> => {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(at));
  return Object.fromEntries(parts
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]));
};

const zonedDateTimeToUtc = (
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timezone: string
): number => {
  const desired = Date.UTC(year, month - 1, day, hour, minute, 0);
  let candidate = desired;
  for (let i = 0; i < 4; i++) {
    const actual = zonedParts(candidate, timezone);
    const represented = Date.UTC(actual.year, actual.month - 1, actual.day, actual.hour, actual.minute, actual.second);
    const correction = desired - represented;
    if (correction === 0) break;
    candidate += correction;
  }
  return candidate;
};

/** Returns the first local daily occurrence strictly after `after`. */
export const nextDailyScheduleOccurrence = (after: number, localTime: string, timezone: string): number => {
  const safeTimezone = normalizeTimeZone(timezone);
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(localTime);
  const hour = Number(match?.[1] ?? 9);
  const minute = Number(match?.[2] ?? 0);
  const local = zonedParts(after, safeTimezone);
  let candidate = zonedDateTimeToUtc(local.year, local.month, local.day, hour, minute, safeTimezone);
  if (candidate <= after) {
    const nextDate = new Date(Date.UTC(local.year, local.month - 1, local.day + 1));
    candidate = zonedDateTimeToUtc(
      nextDate.getUTCFullYear(), nextDate.getUTCMonth() + 1, nextDate.getUTCDate(),
      hour, minute, safeTimezone
    );
  }
  return candidate;
};

export const deleteTenantSchedule = async (orgId: string, scheduleId: string): Promise<void> => {
  await scheduleRef(orgId, scheduleId).remove();
};

export const listDueSchedules = async (now = Date.now()): Promise<TenantSchedule[]> => {
  const snap = await getDb().ref('schedules').get();
  if (!snap.exists()) return [];
  const due: TenantSchedule[] = [];
  for (const schedules of Object.values(snap.val() || {}) as any[]) {
    for (const schedule of Object.values(schedules || {}) as TenantSchedule[]) {
      if (schedule.enabled && Number(schedule.nextRunAt) <= now) due.push(schedule);
    }
  }
  return due.sort((a, b) => a.nextRunAt - b.nextRunAt);
};

export const claimScheduleRun = async (
  schedule: TenantSchedule,
  scheduledFor: number,
  claimId = randomUUID()
): Promise<ScheduleRun | null> => {
  const runKey = String(scheduledFor);
  const ref = getDb().ref(
    `schedule_runs/${safeRtdbKey(schedule.orgId)}/${safeRtdbKey(schedule.id)}/${runKey}`
  );
  const startedAt = Date.now();
  const result = await ref.transaction(current => {
    const stale = current?.status === 'running' && startedAt - Number(current.startedAt || 0) > 10 * 60 * 1000;
    // Completed occurrences are immutable. Failed occurrences and expired
    // leases may be claimed again without advancing the schedule or cursor.
    if (current && current.status !== 'failed' && !stale) return undefined;
    return {
      ...(current || {}),
      id: `${schedule.id}:${scheduledFor}`,
      orgId: schedule.orgId,
      scheduleId: schedule.id,
      activity: schedule.activity,
      ...(schedule.activity === 'flow_start' ? {
        projectId: schedule.projectId,
        ...(schedule.flowId ? { flowId: schedule.flowId } : {})
      } : {}),
      scheduledFor,
      status: 'running',
      claimId,
      startedAt,
      completedAt: null,
      error: null,
      attempt: Number(current?.attempt || 0) + 1
    } satisfies ScheduleRun;
  });
  return result.committed ? result.snapshot.val() as ScheduleRun : null;
};

export const finishScheduleRun = async (
  run: ScheduleRun,
  patch: Partial<ScheduleRun> & Pick<ScheduleRun, 'status'>
): Promise<void> => {
  const ref = getDb().ref(
    `schedule_runs/${safeRtdbKey(run.orgId)}/${safeRtdbKey(run.scheduleId)}/${run.scheduledFor}`
  );
  await ref.transaction(current => {
    if (!current || current.claimId !== run.claimId) return undefined;
    return { ...current, ...JSON.parse(JSON.stringify(patch)), completedAt: Date.now() };
  });
};

export const advanceTenantSchedule = async (
  schedule: TenantSchedule,
  from: number,
  now = Date.now()
): Promise<void> => {
  await scheduleRef(schedule.orgId, schedule.id).transaction(current => {
    if (!current) return undefined;
    const recurrence = current.recurrence || schedule.recurrence || {
      kind: 'interval', intervalMinutes: Math.max(5, Number(current.intervalMinutes || schedule.intervalMinutes))
    };
    const misfirePolicy = current.misfirePolicy || schedule.misfirePolicy || 'run_once';
    let nextRunAt: number;
    if (recurrence.kind === 'daily') {
      nextRunAt = nextDailyScheduleOccurrence(from, recurrence.localTime, current.timezone || schedule.timezone);
      if (misfirePolicy !== 'catch_up' && nextRunAt <= now) {
        nextRunAt = nextDailyScheduleOccurrence(now, recurrence.localTime, current.timezone || schedule.timezone);
      }
    } else {
      const interval = Math.max(5, Number(recurrence.intervalMinutes || schedule.intervalMinutes)) * 60_000;
      nextRunAt = Math.max(Number(current.nextRunAt || from), from) + interval;
      if (misfirePolicy !== 'catch_up') while (nextRunAt <= now) nextRunAt += interval;
    }
    return { ...current, nextRunAt, updatedAt: Date.now() };
  });
};

export const readCommunicationCursor = async (orgId: string, connectionId: string): Promise<string | undefined> => {
  const snap = await getDb().ref(
    `communication_cursors/${safeRtdbKey(orgId)}/${safeRtdbKey(connectionId)}/cursor`
  ).get();
  return snap.exists() ? String(snap.val()) : undefined;
};

export const writeCommunicationCursor = async (
  orgId: string,
  connectionId: string,
  cursor: string
): Promise<void> => {
  await getDb().ref(`communication_cursors/${safeRtdbKey(orgId)}/${safeRtdbKey(connectionId)}`)
    .set({ cursor, updatedAt: Date.now() });
};
