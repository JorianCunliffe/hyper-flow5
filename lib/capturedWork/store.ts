import { createHash } from 'node:crypto';
import { runtimeDatabase } from '../runtimeDatabase.js';
import { CaptureError, captureFields, text, transition, type CapturedWorkItem } from './model.js';
const key = (value: string) => encodeURIComponent(value).replace(/\./g, '%2E');
const path = (orgId: string, userId: string) => `captured_work_items/${key(orgId)}/${key(userId)}`;
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const captureIdentity = (org: string, user: string, idempotencyKey: string) => `capture_${hash([org, user, idempotencyKey]).slice(0, 40)}`;
export async function listCaptures(orgId: string, userId: string): Promise<CapturedWorkItem[]> {
  const db = await runtimeDatabase();
  const snapshot = await db.ref(path(orgId, userId)).get();
  return Object.values(snapshot.val() || {});
}
export async function readCapture(orgId: string, userId: string, id: string): Promise<CapturedWorkItem | null> {
  const db = await runtimeDatabase();
  return (await db.ref(`${path(orgId, userId)}/${key(id)}`).get()).val();
}
async function transact(orgId: string, userId: string, id: string, update: (item: CapturedWorkItem | null) => CapturedWorkItem): Promise<CapturedWorkItem> {
  const db = await runtimeDatabase();
  const ref = db.ref(`${path(orgId, userId)}/${key(id)}`);
  const listener = () => {};
  try {
    // Warm transaction cache so a missing value is distinguishable from a cold cache.
    await new Promise<void>((resolve, reject) => { ref.on('value', listener, reject); ref.once('value', () => resolve(), reject); });
    const result = await ref.transaction(item => JSON.parse(JSON.stringify(update(item))), undefined, false);
    if (!result.committed) throw new CaptureError(409, 'Capture was changed concurrently');
    return result.snapshot.val();
  } finally { ref.off('value', listener); }
}
export async function captureWorkItem(orgId: string, userId: string, body: any): Promise<CapturedWorkItem> {
  const idempotencyKey = text(body.idempotencyKey, 'idempotencyKey', 500);
  const content = { rawText: text(body.rawText, 'rawText', 8000), ...captureFields(body, true) };
  const id = captureIdentity(orgId, userId, idempotencyKey);
  const fingerprint = hash(content);
  return transact(orgId, userId, id, current => replayOrCreate(current, { ...content, id, orgId, capturedForUserId: userId, status: 'captured', captureFingerprint: fingerprint, createdAt: Date.now(), updatedAt: Date.now(), version: 1 }));
}
export function replayOrCreate(current: CapturedWorkItem | null, proposed: CapturedWorkItem): CapturedWorkItem {
  if (!current) return proposed;
  if (current.captureFingerprint !== proposed.captureFingerprint) throw new CaptureError(409, 'Idempotency key was already used for different content');
  return current;
}

export async function mutateCapture(orgId: string, userId: string, id: string, operation: string, body: any): Promise<CapturedWorkItem> {
  return transact(orgId, userId, id, current => {
    if (!current) throw new CaptureError(404, 'Captured item not found');
    return transition(current, operation, body);
  });
}
