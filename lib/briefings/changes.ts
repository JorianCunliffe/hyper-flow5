import { randomUUID } from "node:crypto";
import { SubtaskStatus } from "../../types.js";
import {isTaskComplete} from '../taskStatus.js';
import {
  transactWorkspaceConfiguration,
  requireOrganizationMember,
  readTenantWorkspace,
  readOperationalCommitment,
} from "../serverStore.js";
import { flowStore } from "../visibleFlows/store.js";
import { artifactStore } from "../artifacts/store.js";
import { calendarStore } from "../calendar/store.js";
import { publishingStore } from "../publishing/store.js";
import { readFlowRun } from "../flowRunStore.js";
import { withBriefingDecision } from "./evidence.js";
import { reviewAgentProposal } from "../triage/agentProposalReview.js";
import { readTenantTriageItem } from "../serverStore.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { runtimeDatabase } from "../runtimeDatabase.js";
import { handleCommitments } from "../commitments/api.js";
import { handleVisibleFlows, publicFlowResponse } from "../visibleFlows/api.js";
import { handleArtifacts } from "../artifacts/api.js";
import { handleCalendar } from "../calendar/api.js";
import { publishingRequest } from "../publishing/store.js";
import { respondToAsk } from "../asks/respondToAsk.js";
import { recordOperationalEvent } from "../operationalLog.js";
import {
  fingerprint,
  fail,
  type BriefingMember,
  type BriefingItem,
} from "./model.js";
import { loadBriefing } from "./sources.js";
import { readBriefingRecord, transactBriefingRecord } from "./store.js";

export type Change = {
  id: string;
  uid: string;
  callId?: string;
  createdAt: number;
  expiresAt: number;
  status: "prepared" | "processing" | "completed" | "failed" | "uncertain";
  requestHash: string;
  voiceInputHash?: string;
  item: BriefingItem;
  action: string;
  parameters: any;
  readback: string;
  result?: any;
  error?: string;
  confirmedAt?: number;
  confirmation?: any;
};
export const changeDependencies = {
  snapshot: loadBriefing,
  read: readBriefingRecord,
  transact: transactBriefingRecord,
  execute: executeChange,
  membership: requireOrganizationMember,
  reconcile: reconcileChange,
  audit: recordOperationalEvent,
};
const clean = (s: any, max = 2000) =>
  typeof s === "string" ? s.trim().slice(0, max) : "";
