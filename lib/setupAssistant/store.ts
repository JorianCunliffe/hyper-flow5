import { randomUUID } from 'node:crypto';
import { runtimeDatabase } from '../runtimeDatabase.js';
import { encodeRtdbRecord, decodeRtdbRecord } from '../rtdbJson.js';
import { fail } from './safety.js';
import type { SetupSession } from './types.js';
const key = (v: string) => encodeURIComponent(v).replace(/\./g, '%2E');
const path = (org: string, uid: string) => `setup_assistant_sessions/${key(org)}/${key(uid)}`;
export const createSessionStore = (database = runtimeDatabase) => ({
  async list(org: string, uid: string): Promise<SetupSession[]> {
    const snap = await (await database()).ref(path(org, uid)).get();
    return Object.values(snap.val() || {}).map(decodeRtdbRecord) as SetupSession[];
  },
  async get(org: string, uid: string, id: string): Promise<SetupSession | null> {
    const snap = await (await database()).ref(`${path(org, uid)}/${key(id)}`).get();
    return snap.exists() ? decodeRtdbRecord(snap.val()) : null;
  },
  async create(session: SetupSession) {
    const reference = (await database()).ref(path(session.orgId, session.actor));
    const result = await reference.transaction(raw => {
      const rows = raw || {};
      if (Object.keys(rows).length >= 100) fail(409, 'Archive old setup sessions before creating more (100 session limit).');
      rows[key(session.id)] = encodeRtdbRecord(session); return rows;
    }, undefined, false);
    if (!result.committed) fail(409, 'Setup session creation was not saved.');
    return session;
  },
  async update(org: string, uid: string, id: string, fn: (s: SetupSession) => SetupSession) {
    const reference = (await database()).ref(`${path(org, uid)}/${key(id)}`);
    // A cold RTDB transaction starts with an empty local cache. Keep a listener
    // attached until commit so an existing session is not mistaken for missing.
    const keepCurrent = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        reference.on('value', keepCurrent, reject);
        reference.once('value', () => resolve(), reject);
      });
      const result = await reference.transaction(raw => {
      if (!raw) fail(404, 'Setup session not found.');
      const next = fn(decodeRtdbRecord(raw));
      next.revision++; next.updatedAt = Date.now();
      if (Buffer.byteLength(JSON.stringify(next)) > 750000) fail(413, 'Setup session exceeds 750 KB. Start a new session.');
      return encodeRtdbRecord(next);
    }, undefined, false);
    if (!result.committed) fail(409, 'Setup session changed. Reload.');
      return decodeRtdbRecord(result.snapshot.val()) as SetupSession;
    } finally {
      reference.off('value', keepCurrent);
    }
  },
  async remove(org: string, uid: string, id: string) { await (await database()).ref(`${path(org, uid)}/${key(id)}`).remove(); },
  id: () => `setup_${randomUUID().replace(/-/g, '')}`,
});
export const sessionStore = createSessionStore();
