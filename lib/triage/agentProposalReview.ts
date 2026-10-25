import {
  claimTriageAgentProposal,
  finishTriageAgentProposal,
  findProject,
  writeProject,
} from "../serverStore.js";
import { appendGrantedGoogleSheet } from "../integrations/googleWorkspace.js";
import { advanceScheduledServerFlow } from "../serverFlow.js";
import { COACHING_TRANSIENT_KEYS } from "../projectTemplates.js";
import { TenantControlError } from "../tenantControl/model.js";
/** Shared by the authenticated triage UI and verified briefing decisions. */
export async function reviewAgentProposal(
  member: { orgId: string; uid: string; role?: string },
  id: string,
  decision: "approve" | "reject",
  actor: string,
  expectedFingerprint?: string,
) {
  if (decision === "reject") {
    const item = await finishTriageAgentProposal(
      member.orgId,
      id,
      "rejected",
      actor,
      undefined,
      expectedFingerprint,
    );
    if (!item)
      throw new TenantControlError(
        409,
        "Agent proposal is not awaiting review",
      );
    return { item };
  }
  const claimed = await claimTriageAgentProposal(
    member.orgId,
    id,
    actor,
    expectedFingerprint,
  );
  if (!claimed?.agentProposal)
    throw new TenantControlError(409, "Agent proposal is not awaiting review");
  const proposal = claimed.agentProposal;
  try {
    const located = await findProject(member.orgId, proposal.projectId);
    if (
      !located ||
      located.project.projectData?.project_template !== "daily_coaching"
    )
      throw new Error(
        "Agent proposal is not linked to a Daily Coaching project",
      );
    if (proposal.kind === "request_coaching_call") {
      const scheduledFor = proposal.requestedAt;
      const outcome = await advanceScheduledServerFlow(
        member.orgId,
        proposal.projectId,
        {
          scheduleId: `agent_request:${id}`,
          scheduleRunId: `agent_request:${id}:${scheduledFor}`,
          scheduledFor,
          flowId: "coaching",
          resetPolicy: "flow",
          clearProjectDataKeys: COACHING_TRANSIENT_KEYS,
          input: {
            coaching_trigger: "approved_agent_request",
            coaching_request_communication_id: claimed.communicationId,
          },
        },
      );
      if (!outcome.ok)
        throw new Error(outcome.reason || "Coaching call could not be started");
    } else {
      const value = String(proposal.value || "").trim();
      if (!value) throw new Error("Coaching proposal has no value");
      const commitment = proposal.kind === "coaching_commitment",
        when = new Date(proposal.requestedAt).toISOString();
      await appendGrantedGoogleSheet(
        member.orgId,
        proposal.projectId,
        `agent-proposal:${member.orgId}:${id}:sheet:v1`,
        [
          [
            when,
            "",
            "",
            commitment ? value : "",
            commitment ? "" : value,
            proposal.summary,
            proposal.confidence,
          ],
        ],
      );
      const key = commitment ? "coaching_commitments" : "coaching_next_actions";
      const existing = String(located.project.projectData?.[key] || "").trim();
      const combined =
        existing && !existing.split("\n").includes(value)
          ? `${existing}\n${value}`
          : existing || value;
      const prior = Array.isArray(
        located.project.projectData?.coaching_manual_updates,
      )
        ? located.project.projectData.coaching_manual_updates.slice(-99)
        : [];
      await writeProject(member.orgId, located.index, {
        ...located.project,
        projectData: {
          ...(located.project.projectData || {}),
          [key]: combined,
          coaching_manual_updates: [
            ...prior,
            {
              at: when,
              kind: proposal.kind,
              value,
              sourceCommunicationId: claimed.communicationId,
              actor,
            },
          ],
        },
      });
    }
    return {
      item: await finishTriageAgentProposal(member.orgId, id, "applied", actor),
    };
  } catch (error: any) {
    await finishTriageAgentProposal(
      member.orgId,
      id,
      "failed",
      actor,
      String(error?.message || error).slice(0, 1000),
    );
    // A sheet/provider effect may have completed: callers must reconcile before replay.
    throw new Error(
      `Agent proposal outcome requires reconciliation: ${String(error?.message || error).slice(0, 1000)}`,
    );
  }
}