export function clearConfirmation(text: unknown, action: string): boolean {
  if (typeof text !== "string" || text.length > 200) return false;
  const words = text
    .toLowerCase()
    .replace(/[.,!?;:\-–—]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (
    [
      "yes",
      "yes please",
      "yes please do that",
      "yep",
      "yep please",
      "yeah",
      "yeah please",
      "confirm",
      "confirmed",
      "confirm the change",
      "confirm this change",
      "i confirm",
      "i confirm the change",
      "i confirm this change",
      "yes confirm",
      "yes confirm the change",
      "yes confirm this change",
      "go ahead",
      "do it",
      "that is correct",
      "that's correct",
      "yes that is correct",
      "yes that's correct",
    ].includes(words)
  )
    return true;
  return (
    (action !== "reject" && ["approve that", "approved that", "approve it", "approved it"].includes(words)) ||
    (action === "progress" && ["mark progress", "marked progress", "record progress", "update progress"].includes(words)) ||
    (action === "approve" &&
      ["approve", "approve it", "approve that", "yes approve", "yes approve that", "yes approve it", "yes please approve that", "please approve that"].includes(words)) ||
    (action === "reject" &&
      ["reject", "reject it", "reject that", "yes reject that", "yes reject it"].includes(words))
  );
}
// Only the verified voice gateway can bind a decision to the item discussed
// before the caller spoke. Serialized evidence cannot manufacture this marker.
type VoiceFocus = { itemId: string; version: string; at: number };
const conversationDecisions = new WeakMap<object, VoiceFocus & { progressReport?: boolean }>();
export async function decideVoiceChange(
  member: BriefingMember, input: any, scope: string[] | undefined,
  callId: string, human: any, focus: VoiceFocus, deps = changeDependencies,
) {
  if (member.apiClientId) fail(403, "A verified person must decide briefing changes");
  const inputParameters = { note: clean(input.note),
    ...(input.action === "set_status" ? {status:input.status} : {}),
  };
  const existing: Change = await deps.read(member.orgId, "changes", clean(input.requestId, 120));
  if (existing && existing.uid === member.uid && existing.callId === callId && existing.status !== "prepared") {
    const parameters = { note: clean(input.note),
      ...(input.action === "set_status" ? {status:input.status} : {}),
      ...(input.action === "approve" ? Object.fromEntries((existing.item.requiredChecks || []).map(check => [check,input[check]])) : {}),
    };
    if ((existing.voiceInputHash || existing.requestHash) !== fingerprint([member.uid,callId,input.itemId,input.version,input.action,parameters]))
      fail(409, "requestId was used for different content");
    return safe(existing);
  }
  if (!focus || !Number.isFinite(focus.at) || focus.itemId !== input.itemId || focus.version !== input.version)
    fail(409, "Refresh the current item before applying its decision");
  if (!human || !clean(human.text)) fail(422, "Caller transcription is not available yet");
  const callerNote = clean(human.text);
  const explicit = clearConfirmation(human.text,input.action);
  const progressReport = input.action === "progress" && !explicit && callerNote.length >= 8 &&
    !/\?$/.test(callerNote) &&
    !/^(?:yes[, ]+|please )?(?:reject|rejected|submit|submitted)(?: (?:it|that))?[.!]?$/i.test(callerNote) &&
    !/^(?:yes|yep|yeah)[, ]+(?:but\s+)?(?:wait|hold|don't|do not)\b/i.test(callerNote) &&
    !/^(?:no[, ]*)?(?:please )?(?:(?:don't|do not) (?:save|record|update|change|do)|wait\b|hold on\b|not now\b|no thanks\b)/i.test(callerNote);
  if (!Number.isFinite(human.at) || human.at <= focus.at ||
      human.at > Date.now() + 5000 || Date.now() - human.at > 90000 || (!explicit && !progressReport))
    fail(422, "A clear decision on the current item is required");
  if (input.action === "progress" && !progressReport && !clean(input.note))
    fail(422, "Describe the progress to record");
  const proposal = await prepareChange(member, progressReport ? {...input,note:callerNote} : input, scope, callId, deps);
  if (progressReport) await deps.transact(member.orgId,"changes",proposal.id,(current:Change)=>{
    const voiceInputHash = fingerprint([member.uid,callId,input.itemId,input.version,input.action,inputParameters]);
    if (current.voiceInputHash && current.voiceInputHash !== voiceInputHash) fail(409,"requestId was used for different content");
    return {...current,voiceInputHash};
  });
  const confirmation = { ...human, mode: "conversation", contextAt: focus.at };
  conversationDecisions.set(confirmation, {...focus,progressReport});
  return confirmChange(member, { id: proposal.id }, scope, callId, confirmation, deps);
}
const safe = (row: Change) => ({
  id: row.id,
  status: row.status,
  readback: row.readback,
  createdAt: row.createdAt,
  expiresAt: row.expiresAt,
  result: row.result,
  error: row.error,
  itemId: row.item.id,
  action: row.action,
});
export async function prepareChange(
  member: BriefingMember,
  input: any,
  scope?: string[],
  callId?: string,
  deps = changeDependencies,
) {
  if (member.apiClientId)
    fail(403, "A verified person must prepare briefing changes");
  const id = clean(input.requestId, 120);
  if (!/^[a-zA-Z0-9_-]{8,120}$/.test(id))
    fail(422, "A stable requestId of 8–120 characters is required");
  const snapshot = await deps.snapshot(member, scope, undefined, String(input.itemId || ""));
  const item = snapshot.items.find((i) => i.id === input.itemId);
  if (!item || !item.actions.includes(input.action))
    fail(403, "This item or action is not available to you");
  if (item.version !== String(input.version))
    fail(409, "This item changed; read it again before preparing a change");
  const parameters: any = { note: clean(input.note) };
  if (input.action === "approve")
    for (const check of item.requiredChecks || []) {
      if (input[check] !== true)
        fail(
          422,
          `Human confirmation of ${check} is required for this exact version`,
        );
      parameters[check] = true;
    }
  if (input.action === "set_status") {
    const statuses = [...new Set([...Object.values(SubtaskStatus),...(snapshot.statusOptions||[])])] as string[];
    if (!statuses.includes(input.status))
      fail(422, `Choose one of: ${statuses.join(", ")}`);
    parameters.status = input.status;
  }
  if (["progress", "submit"].includes(input.action) && !parameters.note)
    fail(422, "Evidence or an explanation is required");
  const requestHash = fingerprint([
    member.uid,
    callId || null,
    item.id,
    item.version,
    input.action,
    parameters,
  ]);
  const attestations =
    input.action === "approve"
      ? (item.requiredChecks || []).map((c) =>
          c === "visualChecked"
            ? "you inspected the file layout"
            : c === "contentChecked"
              ? "you checked the file against its source content"
              : "you checked this exact content is permitted for public use",
        )
      : [];
  const readback = `${item.projectName ? item.projectName + ": " : ""}${item.title}. ${input.action === "set_status" ? `Change status from ${item.status} to ${parameters.status}` : input.action === "approve" ? "Approve this exact version" : input.action === "reject" ? "Reject this exact version" : input.action === "submit" ? "Submit evidence for review" : "Record progress"}.${attestations.length ? " You confirm " + attestations.join(" and ") + "." : ""}${parameters.note ? " Note: " + parameters.note : ""} Confirm this change?`;
  const now = Date.now();
  const saved = await deps.transact(
    member.orgId,
    "changes",
    id,
    (current: Change | null) => {
      if (current) {
        if (current.requestHash !== requestHash)
          fail(409, "requestId was used for different content");
        return current;
      }
      return {
        id,
        uid: member.uid,
        ...(callId ? { callId } : {}),
        createdAt: now,
        expiresAt: now + 10 * 60000,
        status: "prepared",
        requestHash,
        item,
        action: input.action,
        parameters,
        readback,
      };
    },
  );
  return safe(saved);
}
export async function readChange(
  member: BriefingMember,
  id: string,
  callId?: string,
  deps = changeDependencies,
) {
  let row: Change = await deps.read(member.orgId, "changes", id);
  if (
    !row ||
    row.uid !== member.uid ||
    (callId !== undefined && row.callId !== callId)
  )
    fail(404, "Change not found");
  if (["processing", "uncertain"].includes(row.status)) {
    const result = await deps.reconcile(member, row);
    if (result)
      row = await deps.transact(
        member.orgId,
        "changes",
        id,
        (current: Change) => ({ ...current, status: "completed", result }),
      );
  }
  return safe(row);
}
export async function confirmChange(
  member: BriefingMember,
  input: any,
  scope?: string[],
  callId?: string,
  confirmation?: any,
  deps = changeDependencies,
) {
  if (member.apiClientId)
    fail(403, "A verified person must confirm briefing changes");
  const initial: Change = await deps.read(
    member.orgId,
    "changes",
    clean(input.id, 120),
  );
  if (!initial || initial.uid !== member.uid || initial.callId !== callId)
    fail(404, "Change not found");
  if (initial.status !== "prepared") return safe(initial);
  if (initial.expiresAt < Date.now())
    fail(409, "This proposal expired; prepare and confirm it again");
  if (callId) {
    const context = confirmation && conversationDecisions.get(confirmation);
    if (context && (context.itemId !== initial.item.id || context.version !== initial.item.version))
      fail(409, "The discussed item changed; refresh it before deciding");
    if (
      !confirmation ||
      confirmation.at <= (context?.at ?? initial.createdAt) ||
      confirmation.at > Date.now() + 5000 ||
      Date.now() - confirmation.at > 90000 ||
      !(clearConfirmation(confirmation.text, initial.action) ||
        (context?.progressReport && initial.action === "progress" && initial.parameters.note === clean(confirmation.text)))
    )
      fail(
        422,
        "Read the exact proposal and obtain a clear new confirmation from the caller",
      );
  } else if (input.confirmed !== true)
    fail(422, "Explicit confirmation is required");
  const fresh = await deps.membership(member.uid, member.orgId);
  const snapshot = await deps.snapshot({ ...member, role: fresh.role }, scope, undefined, initial.item.id);
  const item = snapshot.items.find((i) => i.id === initial.item.id);
  if (
    !item ||
    item.version !== initial.item.version ||
    !item.actions.includes(initial.action)
  )
    fail(
      409,
      "The item or your authority changed; refresh and prepare it again",
    );
  let claimed = false;
  const row: Change = await deps.transact(
    member.orgId,
    "changes",
    initial.id,
    (current: Change) => {
      claimed = false;
      if (current.status !== "prepared") return current;
      if (current.expiresAt < Date.now()) fail(409, "The proposal expired");
      claimed = true;
      return {
        ...current,
        status: "processing",
        confirmedAt: Date.now(),
        confirmation: confirmation || { channel: "web", actor: member.uid },
      };
    },
  );
  if (!claimed) return safe(row);
  try {
    const result = await deps.execute(
      { ...member, role: fresh.role },
      { ...row, item },
    );
    const completed = await deps.transact(
      member.orgId,
      "changes",
      row.id,
      (current: Change) => ({ ...current, status: "completed", result }),
    );
    await deps
      .audit({
        tenantId: member.orgId,
        type: "briefing.change.completed",
        actorId: member.uid,
        projectId: item.projectId,
        status: "completed",
        details: { reasonCode: item.source, decision: row.action },
      })
      .catch(() => {});
    return safe(completed);
  } catch (error: any) {
    // Never repeat a cross-domain effect after a lost response. Its source must be reconciled first.
    const known = Number(error.status) >= 400 && Number(error.status) < 500;
    return safe(
      await deps.transact(
        member.orgId,
        "changes",
        row.id,
        (current: Change) => ({
          ...current,
          status: known ? "failed" : "uncertain",
          error: known
            ? String(error.message).slice(0, 1000)
            : "The outcome is uncertain. Check the source record before attempting another change.",
        }),
      ),
    );
  }
}

export const executionDependencies = {
  workspace: transactWorkspaceConfiguration,
  commitments: handleCommitments,
  flows: handleVisibleFlows,
  artifacts: handleArtifacts,
  calendar: handleCalendar,
  publishing: publishingRequest,
  asks: respondToAsk,
};
export async function executeChange(
  member: BriefingMember,
  change: Change,
  deps = executionDependencies,
) {
  member = withBriefingDecision(member, change.id, Boolean(change.callId));
  const command = change.item.commands?.[change.action];
  if (!command) fail(422, "No domain operation is available");
  const { domain, ...body } = command;
  const note = `[briefing:${change.id}] ${change.parameters.note || "Confirmed during briefing"}`;
  if (["subtask", "task_approval", "scratch"].includes(domain)) {
    const saved = await deps.workspace(member.orgId, (current) => {
      const w = workspaceView(current),
        receipt = w.briefingReceipts?.[change.id];
      if (receipt) {
        if (receipt.requestHash !== change.requestHash)
          fail(409, "Conflicting change receipt");
        return current;
      }
      const project = w.projects.find((p: any) => p.id === body.projectId);
      const task =
        domain === "scratch"
          ? w.scratchTasks.find((t: any) => t.id === body.id)
          : project?.milestones
              ?.find((n: any) => n.id === body.nodeId)
              ?.subtasks?.find((t: any) => t.id === body.id);
      if (!task || fingerprint(task) !== change.item.version)
        fail(409, "Task changed before saving");
      const now = Date.now();
      if (domain === "task_approval")
        task.approvalStatus =
          change.action === "approve" ? "approved" : "rejected";
      else {
        task.status = change.parameters.status;
        if (isTaskComplete(task.status)) task.completedAt = now;
        else delete task.completedAt;
      }
      task.commentHistory = [
        ...(task.commentHistory || []),
        { text: note, status: task.status || "Not started", timestamp: now },
      ];
      if (project) {
        if (project.projectData?.flow_run_id) {
          const flowRunId = String(project.projectData.flow_run_id);
          const previous = task.briefingEdit?.flowRunId === flowRunId ? task.briefingEdit : {};
          task.briefingEdit = {
            ...previous, id: change.id, flowRunId, at: now,
            ...(domain === 'task_approval'
              ? { approvalStatus: task.approvalStatus }
              : { status: task.status, completedAt: task.completedAt ?? null }),
          };
        }
        project.revision = Number(project.revision || 0) + 1;
        project.updatedAt = now;
      }
      w.dataRevision++;
      w.lastUpdated = now;
      w.activityLogs = [
        ...(w.activityLogs || []),
        {
          id: randomUUID(),
          timestamp: now,
          userId: member.uid,
          action: "updated",
          projectId: body.projectId || null,
          taskId: task.id,
          details:
            domain === "task_approval"
              ? `Approval ${task.approvalStatus}`
              : `Status changed to ${task.status}`,
        },
      ];
      w.briefingReceipts = {
        ...(w.briefingReceipts || {}),
        [change.id]: {
          requestHash: change.requestHash,
          at: now,
          status: task.status,
          approvalStatus: task.approvalStatus || null,
        },
      };
      return w;
    });
    return { saved: true, receipt: saved.briefingReceipts[change.id] };
  }
  if (domain === "review_work") {
    const ref = (await runtimeDatabase()).ref(
      `review_work/${encodeURIComponent(member.orgId).replace(/\./g, "%2E")}/${encodeURIComponent(body.id).replace(/\./g, "%2E")}`,
    );
    const listener = () => {};
    try {
      await new Promise<void>((resolve, reject) => {
        ref.on("value", listener, reject);
        ref.once("value", () => resolve(), reject);
      });
      const result = await ref.transaction(
        (current) => {
          if (current?.lastBriefingChange === change.id) return current;
          if (
            !current ||
            current.uid !== member.uid ||
            fingerprint(current) !== change.item.version
          )
            fail(409, "Review task changed");
          return {
            ...current,
            status: change.parameters.status,
            updated_at: Date.now(),
            lastBriefingChange: change.id,
          };
        },
        undefined,
        false,
      );
      if (!result.committed) fail(409, "Review task was not saved");
      return { saved: true, id: body.id, status: result.snapshot.val().status };
    } finally {
      ref.off("value", listener);
    }
  }
  const request = {
    method: domain === "commitments" ? "PATCH" : "POST",
    body: {
      ...body,
      ...Object.fromEntries(
        ["visualChecked", "contentChecked", "publicUseChecked"]
          .filter((k) => change.parameters[k] === true)
          .map((k) => [k, true]),
      ),
      note,
    },
  };
  if (domain === "commitments") {
    const result = await deps.commitments(request, member);
    if (result.item?.id !== body.id)
      throw new Error(
        "The domain returned a different obligation; reconcile this operation before continuing",
      );
    return result;
  }
  if (domain === "flows")
    return publicFlowResponse(await deps.flows(request, member));
  if (domain === "artifacts") return deps.artifacts(request, member);
  if (domain === "calendar") return deps.calendar(request, member);
  if (domain === "publishing") return deps.publishing(request, member);
  if (domain === "triage")
    return reviewAgentProposal(
      member,
      body.id,
      body.decision,
      `briefing:${change.id}:${member.uid}`,
      body.expectedFingerprint,
    );
  if (domain === "workflow_ask") {
    const result = await deps.asks({
      orgId: member.orgId,
      projectId: body.projectId,
      askId: body.askId,
      channel: change.callId ? "voice" : "web",
      ...(change.callId ? { communicationId: change.callId } : {}),
      actorVerified: true,
      actorRole: member.role,
      expectedAsk: { runId: body.runId, version: body.version },
      response: {
        id: change.id,
        at: Date.now(),
        via: change.callId ? "voice" : "web",
        actor: member.uid,
        decision: body.decision,
        text: note,
      },
    });
    if (!result.ok)
      fail(409, result.reason || "The response could not be saved");
    return result;
  }
  fail(422, "Unsupported domain");
}

/** Read-only reconciliation requires our operation marker, never just the desired status. */
export async function reconcileChange(member: BriefingMember, change: Change) {
  const c = change.item.commands?.[change.action];
  if (!c) return null;
  if (["subtask", "task_approval", "scratch"].includes(c.domain)) {
    const receipt = (await readTenantWorkspace(member.orgId))
      ?.briefingReceipts?.[change.id];
    return receipt?.requestHash === change.requestHash
      ? { saved: true, receipt }
      : null;
  }
  if (c.domain === "review_work") {
    const key = (s: string) => encodeURIComponent(s).replace(/\./g, "%2E");
    const row = (
      await (await runtimeDatabase())
        .ref(`review_work/${key(member.orgId)}/${key(c.id)}`)
        .get()
    ).val();
    return row?.lastBriefingChange === change.id
      ? { saved: true, id: row.id, status: row.status }
      : null;
  }
  let asks: any[] = [];
  if (c.domain === "flows") {
    const row = await flowStore.read(member.orgId, c.id);
    asks = (row?.versions || []).map((v) => v.ask);
  }
  if (c.domain === "artifacts") {
    const row: any = await artifactStore.read(member.orgId, "jobs", c.id);
    asks = [row?.ask, row?.reviewAsk];
  }
  if (c.domain === "calendar") {
    const row = await calendarStore.read(member.orgId, c.calendarKey);
    asks = [row?.proposals?.[c.proposalId]?.ask];
  }
  if (c.domain === "publishing") {
    const row = await publishingStore.read(member.orgId, c.projectId);
    asks = [row?.items?.[c.id]?.ask];
  }
  if (c.domain === "workflow_ask") {
    const row = await readFlowRun(member.orgId, c.projectId, c.runId);
    asks = (row?.state.milestones || [])
      .flatMap((n) => n.asks || [])
      .filter((a) => a.id === c.askId);
  }
  if (c.domain === "commitments") {
    const row = await readOperationalCommitment(member.orgId, c.id);
    const evidence = row?.history.find(
      (h) =>
        h.actor === member.uid && h.note?.includes(`[briefing:${change.id}]`),
    );
    return evidence ? { saved: true, version: evidence.version } : null;
  }
  if (c.domain === "triage") {
    const row = await readTenantTriageItem(member.orgId, c.id);
    return row?.agentProposal?.reviewedBy ===
      `briefing:${change.id}:${member.uid}` &&
      ["applied", "rejected"].includes(row.agentProposal.status)
      ? { saved: true, status: row.agentProposal.status }
      : null;
  }
  const response = asks
    .filter(Boolean)
    .flatMap((a) => a.responses || [])
    .find(
      (r) =>
        r.actor === member.uid &&
        [change.id, `briefing_${change.id}`].includes(r.id),
    );
  return response
    ? {
        saved: true,
        responseId: response.id,
        at: response.at,
        decision: response.decision,
      }
    : null;
}
