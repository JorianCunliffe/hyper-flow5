import {handleContactPolicy} from './contactPolicyApi.js';
import {
  listTenantProjects,
  readTenantAgentProfile,
  saveTenantSchedule,
  requireOrganizationMember,
  saveTenantAgentProfile,
  readTenantCommunicationsSettings,
  listTenantSchedules,
} from "../serverStore.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import { normalizeContactWindow } from "./contactPolicy.js";
import { FlowError } from "../visibleFlows/model.js";
import { handleVisibleFlows } from "../visibleFlows/api.js";
import { operatingSnapshot } from "./snapshot.js";
import {
  answerOperatingQuestion,
  selectOperatingItems,
  type CockpitView,
} from "./model.js";
export async function handleCockpit(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: { orgId: string; uid: string; apiClientId?:string },
) {
  const projects = await listTenantProjects(member.orgId);
  const allowed = projects.map((p) => p.id);
  const body = request.body || {};
  const query = request.query || {};
  if(query.operation==='contact_policy'||['contact_policy_preview','contact_policy_apply'].includes(body.operation))return handleContactPolicy(request,member);
  const projectId = request.method === "GET" ? query.projectId : body.projectId;
  if (projectId && !allowed.includes(projectId))
    throw new FlowError(403, "Project is outside your permitted scope");
  if (request.method === "POST" && body.operation === "configure") {
    const actor = await requireOrganizationMember(member.uid, member.orgId);
    if (!["owner", "admin"].includes(actor.role))
      throw new FlowError(
        403,
        "An organization administrator must configure channel access",
      );
    const people = await new HttpCommunicationsClient().listPeople(
      member.orgId,
    );
    if (
      typeof body.primaryPersonId !== "string" ||
      (body.primaryPersonId &&
        !people.some((p) => p.id === body.primaryPersonId))
    )
      throw new FlowError(
        422,
        "Choose a verified Communications contact or leave CEO channel access disabled",
      );
    if (
      body.receptionistEnabled &&
      !allowed.includes(body.receptionistProjectId)
    )
      throw new FlowError(422, "Choose a receptionist intake project");
    let contactWindow;
    try {
      contactWindow = normalizeContactWindow(body.contactWindow);
    } catch (error: any) {
      throw new FlowError(422, error.message);
    }
    await saveTenantAgentProfile(member.orgId, {
      primaryUserId:
        body.primaryPersonId || body.receptionistEnabled ? member.uid : "",
      primaryPersonId: body.primaryPersonId,
      receptionistEnabled: body.receptionistEnabled === true,
      receptionistProjectId: body.receptionistProjectId || "",
      contactWindow,
    });
    return {
      notice:
        "Saved channel identity, intake routing and contact limits. No message or call was sent.",
    };
  }
  if (request.method === "POST" && body.operation === "template") {
    if (!projectId)
      throw new FlowError(422, "Choose a project for the routine");
    if (body.template === "supplier_chase") {
      const person = (
        await new HttpCommunicationsClient().listPeople(member.orgId)
      ).find((p) => p.id === body.personId);
      if (!person) throw new FlowError(422, "Choose a Communications contact");
      const snapshot = await operatingSnapshot(member, [projectId]);
      const owed = snapshot.items
        .filter(
          (row) =>
            row.owner === `contact:${person.id}` &&
            !["candidate", "fulfilled", "cancelled", "dismissed"].includes(
              row.state,
            ),
        )
        .slice(0, 20);
      if (!owed.length)
        throw new FlowError(
          422,
          "This contact has no accepted open obligations in the selected project",
        );
      const message =
        `Please provide an update on these agreed items:\n${owed.map((row) => `${row.deliverable} — due ${row.dueAt} (${row.timezone}).`).join("\n")}`.slice(
          0,
          1200,
        );
      const settings = await readTenantCommunicationsSettings(member.orgId);
      const sms = body.channel === "sms";
      if (!sms && body.channel !== "email")
        throw new FlowError(422, "Choose draft email or SMS");
      const contactStep = sms
        ? {
            action: "send_sms",
            inputs: { to: person.phone || "", body: message, followUp: "true" },
          }
        : {
            action: "draft_email",
            inputs: {
              connectionId: settings.mailboxConnectionId || "",
              to: person.email || "",
              subject: "Request for an update",
              body: message,
            },
          };
      return handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId,
            plan: {
              name: `Follow up with ${person.name || "supplier"}`,
              steps: [
                {
                  id: "contact",
                  name: sms
                    ? "Request supplier updates by SMS"
                    : "Draft a supplier update request",
                  ...contactStep,
                  owner: member.uid,
                  dependsOn: [],
                  sources: owed.map((row) => `${row.id}@${row.version}`),
                },
                {
                  id: "review_reply",
                  name: "Review the received update",
                  action: "collect_update",
                  owner: member.uid,
                  dependsOn: ["contact"],
                  inputs: {
                    question:
                      "Review the actual reply or record that an update is still missing. A sent message, draft or voicemail does not fulfill the obligation.",
                  },
                  sources: owed.map((row) => `${row.id}@${row.version}`),
                },
                {
                  id: "report",
                  name: "Prepare an update report draft",
                  action: "write_report",
                  owner: member.uid,
                  dependsOn: ["review_reply"],
                  inputs: {
                    prompt:
                      "Summarize the reviewed supplier update, identify missing evidence and outstanding commitments. Do not mark any obligation fulfilled.",
                  },
                  sources: ["review_reply"],
                },
              ],
            },
          },
        },
        member,
      );
    }
    if (body.template !== "morning_brief")
      throw new FlowError(422, "Unsupported routine template");
    return handleVisibleFlows(
      {
        method: "POST",
        body: {
          operation: "create",
          projectId,
          plan: {
            name: "CEO morning brief",
            steps: [
              {
                id: "operations",
                name: "Read accepted work and decisions",
                action: "read_operations",
                owner: member.uid,
                dependsOn: [],
                inputs: {},
                sources: ["HyperFlow operational records"],
              },
              {
                id: "evidence",
                name: "Read permitted communication evidence",
                action: "read_context",
                owner: member.uid,
                dependsOn: [],
                inputs: {},
                sources: ["Communications Service"],
              },
              {
                id: "brief",
                name: "Prepare my morning brief",
                action: "write_report",
                owner: member.uid,
                dependsOn: ["operations", "evidence"],
                inputs: {
                  prompt:
                    "Write a concise CEO morning brief: due today and overdue, decisions, work to produce, waiting on others, and active flows. Cite obligation and communication identities. Accepted HyperFlow terms are authoritative; extracted communication promises are evidence only. Say what is missing. This is a draft, not fulfillment or delivery.",
                },
                sources: ["operations", "evidence"],
              },
            ],
          },
        },
      },
      member,
    );
  }
  if (request.method === "POST" && body.operation === "schedule") {
    if (typeof body.definitionId !== "string" || !projectId)
      throw new FlowError(422, "Choose an approved flow and project");
    const { readVisibleFlow } = await import("../serverStore.js");
    const record = await readVisibleFlow(member.orgId, body.definitionId);
    if (body.enabled === false) {
      const existing = (await listTenantSchedules(member.orgId)).find(
        (s) => s.id === "visible_" + body.definitionId,
      );
      if (existing)
        await saveTenantSchedule(member.orgId, {
          id: existing.id,
          enabled: false,
        });
      return { notice: "Daily routine disabled." };
    }
    const version = record?.versions.find((v) => v.version === body.version);
    if (
      record?.projectId !== projectId ||
      !version?.approvedBy ||
      version.hash !== body.hash
    )
      throw new FlowError(409, "Choose an approved exact flow version");
    await requireOrganizationMember(version.approvedBy, member.orgId);
    if (
      typeof body.localTime !== "string" ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(body.localTime)
    )
      throw new FlowError(422, "Choose a valid local run time");
    const profile = await readTenantAgentProfile(member.orgId);
    const timezone = profile?.timezone || "Australia/Brisbane";
    const window = normalizeContactWindow(profile?.contactWindow);
    const hour = Number(body.localTime.split(":")[0]);
    if (
      version.plan.steps.some((step) =>
        ["send_sms", "outgoing_call"].includes(step.action),
      ) &&
      (hour < window.startHour || hour >= window.endHour)
    )
      throw new FlowError(
        422,
        "Choose a routine time inside the configured contact window",
      );
    const schedule = await saveTenantSchedule(member.orgId, {
      id: `visible_${record.id}`,
      activity: "flow_start",
      projectId,
      flowId: `visible:${record.id}`,
      name: `Routine: ${version.plan.name}`,
      enabled: body.enabled === true,
      timezone,
      recurrence: { kind: "daily", localTime: body.localTime },
      misfirePolicy: "run_once",
      input: {
        visibleVersion: version.version,
        visibleHash: version.hash,
        delegatedBy: member.uid,
      },
      resetPolicy: "none",
    });
    return {
      schedule,
      notice:
        "Schedule pins this approved version. Changes require a new explicit schedule selection.",
    };
  }
  if (
    request.method !== "GET" &&
    !(request.method === "POST" && body.operation === "question")
  )
    throw new FlowError(405, "Method not allowed");
  const snapshot = await operatingSnapshot(
    member,
    projectId ? [projectId] : allowed,
  );
  const party = String(query.party || body.party || "");
  if (
    party &&
    party !== `user:${member.uid}` &&
    !snapshot.contacts.some((p) => party === `contact:${p.id}`)
  )
    throw new FlowError(403, "Choose an accessible contact or yourself");
  if (request.method === "POST") {
    if (
      typeof body.question !== "string" ||
      !body.question.trim() ||
      body.question.length > 2000
    )
      throw new FlowError(422, "Enter a question of up to 2000 characters");
    return answerOperatingQuestion(snapshot, body.question, party || undefined);
  }
  const view = (query.view || "today") as CockpitView;
  if (
    ![
      "today",
      "decisions",
      "produce",
      "waiting",
      "contacts",
      "flows",
      "all",
    ].includes(view)
  )
    throw new FlowError(422, "Unknown cockpit view");
  const profile = await readTenantAgentProfile(member.orgId);
  return {
    ...snapshot,
    items: selectOperatingItems(snapshot, view, party || undefined),
    view,
    projects: projects.map((p) => ({ id: p.id, name: p.name })),
    configuration: {
      primaryPersonId: profile?.primaryPersonId || "",
      primaryUserId: profile?.primaryUserId || "",
      receptionistEnabled: profile?.receptionistEnabled || false,
      receptionistProjectId: profile?.receptionistProjectId || "",
      contactWindow: normalizeContactWindow(profile?.contactWindow),
    },
  };
}
