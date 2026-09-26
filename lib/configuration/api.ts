import { configurationPreflight } from "./preflight.js";
import {
  readTenantWorkspace,
  transactWorkspaceConfiguration,
} from "../serverStore.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { TenantControlError } from "../tenantControl/model.js";
import { applyConfiguration, planConfiguration, type Change } from "./model.js";
import { projectConfiguration, configurationSchemas } from "./schema.js";
const defaults = {
  read: readTenantWorkspace,
  transact: transactWorkspaceConfiguration,
};
export async function handleConfiguration(
  req: { method?: string; query?: any; body?: any },
  member: { orgId: string; uid: string; apiClientId?: string },
  deps = defaults,
) {
  const q = req.query || {},
    body = req.body || {},
    resource = String(q.resource || "configuration");
  const current = workspaceView(await deps.read(member.orgId));
  const projects = current.projects.map(projectConfiguration);
  const selectors = { ...q, ...body };
  const select = () => {
    if (resource === "settings")
      return Object.fromEntries(
        Object.entries(current.settings).filter(
          ([k]) => configurationSchemas.Settings.properties[k],
        ),
      );
    if (resource === "scratch-tasks") return current.scratchTasks;
    if (resource === "ui-views") return current.uiViews || [];
    if (resource === "projects") return projects;
    const project = projects.find((p: any) => p.id === selectors.projectId);
    if (!project) throw new TenantControlError(404, "Project not found");
    if (resource === "nodes") return project.milestones || [];
    const node = (project.milestones || []).find(
      (n: any) => n.id === selectors.nodeId,
    );
    if (!node) throw new TenantControlError(404, "Node not found");
    return node.subtasks || [];
  };
  if (req.method === "GET") {
    if (resource === "configuration") {
      if (q.requestId) {
        const receipt = current.configurationReceipts?.[q.requestId];
        if (
          !receipt ||
          receipt.actor !== member.uid ||
          (member.apiClientId && receipt.clientId !== member.apiClientId)
        )
          throw new TenantControlError(404, "Receipt not found");
        return { receipt };
      }
      return {
        revision: current.dataRevision,
        projects,
        settings: selectSettings(current.settings),
        uiViews: current.uiViews || [],
        scratchTasks: current.scratchTasks,
      };
    }
    const data = select();
    if (q.id && Array.isArray(data)) {
      const item = data.find((x) => x.id === q.id);
      if (!item) throw new TenantControlError(404, "Resource not found");
      return { revision: current.dataRevision, item };
    }
    const after = q.after ? String(q.after) : "",
      limit = q.limit === undefined ? 50 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new TenantControlError(422, "limit must be 1–100");
    if (!Array.isArray(data)) return { revision: current.dataRevision, data };
    const ordered = data
      .filter((x) => x.id > after)
      .sort((a, b) => a.id.localeCompare(b.id));
    const page = ordered.slice(0, limit);
    return {
      revision: current.dataRevision,
      items: page,
      next: ordered.length > limit ? page.at(-1)!.id : null,
    };
  }
  let input = body;
  if (resource !== "configuration") {
    if (!["POST", "PATCH", "DELETE"].includes(req.method || ""))
      throw new TenantControlError(405, "Method not allowed");
    const map: Record<string, Change["resource"]> = {
      projects: "project",
      nodes: "node",
      subtasks: "subtask",
      settings: "settings",
      "ui-views": "ui_view",
      "scratch-tasks": "scratch",
    };
    input = {
      ...body,
      operation: "apply",
      changes: [
        {
          resource: map[resource],
          operation:
            req.method === "DELETE"
              ? "delete"
              : req.method === "PATCH"
                ? "update"
                : "create",
          id: selectors.id,
          projectId: selectors.projectId,
          nodeId: selectors.nodeId,
          value: body.value,
          unset: body.unset,
        },
      ],
    };
  } else if (req.method !== "POST")
    throw new TenantControlError(405, "Method not allowed");
  if (!["validate", "plan", "apply"].includes(input.operation))
    throw new TenantControlError(422, "Choose validate, plan or apply");
  if (input.operation !== "apply") {
    const { next, touched, ...plan } = planConfiguration(current, input);
    const preflight =
      input.operation === "validate"
        ? await configurationPreflight(
            member.orgId,
            next.projects.filter((p: any) => touched.includes(p.id)),
          )
        : undefined;
    return {
      ...plan,
      ...(preflight ? { preflight } : {}),
      providerReadiness: "not_checked",
      sideEffects: false,
    };
  }
  const now = Date.now();
  const saved = await deps.transact(
    member.orgId,
    (raw) => applyConfiguration(raw, input, member, now).next,
  );
  return {
    receipt: saved.configurationReceipts[input.requestId],
    revision: saved.dataRevision,
  };
}
function selectSettings(settings: any) {
  return Object.fromEntries(
    Object.entries(settings).filter(
      ([k]) => configurationSchemas.Settings.properties[k],
    ),
  );
}
