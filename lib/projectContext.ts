import type { AgentInboxJob, TriageItem } from "../types.js";
export const inProjectContext = (
  record: { projectId?: string | null },
  projectId: string | null | undefined,
) => !projectId || record.projectId === projectId;
export function jobInProjectContext(
  job: AgentInboxJob,
  projectId: string | null | undefined,
  items: TriageItem[],
): boolean {
  if (!projectId) return true;
  const resolved =
    job.routing?.projectId ||
    job.trustedProjectId ||
    items.find((item) => item.communicationId === job.communicationId)
      ?.projectId;
  return resolved === projectId;
}
