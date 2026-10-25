import {
  requireOrganizationMember,
  transactWorkspaceConfiguration,
  readTenantAgentProfile,
} from "../serverStore.js";
import { createCommunicationsClient } from "../communications/client.js";
import { runtimeDatabase } from "../runtimeDatabase.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { loadBriefing, sourceDependencies, buildSnapshot } from "./sources.js";
import {
  queryBriefing,
  briefingReport,
  publicItem,
  subjectFor,
  fail,
  type BriefingMember,
} from "./model.js";
import { prepareChange, confirmChange, readChange } from "./changes.js";
import { readBriefingRecord, transactBriefingRecord } from "./store.js";

export const defaultBriefingSettings = {
  enabled: false,
  allowTaskUpdates: false,
  allowApprovals: false,
  sections: ["tasks", "approvals", "reports"],
  reportSubject: "me",
  reportType: "workload",
  reportDays: 7,
};
export async function briefingSettings(member: BriefingMember, body?: any) {
  if (body === undefined)
    return {
      ...defaultBriefingSettings,
      ...((await readBriefingRecord(member.orgId, "settings", member.uid)) ||
        {}),
    };
  if (member.apiClientId)
    fail(403, "Configure voice authority from an authenticated human session");
  if (
    typeof body.enabled !== "boolean" ||
    typeof body.allowTaskUpdates !== "boolean" ||
    typeof body.allowApprovals !== "boolean"
  )
    fail(422, "Choose briefing and write permissions explicitly");
  if (
    body.projectIds != null &&
    (!Array.isArray(body.projectIds) ||
      body.projectIds.some((s: any) => typeof s !== "string"))
  )
    fail(422, "Project IDs must be a list");
  const sections = body.sections || defaultBriefingSettings.sections;
  if (
    !Array.isArray(sections) ||
    sections.length > 3 ||
    sections.some((s: any) => !["tasks", "approvals", "reports"].includes(s)) ||
    new Set(sections).size !== sections.length
  )
    fail(422, "Choose each briefing section at most once");
  if (
    !["me", "all"].includes(body.reportSubject || "me") ||
    !["workload", "progress", "approvals"].includes(
      body.reportType || "workload",
    )
  )
    fail(422, "Choose supported report defaults");
  if (
    body.reportSubject === "all" &&
    !["owner", "admin"].includes(member.role || "")
  )
    fail(403, "All-user reports require administrator membership");
  const days = Number(body.reportDays || 7);
  if (!Number.isInteger(days) || days < 1 || days > 365)
    fail(422, "Choose a report period of 1–365 days");
  return transactBriefingRecord(member.orgId, "settings", member.uid, () => ({
    enabled: body.enabled,
    allowTaskUpdates: body.allowTaskUpdates,
    allowApprovals: body.allowApprovals,
    sections,
    reportSubject: body.reportSubject || "me",
    reportType: body.reportType || "workload",
    reportDays: days,
    projectIds: body.projectIds || null,
    enrolledBy: member.uid,
    enrolledAt: Date.now(),
  }));
}
export async function handleBriefings(
  req: { method?: string; query?: any; body?: any },
  member: BriefingMember,
  scope?: string[],
) {
  const input = req.method === "GET" ? req.query || {} : req.body || {};
  const operation = input.operation || "list_tasks";
  if (operation === "readiness") {
    const [settings, profile] = await Promise.all([
      briefingSettings(member),
      readTenantAgentProfile(member.orgId),
    ]);
    const checks: Array<{ name: string; ready: boolean; detail: string }> = [];
    checks.push({
      name: "Enrolment",
      ready: settings.enabled && settings.enrolledBy === member.uid,
      detail: settings.enabled
        ? "Briefing enrolment saved"
        : "Enable briefing in call settings",
    });
    const identity = Boolean(
      profile?.primaryUserId === member.uid &&
        profile.primaryPersonId &&
        profile.serviceIdentities?.phone,
    );
    checks.push({
      name: "Caller binding",
      ready: identity,
      detail: identity
        ? "Your account is bound to the primary coaching caller"
        : "Configure the primary person, user and phone service identity",
    });
    try {
      const contact = (
        await createCommunicationsClient().listPeople(member.orgId)
      ).find((p) => p.id === profile?.primaryPersonId);
      checks.push({
        name: "Verification SMS",
        ready: Boolean(contact?.phone),
        detail: contact?.phone
          ? `Code destination ends in ${contact.phone.slice(-4)}`
          : "The enrolled contact needs a phone number",
      });
    } catch {
      checks.push({
        name: "Verification SMS",
        ready: false,
        detail: "Communications contact lookup is unavailable",
      });
    }
    try {
      const url = new URL(String(process.env.COMMUNICATIONS_API_URL));
      url.pathname = "/health";
      url.search = "";
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) }),
        health = await response.json();
      const ready =
        response.ok &&
        health.liveBriefing === true &&
        health.briefingProtocol === "briefing-tool.v1" &&
        health.briefingPromptVersion === "briefing-first.v2";
      checks.push({
        name: "Live tools",
        ready,
        detail: ready
          ? "Communications supports live tools and the verification-first briefing prompt"
          : "The deployed Communications service needs live tools and the verification-first briefing prompt",
      });
    } catch {
      checks.push({
        name: "Live tools",
        ready: false,
        detail: "Communications readiness could not be verified",
      });
    }
    return {
      ready: checks.every((c) => c.ready),
      checks,
      permissions: {
        taskUpdates: settings.allowTaskUpdates,
        approvals: settings.allowApprovals,
      },
    };
  }
  if (operation === "changes") {
    if (req.method !== "GET") fail(405, "Use GET for action history");
    const root =
      (
        await (await runtimeDatabase())
          .ref(
            `briefings/${encodeURIComponent(member.orgId).replace(/\./g, "%2E")}/changes`,
          )
          .get()
      ).val() || {};
    return {
      items: Object.values<any>(root)
        .filter((r) => r.uid === member.uid)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 50)
        .map((r) => ({
          id: r.id,
          readback: r.readback,
          status: r.status,
          error: r.error,
          createdAt: r.createdAt,
          callId: r.callId || null,
        })),
    };
  }
  if (operation === "map_assignee") {
    if (
      req.method !== "POST" ||
      member.apiClientId ||
      !["owner", "admin"].includes(member.role || "")
    )
      fail(403, "An administrator must map assignees");
    if (
      typeof input.name !== "string" ||
      !input.name.trim() ||
      input.name.length > 200 ||
      /[.#$\[\]/]/.test(input.name) ||
      ["__proto__", "prototype", "constructor"].includes(input.name.trim())
    )
      fail(422, "Choose a valid existing assignee name");
    await requireOrganizationMember(String(input.userId || ""), member.orgId);
    await transactWorkspaceConfiguration(member.orgId, (current) => {
      const w = workspaceView(current);
      w.settings = {
        ...w.settings,
        briefingAssignees: {
          ...(w.settings.briefingAssignees || {}),
          [input.name.trim()]: input.userId,
        },
      };
      w.dataRevision++;
      w.lastUpdated = Date.now();
      return w;
    });
    return { saved: true };
  }
  if (operation === "settings") {
    if (!["GET", "PUT"].includes(req.method || ""))
      fail(405, "Use GET or PUT for settings");
    return {
      settings: await briefingSettings(
        member,
        req.method === "PUT" ? input : undefined,
      ),
    };
  }
  if (operation === "change_result")
    return readChange(member, String(input.id || ""));
  if (["prepare_change", "confirm_change"].includes(operation)) {
    if (req.method !== "POST") fail(405, "Use POST for changes");
    return operation === "prepare_change"
      ? prepareChange(member, input, scope)
      : confirmChange(member, input, scope);
  }
  if (!["GET", "POST"].includes(req.method || "")) fail(405, "Use GET or POST");
  if (operation === "subjects") {
    const [workspace, members] = await Promise.all([
      sourceDependencies.workspace(member.orgId),
      sourceDependencies.members(member.orgId),
    ]);
    const snapshot = buildSnapshot(
      {
        workspace,
        members,
        commitments: [],
        flows: [],
        artifacts: [],
        calendars: [],
        publications: [],
        runs: [],
        triage: [],
        work: [],
        notices: [],
      },
      member,
      scope,
    );
    return {
      subjects: snapshot.subjects
        .filter(
          (s) =>
            ["owner", "admin"].includes(member.role || "") ||
            s.id === member.uid,
        )
        .map(({ aliases, ...s }) => s),
    };
  }
  const snapshot = await loadBriefing(member, scope);
  if (operation === "report") return briefingReport(snapshot, member, input);
  if (operation === "read_item") {
    const item = snapshot.items.find((i) => i.id === input.itemId);
    if (!item) fail(404, "Item not found");
    if (
      !["owner", "admin"].includes(member.role || "") &&
      ![item.assigneeUid, item.reviewerUid].includes(member.uid)
    )
      fail(403, "Item belongs to another user");
    return {
      asOf: snapshot.asOf,
      item: publicItem(item),
      incomplete: snapshot.incomplete,
      notices: snapshot.notices,
    };
  }
  if (!["list_tasks", "list_approvals"].includes(operation))
    fail(422, "Unknown briefing operation");
  subjectFor(input.subject, member, snapshot.subjects);
  return queryBriefing(snapshot, member, {
    ...input,
    includeClosed:
      input.includeClosed === true || input.includeClosed === "true",
    kind: operation === "list_approvals" ? "approval" : "task",
  });
}
