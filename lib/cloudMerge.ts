/** Three-way merge: independent edits survive callbacks; competing edits fail visibly. */
export class CloudEditConflict extends Error {
  constructor(readonly path: string) { super(`Cloud and local edits conflict at ${path}. Your local edits have been kept; resolve the conflict before saving.`); }
}
const empty = (value: unknown) => value == null || (Array.isArray(value) && value.length === 0);
const same = (a: unknown, b: unknown) => (empty(a) && empty(b)) || JSON.stringify(a) === JSON.stringify(b);
const record = (value: any): value is Record<string, any> => value !== null && typeof value === 'object' && !Array.isArray(value);
const keyed = (value: any) => Array.isArray(value) && value.every(row => record(row) && ['string', 'number'].includes(typeof row.id)) && new Set(value.map(row => String(row.id))).size === value.length;
export const mergeCloudEdits = <T>(base: T, local: T, remote: T, path = 'workspace'): T => {
  if (same(local, remote) || same(local, base)) return remote;
  if (same(remote, base)) return local;
  if (record(base) && record(local) && record(remote)) {
    const output: Record<string, any> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new CloudEditConflict(`${path}.${key}`);
      // Revisions belong to storage. Timestamps are merge metadata, not user edits.
      const value = ['revision', 'dataRevision', 'updatedAt', 'lastUpdated'].includes(key)
        ? remote[key] : mergeCloudEdits(base[key], local[key], remote[key], `${path}.${key}`);
      if (value !== undefined) output[key] = value;
    }
    return output as T;
  }
  if (keyed(base) && keyed(local) && keyed(remote)) {
    const b = new Map((base as any[]).map(row => [String(row.id), row]));
    const l = new Map((local as any[]).map(row => [String(row.id), row]));
    const r = new Map((remote as any[]).map(row => [String(row.id), row]));
    // Preserve remote order and append locally added IDs. Do not reorder graph nodes.
    return [...new Set([...r.keys(), ...l.keys()])].map(id => mergeCloudEdits(b.get(id), l.get(id), r.get(id), `${path}[${id}]`)).filter(row => row !== undefined) as T;
  }
  throw new CloudEditConflict(path);
};
