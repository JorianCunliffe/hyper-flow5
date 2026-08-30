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
 * any project shared by the browser and server changed after the browser
 * rendered the snapshot being saved. A matching tenant dataRevision is checked
 * by the caller, so a local-only project is an intentional create and a
 * server-only project omitted locally is an intentional delete.
 */
export const projectCollectionsShareRevisions = (
  remoteValue: unknown,
  localValue: unknown
): boolean => {
  const remote = toProjects(remoteValue);
  const local = toProjects(localValue);

  const remoteById = new Map<string, RevisionedProject>();
  for (const project of remote) {
    const key = idKey(project.id);
    if (!key || remoteById.has(key)) return false;
    remoteById.set(key, project);
  }

  const localIds = new Set<string>();
  return local.every(project => {
    const key = idKey(project.id);
    if (!key || localIds.has(key)) return false;
    localIds.add(key);
    const stored = remoteById.get(key);
    return !stored || Number(stored.revision || 0) === Number(project.revision || 0);
  });
};
