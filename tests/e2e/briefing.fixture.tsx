import React from "react";
import { createRoot } from "react-dom/client";
import { BriefingPanel } from "../../components/BriefingPanel";
let settings = {
  enabled: false,
  allowTaskUpdates: false,
  allowApprovals: false,
  sections: ["tasks", "approvals", "reports"],
  reportSubject: "me",
  reportType: "workload",
  reportDays: 7,
};
let status = "Started",
  approval = "pending";
const changes: any[] = [];
const response = (value: any, code = 200) =>
  Response.json(value, { status: code });
const request: any = async (url: string, init: any) => {
  const input = init?.body
    ? JSON.parse(init.body)
    : Object.fromEntries(new URL(url, "https://fixture.test").searchParams);
  const task = {
    id: "subtask:p:n:t",
    source: "subtask",
    title: "Briefing acceptance task",
    projectId: "p",
    projectName: "Acceptance project",
    status,
    version: status,
    actions: status === "Completed" ? [] : ["set_status"],
  };
  const ask = {
    id: "approval:p:a",
    source: "flow_approval",
    title: "Approve the acceptance report",
    projectId: "p",
    projectName: "Acceptance project",
    status: approval,
    version: approval,
    actions: approval === "pending" ? ["approve", "reject"] : [],
  };
  if (input.operation === "settings") {
    if (init.method === "PUT") settings = input;
    return response({ settings });
  }
  if (input.operation === "subjects")
    return response({
      subjects: [
        { id: "alice", name: "Alice" },
        { id: "bob", name: "Bob" },
      ],
    });
  if (input.operation === "readiness")
    return response({
      ready: settings.enabled,
      checks: [
        {
          name: "Enrolment",
          ready: settings.enabled,
          detail: settings.enabled ? "Saved" : "Enable briefing",
        },
        { name: "Live tools", ready: true, detail: "Isolated fixture only" },
      ],
    });
  if (input.operation === "changes") return response({ items: changes });
  if (input.operation === "read_item")
    return response({ item: input.itemId === task.id ? task : ask });
  if (input.operation === "prepare_change") {
    const item = input.itemId === task.id ? task : ask;
    const change = {
      id: input.requestId,
      itemId: item.id,
      status: "prepared",
      action: input.action,
      target: input.status,
      readback: `${item.title}. ${input.action === "set_status" ? "Change status to " + input.status : input.action + " this exact version"}. Confirm this change?`,
    };
    changes.push(change);
    return response(change);
  }
  if (input.operation === "confirm_change") {
    const c = changes.find((c) => c.id === input.id);
    if (c.status !== "completed") {
      if (c.itemId === task.id) status = c.target;
      else approval = c.action === "approve" ? "approved" : "rejected";
      c.status = "completed";
    }
    return response(c);
  }
  if (input.operation === "change_result")
    return response(changes.find((c) => c.id === input.id));
  if (input.operation === "map_assignee") return response({ saved: true });
  return response({
    asOf: new Date().toISOString(),
    total: input.operation === "report" ? 2 : 1,
    incomplete: false,
    notices: [],
    items: input.operation === "list_approvals" ? [ask] : [task],
    ...(input.operation === "report"
      ? {
          text:
            input.subject === "all"
              ? "Alice: 1 open. Bob: 2 open."
              : "Alice: 1 open.",
        }
      : {}),
  });
};
createRoot(document.getElementById("root")!).render(
  <main className="mx-auto max-w-5xl p-6">
    <h1 className="mb-4 text-xl font-bold">
      Isolated briefing UI acceptance — no calls, SMS or provider writes
    </h1>
    <button type="button" onClick={()=>{status='Held';}}>Simulate another edit</button>
    <BriefingPanel orgId="fixture" projectId="p" request={request} />
  </main>,
);
