import {
  readTenantWorkspace,
  listOperationalCommitments,
  readTenantAgentProfile,
} from "../serverStore.js";
import { runtimeDatabase } from "../runtimeDatabase.js";
import { SubtaskStatus } from "../../types.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { flowStore } from "../visibleFlows/store.js";
import { artifactStore } from "../artifacts/store.js";
import { calendarStore } from "../calendar/store.js";
import { publishingStore } from "../publishing/store.js";
import { listActiveReceptionRuns } from "../reception/asks.js";
import { askVersion } from "../reception/asks.js";
import {
  fingerprint,
  rows,
  resolveAssignee,
  type BriefingMember,
  type BriefingItem,
  type BriefingSnapshot,
  type Subject,
} from "./model.js";

const key = (s: string) => encodeURIComponent(s).replace(/\./g, "%2E");
const instant = (value: any): number | undefined => {
  const n = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(n) ? n : undefined;
};
export const sourceDependencies = {
  profile: readTenantAgentProfile,
  workspace: readTenantWorkspace,
  commitments: async (org: string, after: string, limit: number) =>
    (await listOperationalCommitments(org, after, limit)).rows,
  flows: flowStore.list,
  artifacts: artifactStore.list,
  calendars: calendarStore.list,
  publishing: publishingStore.read,
  runs: async (org: string, project: string, _limit: number) =>
    listActiveReceptionRuns(org, project),
  triage: async (org: string, limit = 1000) => {
    const root = (await runtimeDatabase()).ref(`triage_items/${key(org)}`);
    const pages = await Promise.all(
      ["pending", "failed"].map((status) =>
        root
          .orderByChild("agentProposal/status")
          .equalTo(status)
          .limitToFirst(limit + 1)
          .get(),
      ),
    );
    return pages
      .flatMap((page) => rows(page.val()))
      .sort((a, b) => a.id.localeCompare(b.id))
      .slice(0, limit + 1);
  },
  members: async (org: string) =>
    (
      await (await runtimeDatabase())
        .ref(`organizations/${key(org)}/members`)
        .get()
    ).val() || {},
  work: async (org: string) =>
    (
      await (await runtimeDatabase()).ref(`review_work/${key(org)}`).get()
    ).val() || {},
};
export type SourceData = {
  timezone?: string;
  workspace: any;
  members: any;
  commitments: any[];
  flows: any[];
  artifacts: any[];
  calendars: any[];
  publications: any[];
  runs: any[];
  triage: any[];
  work: any[];
  notices: string[];
};

