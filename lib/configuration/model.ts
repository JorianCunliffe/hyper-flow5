import { createHash } from "node:crypto";
import { TenantControlError } from "../tenantControl/model.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { ACTION_TASK_TYPE } from "../nodeTypes.js";
import {
  checkSchema,
  configurationSchemas,
  projectConfiguration,
  reservedDataKey,
  type Issue,
} from "./schema.js";
export type Change = {
  resource: "project" | "node" | "subtask" | "settings" | "ui_view" | "scratch";
  operation: "create" | "update" | "delete";
  id?: string;
  projectId?: string;
  nodeId?: string;
  value?: any;
  unset?: string[];
};
export type ConfigurationRequest = {
  expectedRevision: number;
  requestId?: string;
  changes: Change[];
  planHash?: string;
};
const fail = (status: number, message: string): never => {
  throw new TenantControlError(status, message);
};
const canonical = (v: any): string =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(
          Object.entries(x).sort(([a], [b]) => a.localeCompare(b)),
        )
      : x,
  );
export const hash = (v: any) =>
  createHash("sha256").update(canonical(v)).digest("hex");
export function validateProject(project: any): Issue[] {
  const issues = checkSchema(configurationSchemas.Project, project);
  if (issues.length) return issues;
  const nodes = project.milestones || [];
  const ids = new Set<string>();
  const results = new Set<string>();
  for (const n of nodes) {
    if (ids.has(n.id))
      issues.push({ path: n.id, message: "Duplicate node id" });
    ids.add(n.id);
    if (n.actionConfig?.resultVariable) {
      if (results.has(n.actionConfig.resultVariable))
        issues.push({ path: n.id, message: "Duplicate result variable" });
      results.add(n.actionConfig.resultVariable);
    }
  }
  for (const n of nodes) {
    for (const ref of [
      ...(n.dependsOn || []),
      ...(n.decisionConfig?.branches || []).map((b: any) => b.targetId),
      ...(n.loopConfig?.loopStartId ? [n.loopConfig.loopStartId] : []),
    ])
      if (!ids.has(ref) || ref === n.id)
        issues.push({ path: n.id, message: "Invalid graph reference: " + ref });
    for (const result of n.actionConfig?.requiredResults || [])
      if (!results.has(result) || result === n.actionConfig?.resultVariable)
        issues.push({
          path: n.id,
          message: "Unknown upstream result " + result,
        });
    const tasks = n.subtasks || [];
    const taskIds = new Set(tasks.map((t: any) => t.id));
    if (taskIds.size !== tasks.length)
      issues.push({ path: n.id, message: "Duplicate subtask id" });
    for (const t of tasks)
      for (const dep of t.dependsOn || [])
        if (!taskIds.has(dep) || dep === t.id)
          issues.push({
            path: n.id + "/" + t.id,
            message: "Invalid subtask dependency " + dep,
          });
    const activeTasks = new Set<string>(),
      checkedTasks = new Set<string>();
    const visitTask = (id: string) => {
      if (activeTasks.has(id)) {
        issues.push({
          path: n.id + "/" + id,
          message: "Subtask dependency cycle",
        });
        return;
      }
      if (checkedTasks.has(id)) return;
      activeTasks.add(id);
      for (const dep of tasks.find((t: any) => t.id === id)?.dependsOn || [])
        if (taskIds.has(dep)) visitTask(dep);
      activeTasks.delete(id);
      checkedTasks.add(id);
    };
    tasks.forEach((t: any) => visitTask(t.id));
  }
  const visiting = new Set<string>(),
    done = new Set<string>();
  const visit = (id: string) => {
    if (visiting.has(id)) {
      issues.push({
        path: id,
        message: "Dependency cycle; use a loop primitive",
      });
      return;
    }
    if (done.has(id)) return;
    visiting.add(id);
    for (const dep of nodes.find((n: any) => n.id === id)?.dependsOn || [])
      if (ids.has(dep)) visit(dep);
    visiting.delete(id);
    done.add(id);
  };
  ids.forEach(visit);
  for (const k of Object.keys(project.projectData || {}))
    if (reservedDataKey(k))
      issues.push({
        path: "projectData/" + k,
        message: "Reserved runtime or authority field",
      });
  return issues;
}
export function planConfiguration(raw: any, input: ConfigurationRequest) {
  if (
    !Number.isSafeInteger(input.expectedRevision) ||
    input.expectedRevision < 0
  )
    fail(422, "expectedRevision is required");
  const current = workspaceView(raw);
  if (current.dataRevision !== input.expectedRevision)
    fail(409, "Workspace changed; reload and plan again");
  if (
    !Array.isArray(input.changes) ||
    !input.changes.length ||
    input.changes.length > 100
  )
    fail(422, "Supply 1–100 changes");
  if (Buffer.byteLength(JSON.stringify(input)) > 1000000)
    fail(413, "Configuration request exceeds 1 MB");
  const next = structuredClone(current);
  const touched = new Set<string>();
  const diff: any[] = [];
  for (const change of input.changes) {
    if (!["create", "update", "delete"].includes(change.operation))
      fail(422, "Unknown change operation");
    if (
      change.unset !== undefined &&
      (change.operation !== "update" ||
        !Array.isArray(change.unset) ||
        change.unset.length > 50)
    )
      fail(422, "unset supports up to 50 fields on updates");
    const removeFields = (target: any, schema: any) => {
      for (const path of change.unset || []) {
        if (typeof path !== "string") fail(422, "unset paths must be strings");
        const parts = path.split(".");
        let shape = schema,
          cursor = target;
        for (const [index, key] of parts.entries()) {
          if (
            !shape.properties?.[key] ||
            key === "id" ||
            shape.required?.includes(key) ||
            ([
              "projectData",
              "milestones",
              "subtasks",
              "actionConfig",
              "loopConfig",
              "holdConfig",
              "waitConfig",
              "eventTriggerConfig",
            ].includes(key) &&
              index === parts.length - 1)
          )
            fail(
              422,
              "Cannot unset required, runtime or collection field: " + path,
            );
          shape = shape.properties[key];
          if (index === parts.length - 1) {
            if (cursor) delete cursor[key];
          } else {
            if (shape.type !== "object" || !shape.properties)
              fail(
                422,
                "unset paths must address declared configuration fields",
              );
            cursor = cursor?.[key];
          }
        }
      }
    };
    const before = structuredClone(next);
    if (change.resource === "settings") {
      if (change.operation !== "update") fail(422, "Settings use update");
      const issues = checkSchema(configurationSchemas.Settings, change.value);
      if (issues.length) fail(422, JSON.stringify(issues));
      next.settings = { ...next.settings, ...change.value };
      removeFields(next.settings, configurationSchemas.Settings);
    } else {
      let collection: any[];
      let schema: any;
      if (change.resource === "project") {
        collection = next.projects;
        schema = configurationSchemas.Project;
      } else if (change.resource === "scratch") {
        collection = next.scratchTasks;
        schema = configurationSchemas.ScratchTask;
      } else if (change.resource === "ui_view") {
        next.uiViews ||= [];
        collection = next.uiViews;
        schema = configurationSchemas.UIView;
      } else {
        const p = next.projects.find((x: any) => x.id === change.projectId);
        if (!p) fail(404, "Project not found");
        touched.add(p.id);
        if (change.resource === "node") {
          p.milestones ||= [];
          collection = p.milestones;
          schema = configurationSchemas.Node;
        } else if (change.resource === "subtask") {
          const n = p.milestones.find((x: any) => x.id === change.nodeId);
          if (!n) fail(404, "Node not found");
          n.subtasks ||= [];
          collection = n.subtasks;
          schema = configurationSchemas.Subtask;
        } else fail(422, "Unknown configuration resource");
      }
      const id = change.id || change.value?.id;
      if (typeof id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(id))
        fail(422, "A stable resource id is required");
      const index = collection.findIndex((x) => x.id === id);
      if (change.operation === "create" && index >= 0)
        fail(409, "Resource already exists");
      if (change.operation !== "create" && index < 0)
        fail(404, "Resource not found");
      if (change.resource === "project") touched.add(id);
      if (change.operation === "delete") {
        collection.splice(index, 1);
      } else {
        const value = change.value;
        if (
          change.operation === "update" &&
          ((change.resource === "project" && value?.milestones !== undefined) ||
            (change.resource === "node" && value?.subtasks !== undefined))
        )
          fail(
            422,
            "Use node/subtask commands to edit collections without replacing runtime state",
          );
        if (!value || typeof value !== "object" || Array.isArray(value))
          fail(422, "value must be an object");
        if (
          change.resource === "project" &&
          Object.keys(value.projectData || {}).some(reservedDataKey)
        )
          fail(422, "Reserved runtime or authority project data field");
        if (value.id !== undefined && value.id !== id)
          fail(422, "Resource identity cannot change");
        const issues = checkSchema(
          {
            ...schema,
            required: change.operation === "create" ? schema.required : [],
          },
          { ...value, ...(change.operation === "create" ? { id } : {}) },
        );
        if (issues.length) fail(422, JSON.stringify(issues));
        // Nested configuration objects merge only their allowed fields; persisted runtime fields survive.
        const merge = (base: any, patch: any): any =>
          Object.fromEntries(
            Object.entries({ ...base, ...patch }).map(([k, v]) => [
              k,
              patch[k] &&
              typeof patch[k] === "object" &&
              !Array.isArray(patch[k])
                ? merge(base?.[k] || {}, patch[k])
                : v,
            ]),
          );
        const result = merge(index >= 0 ? collection[index] : {}, {
          ...value,
          id,
        });
        removeFields(result, schema);
        if (change.resource === "scratch" && change.operation === "create")
          Object.assign(result, { createdBy: "api", createdAt: 0 });
        if (change.resource === "project" && change.operation === "create")
          Object.assign(result, {
            milestones: result.milestones || [],
            company: result.company || "",
            type: result.type || "Project",
            startDate: result.startDate || 0,
            createdAt: 0,
            updatedAt: 0,
            revision: 0,
          });
        if (change.resource === "node" && change.operation === "create")
          Object.assign(result, {
            subtasks: result.subtasks || [],
            dependsOn: result.dependsOn || [],
            estimatedDuration: result.estimatedDuration || 0,
          });
        if (change.operation === "create") {
          const taskDefaults = (task: any) =>
            Object.assign(task, {
              assignedTo: task.assignedTo ?? "",
              description: task.description ?? "",
              status: task.status ?? "Not started",
            });
          const nodeDefaults = (node: any) => {
            Object.assign(node, {
              subtasks: node.subtasks || [],
              dependsOn: node.dependsOn || [],
              estimatedDuration: node.estimatedDuration ?? 0,
            });
            node.subtasks.forEach(taskDefaults);
          };
          if (change.resource === "project")
            result.milestones.forEach(nodeDefaults);
          if (change.resource === "node") nodeDefaults(result);
          if (change.resource === "subtask") taskDefaults(result);
        }
        if (index < 0) collection.push(result);
        else collection[index] = result;
      }
    }
    diff.push({
      resource: change.resource,
      operation: change.operation,
      id: change.id || change.value?.id || "settings",
      projectId: change.projectId,
      changed: hash(before) !== hash(next),
    });
  }
  if (next.scratchTasks.length > 1000) fail(422, "Scratch task limit is 1000");
  if (next.projects.length > 500) fail(422, "Project limit is 500");
  if ((next.uiViews || []).length > 100) fail(422, "Saved view limit is 100");
  const issues: Issue[] = [];
  for (const p of next.projects)
    if (touched.has(p.id))
      issues.push(
        ...validateProject(projectConfiguration(p)).map((x) => ({
          ...x,
          path: p.id + "/" + x.path,
        })),
      );
  for (const view of [...(next.uiViews || []), ...next.scratchTasks])
    if (
      view.projectId &&
      !next.projects.some((p: any) => p.id === view.projectId)
    )
      issues.push({
        path: "uiViews/" + view.id,
        message: "Project does not exist",
      });
  const effects = next.projects
    .filter((p: any) => touched.has(p.id))
    .flatMap((p: any) =>
      (p.milestones || [])
        .filter(
          (n: any) =>
            ACTION_TASK_TYPE[n.nodeType as keyof typeof ACTION_TASK_TYPE],
        )
        .map((n: any) => ({
          projectId: p.id,
          nodeId: n.id,
          taskType:
            ACTION_TASK_TYPE[n.nodeType as keyof typeof ACTION_TASK_TYPE],
          willExecute: false,
        })),
    );
  return {
    valid: issues.length === 0,
    issues,
    diff,
    effects,
    expectedRevision: current.dataRevision,
    planHash: hash({ revision: current.dataRevision, changes: input.changes }),
    next,
    touched: [...touched],
  };
}
export function applyConfiguration(
  raw: any,
  input: ConfigurationRequest,
  actor: { uid: string; apiClientId?: string },
  now = Date.now(),
) {
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(input.requestId || ""))
    fail(422, "A stable requestId of 8–100 characters is required");
  const fingerprint = hash({
    changes: input.changes,
    expectedRevision: input.expectedRevision,
    planHash: input.planHash,
    actor,
  });
  const current = workspaceView(raw);
  const receipts = current.configurationReceipts || {};
  const prior = receipts[input.requestId!];
  if (prior) {
    if (prior.fingerprint !== fingerprint)
      fail(409, "requestId belongs to different changes or actor");
    return { next: current, receipt: prior, duplicate: true };
  }
  if (Object.keys(receipts).length >= 1000)
    fail(
      409,
      "Configuration receipt limit reached; administrator retention review required",
    );
  const plan = planConfiguration(current, input);
  if (!plan.valid) fail(422, JSON.stringify(plan.issues));
  if (!input.planHash || input.planHash !== plan.planHash)
    fail(409, "Apply the exact reviewed planHash");
  const next = plan.next;
  next.dataRevision = current.dataRevision + 1;
  next.lastUpdated = now;
  for (const p of next.projects)
    if (plan.touched.includes(p.id)) {
      p.revision = Number(p.revision || 0) + 1;
      p.updatedAt = now;
      if (!p.createdAt) p.createdAt = now;
    }
  const receipt = {
    id: input.requestId,
    fingerprint,
    planHash: plan.planHash,
    revision: next.dataRevision,
    at: now,
    actor: actor.uid,
    clientId: actor.apiClientId || null,
    diff: plan.diff,
  };
  for (const change of input.changes)
    if (change.resource === "scratch" && change.operation === "create") {
      const task = next.scratchTasks.find(
        (t: any) => t.id === (change.id || change.value?.id),
      );
      if (task) {
        task.createdAt = now;
        task.createdBy = actor.uid;
      }
    }
  next.configurationReceipts = { ...receipts, [input.requestId!]: receipt };
  if (Buffer.byteLength(JSON.stringify(next)) > 3800000)
    fail(413, "Workspace exceeds 3.8 MB");
  return { next, receipt, duplicate: false };
}
