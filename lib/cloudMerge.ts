/** Three-way merge: independent edits survive callbacks; competing edits fail visibly. */
export class CloudEditConflict extends Error {
  constructor(readonly path: string) { super(`Cloud and local edits conflict at ${path}. Your local edits have been kept; resolve the conflict before saving.`); }
}
export interface CloudConflictDetail { path: string; base: unknown; local: unknown; remote: unknown }
export type CloudConflictChoice = 'local' | 'remote';
type ResolveConflict = (detail: CloudConflictDetail) => CloudConflictChoice;
const metadata = new Set(['revision', 'dataRevision', 'updatedAt', 'lastUpdated']);
const empty = (value: unknown) => value == null || (typeof value === 'object' && Object.keys(value).length === 0);
export const sameCloudValue = (a: any, b: any): boolean => {
  if (empty(a) && empty(b)) return true;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((value, index) => sameCloudValue(value, b[index]));
  if (record(a) && record(b)) return [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter(key => !metadata.has(key)).every(key => sameCloudValue(a[key], b[key]));
  return a === b;
};
const same = sameCloudValue;
const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyed = (value: any) => Array.isArray(value) && value.every(row => record(row) && ['string', 'number'].includes(typeof row.id)) && new Set(value.map(row => String(row.id))).size === value.length;
export const mergeCloudEdits = <T>(base: T, local: T, remote: T, path = 'workspace', resolve?: ResolveConflict): T => {
  if (same(local, remote) || same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (record(base) && record(local) && record(remote)) {
    const output: Record<string, any> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new CloudEditConflict(`${path}.${key}`);
      // Revisions belong to storage. Timestamps are merge metadata, not user edits.
      const value = ['revision', 'dataRevision', 'updatedAt', 'lastUpdated'].includes(key)
        ? remote[key] : mergeCloudEdits(base[key], local[key], remote[key], `${path}.${key}`, resolve);
      if (value !== undefined) output[key] = value;
    }
    return output as T;
  }
  if (keyed(base) && keyed(local) && keyed(remote)) {
    const b = new Map((base as any[]).map(row => [String(row.id), row]));
    const l = new Map((local as any[]).map(row => [String(row.id), row]));
    const r = new Map((remote as any[]).map(row => [String(row.id), row]));
    // Preserve remote order and append locally added IDs. Do not reorder graph nodes.
    return [...new Set([...r.keys(), ...l.keys()])].map(id => mergeCloudEdits(b.get(id), l.get(id), r.get(id), `${path}[${id}]`, resolve)).filter(row => row !== undefined) as T;
  }
  if (resolve) return resolve({ path, base, local, remote }) === 'local' ? local : remote;
  throw new CloudEditConflict(path);
};

export const inspectCloudMerge = <T>(base: T, local: T, remote: T) => {
  const conflicts: CloudConflictDetail[] = [];
  const merged = mergeCloudEdits(base, local, remote, 'workspace', detail => {
    conflicts.push(detail);
    return 'local';
  });
  return { merged, conflicts };
};

/** Previews never expose credentials embedded in a node template or URL. */
export const cloudConflictPreview = (value: unknown): string => {
  if (value === undefined) return '(deleted / absent)';
  const redact = (item: unknown): unknown => {
    if (typeof item === 'string') {
      try { return redact(JSON.parse(item)); } catch { /* ordinary text */ }
      return item.replace(/([?&](?:zapikey|api_?key|token|secret|password|access_token)=)[^&\s"<>]+/gi, '$1[redacted]');
    }
    if (Array.isArray(item)) return item.map(redact);
    if (record(item)) return Object.fromEntries(Object.entries(item).map(([key, val]) => [key,
      /secret|password|token|api.?key|authorization|cookie/i.test(key) ? '[redacted]' : redact(val)]));
    return item;
  };
  return JSON.stringify(redact(value), null, 2).slice(0, 4000);
};
