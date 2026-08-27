type RevisionedProject = {
  id?: unknown;
  revision?: unknown;
};

const toProjects = (value: unknown): RevisionedProject[] =>
  Array.isArray(value)
    ? value.filter(Boolean)
    : value && typeof value === 'object'
      ? Object.values(value as Record<string, RevisionedProject>).filter(Boolean)
      : [];

const idKey = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/**
 * Browser saves replace the tenant's project collection. Refuse that write if
 * any project changed after the browser rendered the snapshot being saved.
 */
export const projectCollectionsShareRevisions = (
  remoteValue: unknown,
  localValue: unknown
): boolean => {
  const remote = toProjects(remoteValue);
  const local = toProjects(localValue);
  if (remote.length !== local.length) return false;

  const remoteById = new Map<string, RevisionedProject>();
  for (const project of remote) {
    const key = idKey(project.id);
    if (!key || remoteById.has(key)) return false;
    remoteById.set(key, project);
  }

  return local.every(project => {
    const key = idKey(project.id);
    if (!key) return false;
    const stored = remoteById.get(key);
    return Boolean(stored)
      && Number(stored?.revision || 0) === Number(project.revision || 0);
  });
};
