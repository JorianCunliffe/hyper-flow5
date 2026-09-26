import { requestScope } from "../tenantControl/clients.js";
import { taskContracts } from "./taskContracts.js";
import manifest from "../../contracts/route-manifest.json";
import phase01 from "../../contracts/phase01.openapi.json";
import phase02 from "../../contracts/phase02.openapi.json";
import phase11 from "../../contracts/phase11.openapi.json";
import { configurationSchemas } from "../configuration/schema.js";
import { TASK_TYPES } from "../taskTypes.js";
const string = { type: "string" },
  integer = { type: "integer" },
  object = { type: "object", additionalProperties: true };
const body = (schema: any) => ({
  required: true,
  content: { "application/json": { schema } },
});
const json = (schema: any) => ({ content: { "application/json": { schema } } });
export const domainOperations: Record<string, string[]> = {
  "/api/flows": [
    "compile",
    "create",
    "revise",
    "approve",
    "reject",
    "start",
    "advance",
    "pause",
    "resume",
    "cancel",
    "review",
    "promote",
    "migrate",
    "answer_update",
    "reconcile",
    "reconcile_artifact",
    "reconcile_publication",
  ],
  "/api/calendar": [
    "configure",
    "observe",
    "prepare",
    "propose",
    "approve",
    "reject",
    "execute",
    "reconcile",
    "sync_context",
  ],
  "/api/artifacts": [
    "configure_sheet",
    "save_template",
    "create_flow",
    "prepare",
    "draft_flow",
    "propose_sheet",
    "approve_sheet",
    "export_sheet",
    "reconcile_sheet",
    "approve",
    "reject",
    "review",
    "reconcile",
    "generate",
  ],
  "/api/publishing": [
    "configure_target",
    "create",
    "edit",
    "preview",
    "approve",
    "reject",
    "publish",
    "reconcile",
    "draft_flow",
  ],
  "/api/files": ["start", "chunk", "reconcile", "delete"],
  "/api/cockpit": ["configure", "template", "schedule", "question"],
  "/api/captured-work-items": ["capture", "resolve", "dismiss"],
  "/api/configuration": ["validate", "plan", "apply"],
};
const opFields: Record<string, any> = {
  operation: string,
  id: string,
  projectId: string,
  nodeId: string,
  runId: string,
  askId: string,
  version: integer,
  expectedRevision: integer,
  revision: integer,
  hash: string,
  runKey: string,
  prompt: string,
  plan: object,
  note: string,
  communicationId: string,
  templateId: string,
  templateVersion: integer,
  calendarKey: string,
  connectionId: string,
  eventId: string,
  proposalId: string,
  change: object,
  policy: object,
  inputHash: string,
  template: object,
  content: object,
  target: object,
  contentHash: string,
  publicUseChecked: { type: "boolean" },
  name: string,
  kind: string,
  sourceNotes: {},
  windowDays: integer,
};
const changeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["resource", "operation"],
  properties: {
    resource: {
      enum: ["project", "node", "subtask", "settings", "ui_view", "scratch"],
    },
    operation: { enum: ["create", "update", "delete"] },
    id: string,
    projectId: string,
    nodeId: string,
    unset: { type: "array", maxItems: 50, items: string },
    value: {
      anyOf: Object.values(configurationSchemas).map((s) => ({
        ...s,
        required: [],
      })),
    },
  },
};
export function buildOpenApi() {
  const schemas: any = {
    ...Object.fromEntries(
      Object.entries(taskContracts).map(([name, contract]) => [
        name + "Template",
        contract.inputSchema,
      ]),
    ),
    ...configurationSchemas,
    Error: {
      type: "object",
      required: ["error"],
      properties: { error: string, code: string, details: {} },
    },
    Change: changeSchema,
    ConfigurationRequest: {
      type: "object",
      required: ["operation", "expectedRevision", "changes"],
      properties: {
        operation: { enum: ["validate", "plan", "apply"] },
        expectedRevision: integer,
        requestId: { type: "string", pattern: "^[A-Za-z0-9_-]{8,100}$" },
        planHash: string,
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { $ref: "#/components/schemas/Change" },
        },
      },
    },
    Fixture: {
      type: "object",
      required: ["status"],
      properties: {
        status: { enum: ["success", "error", "pending"] },
        output: {},
        error: string,
      },
    },
    Assertion: {
      type: "object",
      required: ["path", "operator"],
      properties: {
        path: string,
        operator: { enum: ["equals", "exists"] },
        expected: {},
      },
    },
    TestRequest: {
      type: "object",
      required: [
        "requestId",
        "projectId",
        "expectedRevision",
        "fixtures",
        "assertions",
      ],
      properties: {
        requestId: string,
        projectId: string,
        expectedRevision: integer,
        inputs: object,
        fixtures: {
          type: "object",
          additionalProperties: { $ref: "#/components/schemas/Fixture" },
        },
        assertions: {
          type: "array",
          minItems: 1,
          maxItems: 100,
          items: { $ref: "#/components/schemas/Assertion" },
        },
        maxRounds: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
  };
  const reference = (name: string) => ({
    $ref: "#/components/schemas/" + name,
  });
  const array = (items: any) => ({ type: "array", items });
  Object.assign(schemas, {
    ConfigurationDiff: {
      type: "object",
      required: ["resource", "operation", "id", "changed"],
      properties: {
        resource: string,
        operation: string,
        id: string,
        projectId: string,
        changed: { type: "boolean" },
      },
    },
    ConfigurationReceipt: {
      type: "object",
      required: ["id", "planHash", "revision", "at", "actor", "diff"],
      properties: {
        id: string,
        fingerprint: string,
        planHash: string,
        revision: integer,
        at: integer,
        actor: string,
        clientId: { type: ["string", "null"] },
        diff: array(reference("ConfigurationDiff")),
      },
    },
    ConfigurationSnapshot: {
      type: "object",
      required: ["revision", "projects", "settings", "uiViews", "scratchTasks"],
      properties: {
        revision: integer,
        projects: array(reference("Project")),
        settings: reference("Settings"),
        uiViews: array(reference("UIView")),
        scratchTasks: array(reference("ScratchTask")),
      },
    },
    ConfigurationPlan: {
      type: "object",
      required: [
        "valid",
        "issues",
        "diff",
        "effects",
        "expectedRevision",
        "planHash",
        "sideEffects",
      ],
      properties: {
        valid: { type: "boolean" },
        issues: array({
          type: "object",
          required: ["path", "message"],
          properties: { path: string, message: string },
        }),
        diff: array(reference("ConfigurationDiff")),
        effects: array({
          type: "object",
          properties: {
            projectId: string,
            nodeId: string,
            taskType: string,
            willExecute: { const: false },
          },
        }),
        expectedRevision: integer,
        planHash: string,
        sideEffects: { const: false },
        providerReadiness: { const: "not_checked" },
        preflight: object,
      },
    },
    ConfigurationApplied: {
      type: "object",
      required: ["receipt", "revision"],
      properties: {
        receipt: reference("ConfigurationReceipt"),
        revision: integer,
      },
    },
    TestResult: {
      type: "object",
      required: [
        "mode",
        "providerCalls",
        "status",
        "assertions",
        "nodes",
        "dispatches",
        "missingFixtures",
        "log",
        "limitations",
      ],
      properties: {
        mode: { const: "simulation" },
        providerCalls: { const: 0 },
        status: { enum: ["passed", "failed", "held"] },
        assertions: array({
          type: "object",
          required: ["path", "operator", "actual", "passed"],
          properties: {
            path: string,
            operator: { enum: ["equals", "exists"] },
            expected: {},
            actual: {},
            passed: { type: "boolean" },
          },
        }),
        nodes: array(object),
        dispatches: array(object),
        missingFixtures: array(string),
        log: array(string),
        limitations: array(string),
      },
    },
    TestRun: {
      type: "object",
      required: ["id", "projectId", "revision", "actor", "at", "result"],
      properties: {
        id: string,
        projectId: string,
        revision: integer,
        actor: string,
        clientId: { type: ["string", "null"] },
        at: integer,
        fingerprint: string,
        result: reference("TestResult"),
      },
    },
  });
  const paths: any = {};
  for (const row of manifest) {
    const method = row.method.toLowerCase();
    let supplement: any = {};
    for (const fragment of [phase01, phase02, phase11]) {
      const found = (fragment.paths as any)[row.path]?.[method];
      if (found) supplement = structuredClone(found);
      Object.assign(schemas, (fragment.components as any)?.schemas || {});
    }
    const op: any = {
      ...supplement,
      operationId: method + "_" + row.path.replace(/[^A-Za-z0-9]+/g, "_"),
      summary: row.description,
      description: row.description + "\nAuthority: " + row.authorization,
      security: [{ FirebaseBearer: [] }, { ApiClientBearer: [] }],
      "x-source": row.source,
      "x-authority": row.authorization,
      responses: {
        ...supplement.responses,
        "200": {
          description:
            "Operation result. A pending/held result is not proof of completion.",
          ...json(object),
          ...supplement.responses?.["200"],
        },
        ...Object.fromEntries(
          [400, 401, 403, 404, 409, 413, 422, 429, 503].map((c) => [
            c,
            {
              description: (
                {
                  400: "Invalid request",
                  401: "Authentication required",
                  403: "Authority denied",
                  404: "Not found",
                  409: "Revision/state conflict; read and reconcile",
                  413: "Request/result limit exceeded",
                  422: "Validation failed",
                  429: "Request budget exhausted",
                  503: "Dependency unavailable",
                } as any
              )[c],
              ...json({ $ref: "#/components/schemas/Error" }),
            },
          ]),
        ),
      },
    };
    try {
      op["x-required-scope"] = requestScope({
        url: row.path,
        method: row.method,
      });
    } catch {
      op["x-required-scope"] = "human-or-service";
    }
    if (row.path === "/api/configuration")
      op["x-operation-scopes"] = {
        plan: "configuration:read",
        validate: "configuration:read",
        apply: "configuration:write",
      };
    op.parameters = op.parameters || [];
    for (const match of row.path.matchAll(/\{([^}]+)\}/g))
      if (
        !op.parameters.some((p: any) => p.in === "path" && p.name === match[1])
      )
        op.parameters.push({
          name: match[1],
          in: "path",
          required: true,
          schema: string,
        });
    if (method === "get")
      for (const name of [
        "id",
        "projectId",
        "nodeId",
        "view",
        "operation",
        "after",
        "limit",
        "offset",
        "connectionId",
        "calendarKey",
        "start",
        "end",
        "shape",
        "reason",
        "requestId",
      ])
        if (!op.parameters.some((p: any) => p.name === name))
          op.parameters.push({
            name,
            in: "query",
            schema: string,
            description:
              "Used where applicable; see operation description and domain guide.",
          });
    if (["post", "put", "patch", "delete"].includes(method) && !op.requestBody)
      op.requestBody = body(object);
    if (domainOperations[row.path] && method === "post") {
      op["x-operations"] = domainOperations[row.path];
      op.requestBody = body({
        oneOf: domainOperations[row.path].map((operation) => ({
          type: "object",
          required: ["operation"],
          properties: { ...opFields, operation: { const: operation } },
          additionalProperties: true,
        })),
      });
    }
    if (row.path === "/api/commitments")
      op["x-operation-groups"] = {
        obligation: [
          "terms",
          "respond",
          "progress",
          "submit",
          "dispute",
          "cancel",
          "dismiss",
          "follow_up",
        ],
        promise_ledger: [
          "query",
          "read",
          "coverage",
          "review",
          "link",
          "create",
          "update",
          "delete",
          "condition_create",
          "condition_update",
          "condition_delete",
          "evidence_add",
        ],
        operational_review: [
          "work",
          "start",
          "read",
          "advance",
          "respond",
          "action",
        ],
      };
    if (row.path === "/api/tasks/execute")
      op["x-task-contracts"] = taskContracts;
    if (row.path === "/api/tasks/execute")
      op.requestBody = body({
        type: "object",
        required: ["taskType", "templateFile", "correlation"],
        properties: {
          taskType: { enum: [...TASK_TYPES] },
          templateFile: string,
          projectData: object,
          revision: object,
          correlation: {
            type: "object",
            required: ["projectId", "nodeId", "runId"],
            properties: {
              orgId: string,
              projectId: string,
              nodeId: string,
              runId: string,
            },
          },
        },
      });
    if (row.path === "/api/configuration" && method === "post")
      op.requestBody = body({
        $ref: "#/components/schemas/ConfigurationRequest",
      });
    if (row.path === "/api/test-runs" && method === "post")
      op.requestBody = body({ $ref: "#/components/schemas/TestRequest" });
    if (
      [
        "/api/projects",
        "/api/nodes",
        "/api/subtasks",
        "/api/settings",
        "/api/ui-views",
        "/api/scratch-tasks",
      ].includes(row.path) &&
      method !== "get"
    ) {
      const ref = (
        {
          "/api/projects": "Project",
          "/api/nodes": "Node",
          "/api/subtasks": "Subtask",
          "/api/settings": "Settings",
          "/api/ui-views": "UIView",
          "/api/scratch-tasks": "ScratchTask",
        } as any
      )[row.path];
      op.requestBody = body({
        type: "object",
        required: [
          "expectedRevision",
          "requestId",
          "planHash",
          ...(method === "delete" ? ["id"] : ["value"]),
        ],
        properties: {
          expectedRevision: integer,
          requestId: string,
          planHash: string,
          id: string,
          projectId: string,
          nodeId: string,
          unset: { type: "array", maxItems: 50, items: string },
          value:
            method === "post"
              ? { $ref: "#/components/schemas/" + ref }
              : {
                  ...configurationSchemas[
                    ref as keyof typeof configurationSchemas
                  ],
                  required: [],
                },
        },
      });
    }
    if (row.path === "/api/configuration")
      op.responses["200"] = {
        description:
          "Configuration snapshot/receipt or planned/applied changes",
        ...json({
          oneOf:
            method === "get"
              ? [
                  reference("ConfigurationSnapshot"),
                  {
                    type: "object",
                    required: ["receipt"],
                    properties: { receipt: reference("ConfigurationReceipt") },
                  },
                ]
              : [
                  reference("ConfigurationPlan"),
                  reference("ConfigurationApplied"),
                ],
        }),
      };
    if (row.path === "/api/test-runs") {
      if (method === "post")
        op.responses["200"] = {
          description: "Persisted fixture result",
          ...json({
            type: "object",
            required: ["item"],
            properties: {
              item: reference("TestRun"),
              duplicate: { type: "boolean" },
            },
          }),
        };
      if (method === "delete") {
        op.requestBody = body({
          type: "object",
          required: ["id"],
          properties: { id: string },
        });
        op.responses["200"] = {
          description: "Test removed",
          ...json({
            type: "object",
            required: ["id", "deleted"],
            properties: { id: string, deleted: { const: true } },
          }),
        };
      }
    }
    if (row.path === "/api/schedules" && method === "delete")
      op.responses = {
        "204": { description: "Deleted; response has no body" },
        ...Object.fromEntries(
          Object.entries(op.responses).filter(([k]) => k !== "200"),
        ),
      };
    if (
      row.authorization.includes("Human") ||
      row.path.startsWith("/api/invites") ||
      row.path === "/api/organizations/create"
    )
      op.security = [{ FirebaseBearer: [] }];
    if (["/api/events", "/api/agent/voice-context", "/api/agent/capture-work"].includes(row.path))
      op.security = [{ CommunicationsSignature: [] }];
    if (row.path === "/api/schedules/tick")
      op.security = [
        { SchedulerSecret: [] },
        { CronSecret: [] },
        { CommunicationsSignature: [] },
      ];
    if (row.path === "/api/flow/advance")
      op.security.push({ WebhookSecret: [] });
    if (row.path.includes("{token}")) op.security = [];
    if (row.path.endsWith("/callback")) op.security = [];
    paths[row.path] ||= {};
    paths[row.path][method] = op;
  }
  return {
    openapi: "3.1.0",
    info: {
      title: "HyperFlow public API",
      version: "1.0.0",
      description:
        "Unified Express/Vercel surface. Read-only discovery requires tenant authentication. Existing domain ledgers retain their own lifecycle and provider constraints. Configuration fields are validated and fixture test schemas are explicit; legacy domain envelopes are extensible and their detailed rules remain in linked domain guides.",
    },
    servers: [{ url: "/", description: "Current deployment origin" }],
    paths,
    components: {
      schemas,
      securitySchemes: {
        FirebaseBearer: {
          type: "http",
          scheme: "bearer",
          description: "Firebase ID token",
        },
        ApiClientBearer: {
          type: "http",
          scheme: "bearer",
          description:
            "hf.<organization>.<client-id>.<secret>; explicit operation scope plus current issuer membership",
        },
        CommunicationsSignature: {
          type: "apiKey",
          in: "header",
          name: "x-communications-signature-v2",
          description:
            "Also requires x-communications-timestamp; signs exact request bytes",
        },
        WebhookSecret: {
          type: "apiKey",
          in: "header",
          name: "x-webhook-secret",
        },
        CronSecret: {
          type: "http",
          scheme: "bearer",
          description: "Platform CRON_SECRET",
        },
        SchedulerSecret: {
          type: "apiKey",
          in: "header",
          name: "x-hyperflow-scheduler-secret",
        },
      },
    },
  };
}
