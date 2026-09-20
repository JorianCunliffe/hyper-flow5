import { HttpCommunicationsClient } from "./communications/client.js";
import { runtimeDatabase } from "./runtimeDatabase.js";
import { listTenantProjects } from "./serverStore.js";
import { CommitmentError } from "./commitments/model.js";
import { collectReviewSources } from "./reviewSources.js";
export async function handleOperationalReview(
  input: Record<string, any>,
  member: { orgId: string; uid: string },
) {
  if(input.operation && !['work','start','read','advance','respond','action'].includes(input.operation)) throw new CommitmentError(400,'Unknown review operation');
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
  const client = new HttpCommunicationsClient();
  const asserted = {
    initiator_id: member.uid,
    allowed_project_ids: projects.map(p=>p.id),
    ...(input.projectId ? {external_project_id:input.projectId} : {}),
  };
  let sourceSyncError = false;
  if (!input.operation || input.operation === 'start') {
    try {
      const identity = await client.operationalReview(member.orgId,'source_scope',asserted);
      if (!identity.owner?.startsWith('person:')) throw new Error('Review owner binding required');
      const permitted = identity.scope.external_project_id ? [identity.scope.external_project_id] : identity.scope.allowed_project_ids || [];
      const snapshots = await collectReviewSources(member.orgId,permitted.filter((id:string)=>projects.some(p=>p.id===id)));
      if(snapshots.length) await client.operationalReview(member.orgId,'sources',{...asserted,snapshots});
    } catch {sourceSyncError = true;}
  }
  const result = await client.operationalReview(
    member.orgId,
    input.operation || "start",
    {
      ...body,
      initiator_id: member.uid,
      allowed_project_ids: projects.map((p) => p.id),
      ...(input.projectId ? { external_project_id: input.projectId } : {}),
    },
  );
  if (sourceSyncError && result.briefing) {
    result.briefing.text = 'Live source synchronization is unavailable; calendar and workflow information may be incomplete. ' + result.briefing.text;
  }
  return result;
}
