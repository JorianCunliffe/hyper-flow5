import type { AskField, ProjectData } from '../../types.js';

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const FIELD_TYPES = new Set<AskField['type']>(['string', 'boolean', 'number', 'date', 'file']);

const readPath = (value: unknown, path: string): unknown => {
  const parts = path.split('.').map(part => part.trim()).filter(Boolean);
  let current: any = value;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[part];
  }
  return current;
};

const labelFor = (name: string): string =>
  name.replace(/[_-]+/g, ' ').replace(/\b\w/g, char => char.toUpperCase());

const fieldFromUnknown = (raw: unknown, index: number): AskField => {
  if (typeof raw === 'string') {
    const name = raw.trim();
    if (!FIELD_NAME.test(name)) throw new Error(`Dynamic Ask field ${index + 1} has an invalid name`);
    return { name, label: labelFor(name), type: 'string', required: true };
  }
  if (!raw || typeof raw !== 'object') throw new Error(`Dynamic Ask field ${index + 1} must be a string or object`);

  const candidate = raw as Record<string, unknown>;
  const name = typeof candidate.name === 'string' ? candidate.name.trim() : '';
  if (!FIELD_NAME.test(name)) throw new Error(`Dynamic Ask field ${index + 1} has an invalid name`);
  const type = FIELD_TYPES.has(candidate.type as AskField['type'])
    ? candidate.type as AskField['type']
    : 'string';
  const options = Array.isArray(candidate.options)
    ? candidate.options.map(String).map(item => item.trim()).filter(Boolean)
    : undefined;

  return {
    name,
    label: typeof candidate.label === 'string' && candidate.label.trim() ? candidate.label.trim() : labelFor(name),
    type,
    required: candidate.required !== false,
    ...(options?.length ? { options } : {})
  };
};

/**
 * Resolves a Human Ask schema when its hold is raised. The returned array is a
 * fresh snapshot, which freezes the contract for the lifetime of that Ask.
 */
export const resolveAskFields = (
  projectData: ProjectData | undefined,
  staticFields?: AskField[],
  fieldsSource?: string
): AskField[] | undefined => {
  const source = fieldsSource?.trim();
  if (!source) return staticFields?.map(field => ({ ...field, options: field.options ? [...field.options] : undefined }));

  const raw = readPath(projectData || {}, source);
  if (!Array.isArray(raw)) throw new Error(`Dynamic Ask fields source "${source}" must resolve to an array`);
  if (raw.length === 0) return [];
  const fields = raw.map(fieldFromUnknown);
  const seen = new Set<string>();
  for (const field of fields) {
    if (seen.has(field.name)) throw new Error(`Dynamic Ask fields source "${source}" contains duplicate field "${field.name}"`);
    seen.add(field.name);
  }
  return fields;
};
