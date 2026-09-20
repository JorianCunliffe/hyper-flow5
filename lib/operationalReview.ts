import { HttpCommunicationsClient } from "./communications/client.js";
import { runtimeDatabase } from "./runtimeDatabase.js";
import { listTenantProjects } from "./serverStore.js";
import { CommitmentError } from "./commitments/model.js";
export async function handleOperationalReview(
  input: Record<string, any>,
  member: { orgId: string; uid: string },
) {
  const projects = await listTenantProjects(member.orgId);
  if (input.projectId && !projects.some((p) => p.id === input.projectId))
    throw new CommitmentError(403, "Project unavailable");
  if (input.operation === "work") {
    const root = await (
      await runtimeDatabase()
    )
      .ref(
        `review_work/${encodeURIComponent(member.orgId).replace(/\./g, "%2E")}`,
      )
      .get();
    return {
      items: Object.values(root.val() || {})
        .filter(
          (r: any) =>
            r.uid === member.uid &&
            (!input.projectId || r.project_id === input.projectId) &&
            projects.some((p) => p.id === r.project_id),
        )
        .map((r: any) => ({
          ...r,
          due: r.scheduled_at && Date.parse(r.scheduled_at) <= Date.now(),
        })),
    };
  }
  const allowed = [
    "session_id",
    "request_id",
    "expected_revision",
    "review_item_id",
    "utterance",
    "intent",
    "details",
    "confidence",
    "instruction",
    "proposal",
    "authorized",
    "timezone",
    "replaces_action_id",
  ];
  const body = Object.fromEntries(
    allowed.filter((k) => input[k] !== undefined).map((k) => [k, input[k]]),
  );
  return new HttpCommunicationsClient().operationalReview(
    member.orgId,
    input.operation || "start",
    {
      ...body,
      initiator_id: member.uid,
      allowed_project_ids: projects.map((p) => p.id),
      ...(input.projectId ? { external_project_id: input.projectId } : {}),
    },
  );
}
