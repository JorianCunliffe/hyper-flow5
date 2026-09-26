import { NodeType } from "../../types.js";
import { TASK_TYPES } from "../taskTypes.js";
export type Schema = Record<string, any>;
const str: Schema = { type: "string", maxLength: 20000 };
const id: Schema = { type: "string", pattern: "^[A-Za-z0-9_-]{1,128}$" };
const num: Schema = { type: "number" };
const bool: Schema = { type: "boolean" };
const arr = (items: Schema, maxItems = 500): Schema => ({
  type: "array",
  items,
  maxItems,
});
const obj = (
  properties: Record<string, Schema>,
  required: string[] = [],
): Schema => ({
  type: "object",
  properties,
  required,
  additionalProperties: false,
});
const strings = arr(str);
export const views = [
  "captures",
  "projects",
  "kanban",
  "scratch",
  "feed",
  "approvals",
  "reports",
  "activity",
  "obligations",
  "meetings",
  "flows",
  "cockpit",
  "diary",
  "artifacts",
  "publishing",
  "tenant",
];
const condition = obj(
  { variable: str, equals: {}, notEquals: {}, oneOf: arr({}), exists: bool },
  ["variable"],
);
export const taskSchema = obj(
  {
    id,
    name: str,
    displayId: str,
    assignedTo: str,
    role: str,
    description: str,
    notes: str,
    status: str,
    link: str,
    accountable: str,
    consulted: strings,
    informed: strings,
    requiresApproval: bool,
    taskType: { enum: [...TASK_TYPES] },
    templateFile: str,
    dependsOn: arr(id),
    readyConditions: arr(condition),
    outputLocation: str,
    outputVariables: arr(
      obj(
        { name: str, type: str, write_on: str, value_source: str, value: {} },
        ["name"],
      ),
    ),
    estimatedTime: num,
    timeUnit: { enum: ["hours", "days", "weeks"] },
    dueDate: num,
    isImportant: bool,
    isToday: bool,
  },
  ["id", "name"],
);
const human = obj({
  kind: { enum: ["approval", "question", "form", "artifact_review", "update"] },
  prompt: str,
  fields: arr({ type: "object" }),
  fieldsSource: str,
  assignees: strings,
  channels: arr({ enum: ["web", "email", "sms", "voice"] }),
  responsePolicy: { enum: ["any", "all", "quorum"] },
  quorum: num,
  escalation: obj({
    primaryPersonId: str,
    fallbackPersonId: str,
    retryMinutes: num,
    repeatLocalTime: str,
    timezone: str,
    daysOfWeek: arr({ type: "integer", minimum: 0, maximum: 6 }, 7),
  }),
});
export const nodeSchema = obj(
  {
    id,
    name: str,
    nodeType: { enum: Object.values(NodeType) },
    subtasks: arr(taskSchema),
    dependsOn: arr(id),
    estimatedDuration: num,
    x: num,
    y: num,
    actionConfig: obj({
      template: str,
      autoExecute: bool,
      failureMode: { enum: ["block", "continue"] },
      resultVariable: {
        type: "string",
        pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$",
      },
      requiredResults: strings,
      forEach: obj(
        {
          source: str,
          key: str,
          maxItems: { type: "integer", minimum: 1, maximum: 1000 },
        },
        ["source", "key"],
      ),
    }),
    decisionConfig: obj({
      branches: arr(
        obj({ targetId: id, label: str, conditions: arr(condition) }, [
          "targetId",
          "label",
        ]),
      ),
    }),
    loopConfig: obj({
      loopStartId: id,
      exitConditions: arr(condition),
      maxIterations: { type: "integer", minimum: 1, maximum: 1000 },
      maxDurationMinutes: { type: "number", minimum: 0 },
    }),
    waitConfig: obj({
      kind: { const: "timer" },
      durationMinutes: { type: "number", minimum: 0 },
      reason: str,
      maxResumes: num,
    }),
    holdConfig: obj({
      kind: { enum: ["timer", "event", "human", "provider"] },
      durationMinutes: num,
      timeoutMinutes: num,
      reason: str,
      resultVariable: str,
      payloadVariable: str,
      match: obj({
        eventTypes: strings,
        channels: strings,
        directions: strings,
        personIds: strings,
        askIds: strings,
        providerServices: strings,
        actionRunIds: strings,
        externalIds: strings,
      }),
      human,
    }),
    eventTriggerConfig: obj({
      eventTypes: strings,
      channels: strings,
      directions: strings,
      personIds: strings,
      payloadVariable: str,
    }),
    reviewPolicy: obj({
      required: bool,
      when: arr(condition),
      reviewers: strings,
      channels: strings,
      slaHours: num,
      onExpiry: { enum: ["block", "escalate"] },
      maxRevisions: num,
      responsePolicy: { enum: ["any", "all", "quorum"] },
      quorum: num,
    }),
    captureReviewConfig: obj({
      scope: { enum: ["current_run", "current_project", "user_unresolved"] },
      maxItems: { type: "integer", minimum: 1, maximum: 20 },
      includeOlderItems: bool,
      capturedForUserId: str,
    }),
  },
  ["id", "name"],
);
export const projectSchema = obj(
  {
    id,
    name: str,
    displayId: str,
    company: str,
    type: str,
    startDate: num,
    timeUnit: { enum: ["hours", "days", "weeks"] },
    timeBuffer: num,
    milestones: arr(nodeSchema),
    markers: arr(obj({ id, name: str, x: num }, ["id", "name", "x"])),
    isArchived: bool,
    projectData: { type: "object" },
    cashRequirement: num,
    debtRequirement: num,
    valueAtCompletion: num,
    profit: num,
  },
  ["id", "name"],
);
export const settingsSchema = obj({
  projectTypes: strings,
  companies: strings,
  people: strings,
  roles: strings,
  statuses: strings,
  dateFormat: { enum: ["DD/MM/YY", "MM/DD/YY"] },
  teamMemberDetails: {
    type: "object",
    additionalProperties: obj({ email: str, phone: str }),
  },
});
export const uiViewSchema = obj(
  {
    id,
    name: str,
    view: { enum: views },
    projectId: id,
    showSubtasks: bool,
    showMinimap: bool,
    showProjectPanel: bool,
    kanbanGrouping: { enum: ["project", "member"] },
    filters: obj({
      member: str,
      role: str,
      important: bool,
      today: bool,
      late: bool,
    }),
    zoom: { type: "number", minimum: 0.1, maximum: 3 },
  },
  ["id", "name", "view"],
);
export const scratchSchema = obj({ id, name: str, projectId: id }, [
  "id",
  "name",
]);
export const configurationSchemas = {
  ScratchTask: scratchSchema,
  Project: projectSchema,
  Node: nodeSchema,
  Subtask: taskSchema,
  Settings: settingsSchema,
  UIView: uiViewSchema,
};
export type Issue = { path: string; message: string };
/** Small JSON-schema subset used by all configuration commands and published unchanged. */
export function checkSchema(
  schema: Schema,
  value: any,
  path = "",
  issues: Issue[] = [],
): Issue[] {
  if (schema.const !== undefined && value !== schema.const)
    issues.push({ path, message: "Unexpected constant" });
  if (schema.enum && !schema.enum.includes(value))
    issues.push({ path, message: "Choose one of " + schema.enum.join(", ") });
  if (schema.type) {
    const type = Array.isArray(value)
      ? "array"
      : value === null
        ? "null"
        : typeof value;
    const ok =
      schema.type === "integer"
        ? Number.isInteger(value)
        : schema.type === type;
    if (!ok) {
      issues.push({ path, message: "Expected " + schema.type });
      return issues;
    }
  }
  if (
    typeof value === "number" &&
    (!Number.isFinite(value) ||
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum))
  )
    issues.push({ path, message: "Number outside allowed bounds" });
  if (
    typeof value === "string" &&
    ((schema.maxLength && value.length > schema.maxLength) ||
      (schema.pattern && !new RegExp(schema.pattern).test(value)))
  )
    issues.push({ path, message: "Invalid string format or length" });
  if (Array.isArray(value)) {
    if (schema.maxItems && value.length > schema.maxItems)
      issues.push({ path, message: "Too many items" });
    value.forEach((v, i) =>
      checkSchema(schema.items || {}, v, `${path}/${i}`, issues),
    );
  } else if (value && typeof value === "object") {
    for (const key of schema.required || [])
      if (value[key] === undefined)
        issues.push({ path: path + "/" + key, message: "Required" });
    for (const [key, v] of Object.entries(value)) {
      if (
        ["__proto__", "prototype", "constructor"].includes(key) ||
        /[.#$\[\]/]/.test(key)
      ) {
        issues.push({ path: path + "/" + key, message: "Unsafe field name" });
        continue;
      }
      const child = schema.properties?.[key];
      if (!child && schema.additionalProperties === false)
        issues.push({
          path: path + "/" + key,
          message: "Unknown or server-owned field",
        });
      else
        checkSchema(
          child ||
            (typeof schema.additionalProperties === "object"
              ? schema.additionalProperties
              : {}),
          v,
          path + "/" + key,
          issues,
        );
    }
  }
  return issues;
}
/** Read-only projection omits runtime results, Ask tokens and integration authority fields. */
export function projectConfiguration(project: any) {
  const pick = (value: any, schema: Schema): any => {
    if (Array.isArray(value))
      return value.map((v) => pick(v, schema.items || {}));
    if (!value || typeof value !== "object") return value;
    return Object.fromEntries(
      Object.entries(value)
        .filter(([k]) => !schema.properties || schema.properties[k])
        .map(([k, v]) => [k, pick(v, schema.properties?.[k] || {})]),
    );
  };
  const result = pick(project, projectSchema);
  result.milestones ||= [];
  result.projectData = Object.fromEntries(
    Object.entries(result.projectData || {}).filter(
      ([k]) => !reservedDataKey(k),
    ),
  );
  return result;
}
export const reservedDataKey = (k: string) =>
  /^(flow_|schedule_|capture_review_|communications_|email_sending_)/.test(k) ||
  ["__proto__", "constructor", "prototype"].includes(k);
