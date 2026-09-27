/** RTDB removes empty containers/nulls and may return sparse arrays as objects.
 * Keep structural metadata on the stored record, never in application JSON.
 * Legacy records remain unchanged: a missing value is not evidence of an empty one.
 */
const META = '__hyperflowJsonShapeV1';
type Shape = [string[], 'array' | 'object' | 'null', number?];
export function encodeRtdbRecord<T>(value: T): T {
  if (value == null) return value;
  const clean = JSON.parse(JSON.stringify(value));
  if (typeof clean !== 'object' || Array.isArray(clean)) throw new Error('RTDB record must be an object');
  if (Object.hasOwn(clean, META)) throw new Error('Reserved RTDB JSON metadata key');
  const shapes: Shape[] = [];
  function visit(item: any, path: string[]) {
    if (item === null) { shapes.push([path, 'null']); return; }
    if (Array.isArray(item)) shapes.push([path, 'array', item.length]);
    else if (typeof item === 'object' && !Object.keys(item).length) shapes.push([path, 'object']);
    if (item && typeof item === 'object') for (const [key, child] of Object.entries(item)) visit(child, [...path, key]);
  }
  for (const [key, item] of Object.entries(clean)) visit(item, [key]);
  clean[META] = JSON.stringify(shapes);
  return clean;
}

export function decodeRtdbRecord<T>(value: T): T {
  if (!value || typeof value !== 'object' || !Object.hasOwn(value, META)) return value;
  const result = JSON.parse(JSON.stringify(value));
  const shapes: Shape[] = JSON.parse(result[META]);
  delete result[META];
  if (!Array.isArray(shapes)) throw new Error('Invalid RTDB JSON metadata');
  let restoredSlots = 0;
  for (const shape of shapes) {
    const [path, kind, length] = shape;
    if (!Array.isArray(path) || !path.length || path.length > 128 || !path.every(k => typeof k === 'string') || !['array', 'object', 'null'].includes(kind)) throw new Error('Invalid RTDB JSON shape');
    let parent = result;
    for (const key of path.slice(0, -1)) {
      if (!Object.hasOwn(parent, key) || !parent[key] || typeof parent[key] !== 'object') Object.defineProperty(parent, key, { value: {}, writable: true, enumerable: true, configurable: true });
      parent = parent[key];
    }
    const key = path[path.length - 1];
    let restored: unknown;
    if (kind === 'array') {
      if (!Number.isSafeInteger(length) || length! < 0 || (restoredSlots += length!) > 1_000_000) throw new Error('Invalid RTDB JSON array length');
      const stored = Object.hasOwn(parent, key) ? parent[key] : undefined;
      restored = Array.from({ length: length! }, (_, index) => stored && Object.hasOwn(stored, index) ? stored[index] : null);
    } else restored = kind === 'null' ? null : {};
    Object.defineProperty(parent, key, { value: restored, writable: true, enumerable: true, configurable: true });
  }
  return result;
}

/** Projects are independently writable records; keep each one's metadata local. */
function mapWorkspace(value: any, map: (record: any) => any): any {
  if (!value?.projects) return value;
  const projects = Array.isArray(value.projects) ? value.projects.map(map)
    : Object.fromEntries(Object.entries(value.projects).map(([key, record]) => [key, map(record)]));
  return { ...value, projects };
}
export const encodeWorkspace = (value: any): any => value == null ? value : mapWorkspace(JSON.parse(JSON.stringify(value)), encodeRtdbRecord);
export const decodeWorkspace = (value: any): any => mapWorkspace(value, decodeRtdbRecord);