export async function loadBriefing(
  member: BriefingMember,
  projectIds?: string[],
  deps = sourceDependencies,
  itemId?: string,
  kind?: "task" | "approval",
): Promise<BriefingSnapshot> {
  // An item read still rebuilds its live version and authority, but does not
  // wait for unrelated domain stores. Lists and reports retain full coverage.
  const source = itemId?.split(":")[0];
  const wants = (...sources: string[]) => source ? sources.includes(source)
    : !kind || sources.some(s => kind === "task"
      ? ["commitment", "review_work"].includes(s)
      : s !== "review_work" && s !== "commitment");
  const [rawWorkspace, profile] = await Promise.all([
    deps.workspace(member.orgId),
    deps.profile(member.orgId),
  ]);
  const workspace = workspaceView(rawWorkspace);
  const projects = workspace.projects.filter(
    (p: any) => !p.isArchived && (!projectIds || projectIds.includes(p.id)),
  );
  const data: SourceData = {
    timezone: profile?.timezone || "UTC",
    workspace: { ...workspace, projects },
    members: {},
    commitments: [],
    flows: [],
    artifacts: [],
    calendars: [],
    publications: [],
    runs: [],
    triage: [],
    work: [],
    notices: [],
  };
  const read = async (
    name: string,
    fn: () => Promise<any>,
    set: (value: any) => void,
  ) => {
    try {
      set(await fn());
    } catch {
      data.notices.push(
        `${name} could not be read; this briefing is incomplete.`,
      );
    }
  };
  const paged = async (
    name: string,
    fn: (after: string, limit: number) => Promise<any[]>,
    set: (value: any[]) => void,
  ) =>
    read(
      name,
      async () => {
        const out: any[] = [];
        let after = "";
        for (let page = 0; page < 10; page++) {
          const batch = await fn(after, 100);
          out.push(...batch);
          if (batch.length < 100) return out;
          after = batch.at(-1)!.id;
        }
        data.notices.push(
          `${name} reached the 1,000 record limit; narrow the project scope.`,
        );
        return out;
      },
      set,
    );
  const sourceReads = Promise.all([
    read(
      "Memberships",
      () => deps.members(member.orgId),
      (v) => {
        data.members = v;
      },
    ),
    read(
      "Review tasks",
      async () => wants("review_work") ? deps.work(member.orgId) : {},
      (v) => {
        data.work = rows(v);
      },
    ),
    paged(
      "Commitments",
      async (a, l) => wants("commitment", "commitment_approval") ? deps.commitments(member.orgId, a, l) : [],
      (v) => {
        data.commitments = v;
      },
    ),
    paged(
      "Flows",
      async (a, l) => wants("flow_approval") ? deps.flows(member.orgId, a, l) : [],
      (v) => {
        data.flows = v;
      },
    ),
    paged(
      "Artifacts",
      async (a, l) => wants("artifact_approval") ? deps.artifacts(member.orgId, a, l) : [],
      (v) => {
        data.artifacts = v;
      },
    ),
    read(
      "Calendars",
      async () => wants("calendar_approval") ? deps.calendars(member.orgId) : [],
      (v) => {
        data.calendars = v;
        if (v.length >= 100)
          data.notices.push("Calendar coverage reached its limit.");
      },
    ),
    read(
      "Triage",
      async () => wants("triage_approval") ? deps.triage(member.orgId, 1000) : [],
      (v) => {
        data.triage = v.slice(0, 1000);
        if (v.length > 1000)
          data.notices.push(
            "Pending triage proposals reached the 1,000 record limit; narrow the scope before treating this as a complete approval queue.",
          );
      },
    ),
  ]);
  // Bound provider-independent reads and preserve failures per project.
  for (let offset = 0; offset < projects.length; offset += 5)
    await Promise.all(
      projects.slice(offset, offset + 5).map(async (p: any) => {
        await Promise.all([
          read(
            `Publications for ${p.name}`,
            async () => wants("publication_approval") ? deps.publishing(member.orgId, p.id) : null,
            (v) => {
              data.publications.push(
                ...rows(v?.items).map((r: any) => ({ ...r, projectId: p.id })),
              );
            },
          ),
          read(
            `Workflow approvals for ${p.name}`,
            async () => wants("workflow_ask") ? deps.runs(member.orgId, p.id, 200) : [],
            (v) => {
              data.runs.push(...v);
              if (v.length >= 200)
                data.notices.push(
                  `Workflow run coverage for ${p.name} reached its limit.`,
                );
            },
          ),
        ]);
      }),
    );
  await sourceReads;
  return buildSnapshot(data, member, projectIds);
}

export function buildSnapshot(
  data: SourceData,
  member: BriefingMember,
  projectIds?: string[],
  now = Date.now(),
): BriefingSnapshot {
  const w = workspaceView(data.workspace),
    notices = [...data.notices];
  const projects = w.projects.filter(
    (p: any) => !p.isArchived && (!projectIds || projectIds.includes(p.id)),
  );
  const allowed = new Map<string, any>(projects.map((p: any) => [p.id, p]));
  const subjects: Subject[] = Object.entries<any>(data.members).map(
    ([id, m]) => ({
      id,
      name: m.name || m.email || id,
      email: m.email,
      aliases: [],
      kind: "member",
    }),
  );
  if (!subjects.some((s) => s.id === member.uid))
    subjects.push({
      id: member.uid,
      name: member.email || "Me",
      email: member.email,
      aliases: [],
      kind: "member",
    });
  for (const s of subjects) {
    if (s.id === member.uid && !s.email) s.email = member.email;
    for (const [name, details] of Object.entries<any>(
      w.settings.teamMemberDetails || {},
    )) {
      if (s.email && details.email?.toLowerCase() === s.email.toLowerCase()) {
        s.aliases.push(name);
        s.name = name;
      }
    }
  }
  const bindings = w.settings.briefingAssignees || {};
  // Workspace assignees are report subjects, not authenticated principals.
  for (const label of rows<string>(w.settings.people)) {
    if (
      typeof label !== "string" ||
      !label.trim() ||
      resolveAssignee(label, subjects, bindings)
    )
      continue;
    const memberMatches = subjects.filter(
      (s) =>
        s.kind !== "assignee" &&
        s.aliases.some((a) => a.toLowerCase() === label.toLowerCase()),
    );
    if (memberMatches.length > 1) continue;
    subjects.push({
      id: `assignee:${fingerprint(label.trim().toLowerCase()).slice(0, 24)}`,
      name: label.trim(),
      aliases: [label.trim()],
      kind: "assignee",
    });
  }
  const resolve = (value: any) => resolveAssignee(value, subjects, bindings);
  const reviewerIds = (ask: any): string[] =>
    rows<string>(ask?.assignees)
      .map(resolve)
      .filter((id): id is string => Boolean(id));
  const reviewerFor = (ask: any) =>
    reviewerIds(ask).find((id) => id === member.uid) || reviewerIds(ask)[0];
  const items: BriefingItem[] = [];
  const add = (item: BriefingItem) => {
    if (!item.projectId || allowed.has(item.projectId))
      items.push({
        ...item,
        ...(item.projectId
          ? { projectName: allowed.get(item.projectId)?.name }
          : {}),
      });
  };
  const base = (
    source: string,
    row: any,
    kind: "task" | "approval",
    title: string,
    version: any,
  ): BriefingItem => ({
    id: `${source}:${row.id}`,
    source,
    sourceId: row.id,
    kind,
    title,
    projectId: row.projectId,
    status: row.status || row.state || "open",
    version: String(version),
    actions: [],
  });
  let unresolved = 0;
  for (const p of projects)
    for (const node of rows(p.milestones))
      for (const task of rows(node.subtasks)) {
        const uid = resolve(
          task.assigneeUid || task.assignedTo || "Unassigned",
        );
        if (task.assignedTo && !uid) unresolved++;
        const row = {
          ...base(
            "subtask",
            { ...task, projectId: p.id },
            "task",
            task.name,
            fingerprint(task),
          ),
          id: `subtask:${p.id}:${node.id}:${task.id}`,
          assigneeUid: uid,
          assigneeLabel: task.assignedTo,
          dueAt: task.dueDate
            ? new Date(task.dueDate).toISOString()
            : undefined,
          updatedAt:
            task.completedAt ||
            task.commentHistory?.at(-1)?.timestamp ||
            p.updatedAt,
          actions:
            uid === member.uid || ["owner", "admin"].includes(member.role || "")
              ? ["set_status"]
              : [],
          details: task.description,
        };
        row.commands = {
          set_status: {
            domain: "subtask",
            projectId: p.id,
            nodeId: node.id,
            id: task.id,
          },
        };
        add(row);
        if (task.requiresApproval && task.approvalStatus === "pending") {
          const reviewer = resolve(task.accountable);
          add({
            ...row,
            id: `task_approval:${p.id}:${node.id}:${task.id}`,
            source: "task_approval",
            kind: "approval",
            reviewerUid: reviewer,
            status: "pending",
            actions: reviewer === member.uid ? ["approve", "reject"] : [],
            notice: reviewer
              ? undefined
              : "Assign a verified accountable reviewer.",
            commands: {
              approve: {
                domain: "task_approval",
                projectId: p.id,
                nodeId: node.id,
                id: task.id,
              },
              reject: {
                domain: "task_approval",
                projectId: p.id,
                nodeId: node.id,
                id: task.id,
              },
            },
          });
        }
      }
  for (const task of rows(w.scratchTasks)) {
    const uid = resolve(task.assigneeUid || task.assignedTo || task.createdBy);
    add({
      ...base("scratch", task, "task", task.name, fingerprint(task)),
      status: task.status || "Not started",
      assigneeUid: uid,
      actions: uid === member.uid ? ["set_status"] : [],
      commands: { set_status: { domain: "scratch", id: task.id } },
      updatedAt: task.updatedAt || task.createdAt,
    });
  }
  for (const task of data.work)
    add({
      ...base(
        "review_work",
        { ...task, projectId: task.project_id },
        "task",
        task.title || task.text,
        fingerprint(task),
      ),
      assigneeUid: task.uid,
      actions: task.uid === member.uid ? ["set_status"] : [],
      dueAt: task.scheduled_at,
      updatedAt: instant(task.updated_at || task.created_at),
      commands: { set_status: { domain: "review_work", id: task.id } },
    });
  for (const c of data.commitments) {
    const uid = resolve(c.terms?.owner);
    add({
      ...base(
        "commitment",
        c,
        "task",
        c.terms?.deliverable || "Obligation",
        c.version,
      ),
      assigneeUid: uid,
      dueAt: c.terms?.dueAt,
      updatedAt: c.updatedAt,
      actions: uid === member.uid && !c.review ? ["set_status", "progress", "submit"] : [],
      statusOptions: ["Started", "Submitted", "Completed"],
      notice: "Started records progress. Completed records the work as done and submits it for acceptance; it does not bypass the beneficiary's acceptance.",
      commands: {
        set_status: {
          domain: "commitments", id: c.id, projectId: c.projectId,
          action: "briefing_status", expectedVersion: c.version,
        },
        progress: {
          domain: "commitments",
          id: c.id,
          projectId: c.projectId,
          action: "progress",
          expectedVersion: c.version,
        },
        submit: {
          domain: "commitments",
          id: c.id,
          projectId: c.projectId,
          action: "submit",
          expectedVersion: c.version,
        },
      },
    });
    if (c.review?.ask?.status === "open")
      add({
        ...base(
          "commitment_approval",
          c,
          "approval",
          c.review.ask.prompt,
          c.version,
        ),
        reviewerUid: c.reviewerUid,
        status: "open",
        actions:
          c.reviewerUid === member.uid && c.review.ask.kind === "approval"
            ? ["approve", "reject"]
            : [],
        notice:
          c.review.ask.kind === "approval"
            ? undefined
            : "Clarification is required before approval.",
        commands: Object.fromEntries(
          ["approve", "reject"].map((a) => [
            a,
            {
              domain: "commitments",
              id: c.id,
              projectId: c.projectId,
              action: "respond",
              askId: c.review.ask.id,
              expectedVersion: c.version,
              decision: a === "approve" ? "approved" : "rejected",
            },
          ]),
        ),
      });
  }
  for (const flow of data.flows)
    for (const version of rows(flow.versions))
      if (version.ask?.status === "open") {
        const reviewer = reviewerFor(version.ask);
        add({
          ...base(
            "flow_approval",
            { ...flow, id: `${flow.id}:${version.version}` },
            "approval",
            version.ask.prompt,
            `${flow.revision}:${version.hash}`,
          ),
          reviewerUid: reviewer,
          reviewerUids: reviewerIds(version.ask),
          status: "open",
          actions:
            version.ask.kind === "approval" &&
            !version.missing?.length &&
            version.ask.assignees?.includes(member.uid)
              ? ["approve", "reject"]
              : [],
          commands: Object.fromEntries(
            ["approve", "reject"].map((a) => [
              a,
              {
                domain: "flows",
                operation: a,
                id: flow.id,
                projectId: flow.projectId,
                expectedRevision: flow.revision,
                version: version.version,
                hash: version.hash,
              },
            ]),
          ),
        });
      }
  for (const a of data.artifacts)
    if (["proposed", "generated"].includes(a.status)) {
      add({
        ...base(
          "artifact_approval",
          a,
          "approval",
          a.title || a.inputs?.title || "Report approval",
          `${a.revision}:${a.inputHash}`,
        ),
        reviewerUid: a.createdBy,
        actions: a.createdBy === member.uid ? ["approve", "reject"] : [],
        notice:
          a.status === "generated"
            ? "Approval requires your confirmation that you inspected this exact generated file for layout and source content."
            : undefined,
        ...(a.status === "generated"
          ? {
              requiredChecks: ["visualChecked", "contentChecked"],
              evidenceHash: a.receipt?.sha256,
            }
          : {}),
        commands: Object.fromEntries(
          ["approve", "reject"].map((op) => [
            op,
            {
              domain: "artifacts",
              operation: a.status === "generated" ? "review" : op,
              ...(a.status === "generated"
                ? {
                    decision: op === "approve" ? "approved" : "rejected",
                    fileHash: a.receipt?.sha256,
                  }
                : {}),
              id: a.id,
              projectId: a.projectId,
              revision: a.revision,
              inputHash: a.inputHash,
            },
          ]),
        ),
      });
    }
  for (const ledger of data.calendars)
    for (const p of rows(ledger.proposals))
      if (p.status === "review") {
        const reviewer = reviewerFor(p.ask);
        add({
          ...base(
            "calendar_approval",
            p,
            "approval",
            p.ask?.prompt || "Calendar proposal",
            `${p.revision}:${p.hash}`,
          ),
          id: `calendar_approval:${ledger.id}:${p.id}`,
          details: JSON.stringify(p.change || {}),
          reviewerUid: reviewer,
          reviewerUids: reviewerIds(p.ask),
          actions: p.ask?.assignees?.includes(member.uid)
            ? ["approve", "reject"]
            : [],
          commands: Object.fromEntries(
            ["approve", "reject"].map((op) => [
              op,
              {
                domain: "calendar",
                operation: op,
                calendarKey: ledger.id,
                proposalId: p.id,
                projectId: p.projectId,
                expectedRevision: p.revision,
                hash: p.hash,
              },
            ]),
          ),
        });
      }
  for (const p of data.publications)
    if (p.state === "awaiting_approval") {
      const reviewer = reviewerFor(p.ask);
      add({
        ...base(
          "publication_approval",
          p,
          "approval",
          p.content?.title || p.title || "Publication review",
          `${p.revision}:${p.contentHash}`,
        ),
        reviewerUid: reviewer,
        actions:
          p.ask?.assignees?.includes(member.uid) &&
          ["owner", "admin"].includes(member.role || "")
            ? ["approve", "reject"]
            : [],
        notice:
          "Approval requires confirmation that this exact content is permitted for public use.",
        requiredChecks: ["publicUseChecked"],
        details: p.content?.text || p.sourceNotes,
        evidenceHash: p.contentHash,
        commands: Object.fromEntries(
          ["approve", "reject"].map((op) => [
            op,
            {
              domain: "publishing",
              operation: op,
              id: p.id,
              projectId: p.projectId,
              revision: p.revision,
              contentHash: p.contentHash,
            },
          ]),
        ),
      });
    }
  const seen = new Set<string>();
  for (const run of data.runs)
    for (const node of rows(run.state?.milestones))
      for (const ask of rows(node.asks))
        if (ask.status === "open" && !seen.has(ask.id)) {
          seen.add(ask.id);
          const reviewer =
            ask.assignees
              ?.map(resolve)
              .find((id: string) => id === member.uid) ||
            resolve(ask.assignees?.[0]);
          add({
            ...base(
              "workflow_ask",
              { ...ask, projectId: run.projectId },
              "approval",
              ask.prompt,
              askVersion(ask, run.id),
            ),
            reviewerUid: reviewer,
            reviewerUids: ask.assignees?.map(resolve).filter(Boolean) || [],
            status: "open",
            actions:
              ask.kind === "approval" && reviewer === member.uid
                ? ["approve", "reject"]
                : [],
            notice:
              ask.kind !== "approval"
                ? "This item requires a structured answer rather than approval."
                : undefined,
            commands: Object.fromEntries(
              ["approve", "reject"].map((op) => [
                op,
                {
                  domain: "workflow_ask",
                  projectId: run.projectId,
                  askId: ask.id,
                  runId: run.id,
                  version: askVersion(ask, run.id),
                  decision: op === "approve" ? "approved" : "rejected",
                },
              ]),
            ),
          });
        }
  for (const t of data.triage)
    if (["pending", "failed"].includes(t.agentProposal?.status)) {
      const reviewer = ["owner", "admin"].includes(member.role || "")
        ? member.uid
        : undefined;
      add({
        ...base(
          "triage_approval",
          { ...t, projectId: t.agentProposal.projectId },
          "approval",
          `${t.agentProposal.kind}: ${t.agentProposal.summary}`,
          fingerprint(t.agentProposal),
        ),
        reviewerUid: reviewer,
        actions: reviewer ? ["approve", "reject"] : [],
        details: t.agentProposal.value,
        commands: Object.fromEntries(
          ["approve", "reject"].map((op) => [
            op,
            {
              domain: "triage",
              id: t.id,
              decision: op,
              expectedFingerprint: fingerprint(t.agentProposal),
            },
          ]),
        ),
      });
    }
  const taskNotices = [...notices], approvalNotices = [...notices];
  if (unresolved)
    taskNotices.push(
      `${unresolved} project tasks have unresolved assignees; map their names to verified users in briefing settings.`,
    );
  const unassignedReviews = items.filter(
    (i) => i.kind === "approval" && !i.reviewerUid,
  ).length;
  if (unassignedReviews)
    approvalNotices.push(
      `${unassignedReviews} pending reviews have no verified reviewer mapping; the personal approval queue is incomplete.`,
    );
  const progress: BriefingItem[] = [];
  for (const log of rows(w.activityLogs)) {
    if (
      log.action !== "updated" ||
      !log.taskId ||
      !/status|completed/i.test(log.details || "")
    )
      continue;
    const task = items.find(
      (i) =>
        i.source === "subtask" &&
        i.sourceId === log.taskId &&
        i.projectId === log.projectId,
    );
    if (!task) continue;
    const status =
      /status changed to\s+(.+)/i.exec(log.details || "")?.[1] ||
      (/completed/i.test(log.details || "") ? "Completed" : task.status);
    progress.push({
      ...task,
      id: `activity:${log.id}`,
      source: "activity",
      sourceId: log.id,
      status,
      updatedAt: log.timestamp,
      actions: [],
      commands: undefined,
      details: log.details,
    });
  }
  for (const item of items.filter((i) =>
    ["commitment", "review_work"].includes(i.source),
  ))
    if (item.updatedAt)
      progress.push({ ...item, actions: [], commands: undefined });
  return {
    asOf: new Date(now).toISOString(),
    timezone: data.timezone || "UTC",
    statusOptions: [
      ...new Set([
        ...Object.values(SubtaskStatus),
        ...rows<string>(w.settings.statuses).filter(
          (s) => typeof s === "string",
        ),
      ]),
    ],
    subjects,
    items,
    progress,
    incomplete: taskNotices.length > 0 || approvalNotices.length > 0,
    notices: [...new Set([...taskNotices, ...approvalNotices])],
    sectionNotices: {task: taskNotices, approval: approvalNotices},
  };
}
