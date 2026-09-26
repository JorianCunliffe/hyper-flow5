import test from "node:test";
import {handleCommitments} from "../lib/commitments/api.js";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import express from "express";
import { mountApi } from "../lib/http/express.js";
import { requestScope } from "../lib/tenantControl/clients.js";
import { assertHumanDecision } from "../lib/http/authority.js";
import { HyperFlowClient } from "../lib/client/hyperflow.js";
import {
  applyConfiguration,
  planConfiguration,
  validateProject,
} from "../lib/configuration/model.js";
import { handleConfiguration } from "../lib/configuration/api.js";
import {
  handleTestRuns,
  simulateProject,
} from "../lib/configuration/testRuns.js";
import { buildOpenApi } from "../lib/http/openapi.js";
import { handleVisibleFlows } from "../lib/visibleFlows/api.js";
import { replaceWorkspace } from "../lib/tenantControl/workspace.js";
const actor = { uid: "human", orgId: "tenant-a", apiClientId: "client-agent" };
const changes: any[] = [
  {
    resource: "project",
    operation: "create",
    value: {
      id: "p",
      name: "Agent fixture",
      milestones: [
        {
          id: "read",
          name: "Read",
          nodeType: "google_doc",
          actionConfig: {
            template: '{"documentId":"fixture-document"}',
            autoExecute: true,
            resultVariable: "read_result",
          },
          dependsOn: [],
          subtasks: [],
        },
        {
          id: "write",
          name: "Report",
          nodeType: "report",
          actionConfig: {
            template: '{"prompt":"Summarize {{text}}"}',
            autoExecute: true,
            requiredResults: ["read_result"],
          },
          dependsOn: ["read"],
          subtasks: [],
        },
      ],
    },
  },
];
const input = { expectedRevision: 0, changes, requestId: "configuration_001" };
const planned = planConfiguration(null, input);
const applied = applyConfiguration(
  null,
  { ...input, planHash: planned.planHash },
  actor,
  100,
);
test("configuration applies atomic changes, preserves unrelated data, detects conflicts and replays exactly", () => {
  assert.equal(planned.valid, true);
  assert.equal(planned.effects.length, 2);
  assert.equal(applied.next.dataRevision, 1);
  assert.equal(applied.receipt.clientId, "client-agent");
  assert.equal(
    applyConfiguration(
      applied.next,
      { ...input, planHash: planned.planHash },
      actor,
    ).duplicate,
    true,
  );
  assert.throws(
    () =>
      applyConfiguration(
        applied.next,
        { ...input, changes: [], planHash: planned.planHash },
        actor,
      ),
    /requestId/,
  );
  assert.throws(
    () =>
      applyConfiguration(
        applied.next,
        { ...input, requestId: "new_request", planHash: planned.planHash },
        actor,
      ),
    /Workspace changed/,
  );
  assert.throws(
    () => applyConfiguration(null, { ...input, planHash: "wrong" }, actor),
    /exact reviewed/,
  );
  const current = {
    ...applied.next,
    scratchTasks: [{ id: "keep" }],
    activityLogs: [{ id: "history" }],
  };
  const edit: any = {
    expectedRevision: 1,
    requestId: "edit_settings",
    changes: [
      {
        resource: "settings",
        operation: "update",
        value: { dateFormat: "DD/MM/YY" },
      },
    ],
  };
  const plan = planConfiguration(current, edit);
  const out = applyConfiguration(
    current,
    { ...edit, planHash: plan.planHash },
    actor,
  );
  assert.deepEqual(out.next.scratchTasks, current.scratchTasks);
  assert.deepEqual(out.next.activityLogs, current.activityLogs);
});
test("configuration rejects malformed graphs, runtime/authority fields and unsafe collection replacement", () => {
  assert.ok(
    validateProject({
      id: "p",
      name: "p",
      milestones: [{ id: "a", name: "A", nodeType: "fake" }],
    }).length,
  );
  assert.ok(
    validateProject({
      id: "p",
      name: "p",
      milestones: [{ id: "a", name: "A", dependsOn: ["b"] }],
    }).length,
  );
  assert.ok(
    validateProject({
      id: "p",
      name: "p",
      milestones: [
        { id: "a", name: "A", dependsOn: ["b"] },
        { id: "b", name: "B", dependsOn: ["a"] },
      ],
    }).length,
  );
  assert.throws(
    () =>
      planConfiguration(null, {
        expectedRevision: 0,
        changes: [
          {
            resource: "project",
            operation: "create",
            value: { id: "p", name: "P", emailSendingEnabled: true },
          },
        ],
      }),
    /server-owned/,
  );
  assert.throws(
    () =>
      planConfiguration(applied.next, {
        expectedRevision: 1,
        changes: [
          {
            resource: "node",
            operation: "update",
            projectId: "p",
            id: "read",
            value: { actionConfig: { lastRun: { status: "success" } } },
          },
        ],
      }),
    /server-owned/,
  );
  assert.throws(
    () =>
      planConfiguration(applied.next, {
        expectedRevision: 1,
        changes: [
          {
            resource: "project",
            operation: "update",
            id: "p",
            value: { milestones: [] },
          },
        ],
      }),
    /node\/subtask/,
  );
  assert.throws(
    () =>
      replaceWorkspace(null, {
        expectedRevision: 0,
        data: {
          projects: [
            {
              id: "p",
              name: "p",
              milestones: [{ id: "a", name: "A", nodeType: "fake" }],
            },
          ],
          settings: {},
        },
      }),
    /Choose one of/,
  );
});
test("scope mapping is identical for public routes and dispatch aliases; reads do not require write grants", () => {
  for (const [url, query, expected] of [
    ["/api/capabilities", {}, "capabilities:write"],
    ["/api/triage", { scope: "capabilities" }, "capabilities:write"],
    ["/api/workspace/resources", {}, "workspace-resources:write"],
    [
      "/api/triage",
      { scope: "workspace_resources" },
      "workspace-resources:write",
    ],
    ["/api/send-email", {}, "send-email:write"],
    ["/api/communications/memory", {}, "communications:read"],
    ["/api/communications/status", { action: "memory" }, "communications:read"],
    ["/api/projects", {}, "configuration:write"],
    [
      "/api/gemini",
      { action: "configuration", resource: "projects" },
      "configuration:write",
    ],
    ["/api/test-runs", {}, "test-runs:write"],
    ["/api/gemini", { action: "test_runs" }, "test-runs:write"],
  ] as any[])
    assert.equal(requestScope({ url, query, method: "POST" }), expected, url);
  assert.equal(
    requestScope({
      url: "/api/configuration",
      method: "POST",
      body: { operation: "plan" },
    }),
    "configuration:read",
  );
});
test("machine principals cannot make human decisions including nested reviews", async () => {
  for (const [domain, body] of [
    ["flows", { operation: "approve" }],
    ["calendar", { operation: "approve" }],
    ["artifacts", { operation: "review" }],
    ["publishing", { operation: "approve" }],
    ["captured_work", { operation: "resolve" }],
    ["commitments", { action: "promise_ledger", operation: "review" }],
    ["commitments", { action: "operational_review", operation: "action" }],
  ] as any[])
    assert.throws(
      () => assertHumanDecision(actor, domain, body),
      /human session/,
    );
  assert.doesNotThrow(() =>
    assertHumanDecision({ uid: "human" }, "flows", { operation: "approve" }),
  );
  await assert.rejects(
    handleVisibleFlows(
      { method: "POST", body: { operation: "approve" } },
      actor,
      { projects: async () => [] },
    ),
    /human session/,
  );
});
test("fixture tests use the production orchestrator, bind outputs and never dispatch to providers", async () => {
  const result = await simulateProject(
    applied.next.projects[0],
    {
      fixtures: {
        read: { status: "success", output: { text: "hello" } },
        write: { status: "success", output: { report_content: "summary" } },
      },
      assertions: [
        {
          path: "data.report_content",
          operator: "equals",
          expected: "summary",
        },
      ],
    },
    "test_fixture",
  );
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.providerCalls, 0);
  assert.equal(result.dispatches[1].inputs.prompt, "Summarize hello");
  const missing = await simulateProject(
    applied.next.projects[0],
    {
      fixtures: {},
      assertions: [{ path: "data.report_content", operator: "exists" }],
    },
    "test_missing",
  );
  assert.equal(missing.status, "failed");
});
test("configuration and persisted test results are tenant/actor scoped, revision-bound and retry safe", async () => {
  const workspaces: any = { "tenant-a": applied.next };
  const runs: any = {};
  const deps = {
    workspace: async (org: string) => workspaces[org],
    read: async (org: string) => structuredClone(runs[org] || {}),
    transact: async (org: string, fn: any) =>
      (runs[org] = fn(structuredClone(runs[org] || {}))),
  };
  const body = {
    requestId: "test_one_001",
    expectedRevision: 1,
    projectId: "p",
    fixtures: {
      read: { status: "success", output: { text: "hello" } },
      write: { status: "success", output: { report_content: "summary" } },
    },
    assertions: [
      { path: "data.report_content", operator: "equals", expected: "summary" },
    ],
  };
  const created = await handleTestRuns({ method: "POST", body }, actor, deps);
  assert.equal(created.item.result.status, "passed");
  assert.equal(
    (await handleTestRuns({ method: "POST", body }, actor, deps)).duplicate,
    true,
  );
  await assert.rejects(
    handleTestRuns(
      { method: "GET", query: { id: created.item.id } },
      { ...actor, orgId: "tenant-b" },
      deps,
    ),
    /not found/,
  );
  await assert.rejects(
    handleTestRuns(
      { method: "GET", query: { id: created.item.id } },
      { ...actor, apiClientId: "other" },
      deps,
    ),
    /not found/,
  );
  await assert.rejects(
    handleTestRuns(
      {
        method: "POST",
        body: { ...body, requestId: "test_other", expectedRevision: 0 },
      },
      actor,
      deps,
    ),
    /Workspace changed/,
  );
  const configDeps = {
    read: async (org: string) => workspaces[org],
    transact: async (org: string, fn: any) =>
      (workspaces[org] = fn(workspaces[org])),
  };
  await assert.rejects(
    handleConfiguration(
      { method: "GET", query: { resource: "projects", id: "p" } },
      { ...actor, orgId: "tenant-b" },
      configDeps,
    ),
    /not found/,
  );
});
test("SDK handles successful empty responses and preserves error status", async () => {
  const client = new HyperFlowClient(
    "https://example.test",
    "fixture",
    async () => new Response(null, { status: 204 }),
  );
  assert.equal(await client.request("DELETE", "/api/schedules"), undefined);
  const denied = new HyperFlowClient(
    "https://example.test",
    "fixture",
    async () => Response.json({ error: "Denied" }, { status: 403 }),
  );
  await assert.rejects(
    denied.request("GET", "/api/workspace"),
    (e: any) => e.status === 403,
  );
});
test("every public rewrite has a documented method and generated contract stays current", () => {
  const spec = buildOpenApi();
  const config = JSON.parse(readFileSync("vercel.json", "utf8"));
  for (const route of config.rewrites)
    assert.ok(
      spec.paths[route.source.replace(":token", "{token}")],
      route.source,
    );
  assert.equal(
    readFileSync("contracts/openapi.json", "utf8"),
    JSON.stringify(spec, null, 2) + "\n",
  );
  assert.deepEqual(
    spec.paths["/api/tasks/execute"].post.requestBody.content[
      "application/json"
    ].schema.properties.correlation.required,
    ["projectId", "nodeId", "runId"],
  );
});
test("Express dispatches shared handlers and preserves signed raw bodies", async () => {
  const app = express();
  mountApi(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const old = process.env.COMMUNICATIONS_WEBHOOK_SECRET;
    process.env.COMMUNICATIONS_WEBHOOK_SECRET = "fixture-key";
    try {
      const { createHmac } = await import("node:crypto");
      const payload = '{"fixture":true}',
        timestamp = String(Math.floor(Date.now() / 1000));
      // Signature must get past authentication; persistence may be unavailable in this fixture process.
      const signature = createHmac("sha256", "fixture-key")
        .update(timestamp + "." + payload)
        .digest("hex");
      const response = await fetch(base + "/api/agent/voice-context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-communications-timestamp": timestamp,
          "x-communications-signature-v2": "sha256=" + signature,
        },
        body: payload,
      });
      assert.equal(response.status, 503);
      assert.match((await response.json()).error, /persistence/);
      const tampered = await fetch(base + "/api/agent/voice-context", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-communications-timestamp": timestamp,
          "x-communications-signature-v2": "sha256=" + signature,
        },
        body: '{"tampered":true}',
      });
      assert.equal(tampered.status, 401);
      for (const path of [
        "/api/capabilities",
        "/api/workspace/resources",
        "/api/flow/advance",
        "/api/discovery",
        "/api/configuration",
      ]) {
        const r = await fetch(base + path);
        assert.ok(
          r.headers.get("content-type")?.includes("application/json"),
          path,
        );
        assert.notEqual(r.status, 404, path);
      }
      const capture = await fetch(base + '/api/agent/capture-work', {method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
      assert.equal(capture.status,401);
      const absent = await fetch(base + "/api/not-real");
      assert.equal(absent.status, 404);
    } finally {
      if (old === undefined) delete process.env.COMMUNICATIONS_WEBHOOK_SECRET;
      else process.env.COMMUNICATIONS_WEBHOOK_SECRET = old;
    }
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});

test("configuration unsets only optional declared fields and preserves runtime state", () => {
  const workspace = structuredClone(applied.next);
  const node = workspace.projects[0].milestones[0];
  node.actionConfig.lastRun = { status: "success" };
  const edit: any = {
    expectedRevision: 1,
    changes: [
      {
        resource: "node",
        operation: "update",
        projectId: "p",
        id: "read",
        value: {},
        unset: ["actionConfig.template"],
      },
    ],
  };
  const planned = planConfiguration(workspace, edit);
  assert.equal(
    planned.next.projects[0].milestones[0].actionConfig.template,
    undefined,
  );
  assert.equal(
    planned.next.projects[0].milestones[0].actionConfig.lastRun.status,
    "success",
  );
  for (const path of [
    "actionConfig",
    "actionConfig.lastRun",
    "name",
    "id",
    "subtasks",
  ])
    assert.throws(
      () =>
        planConfiguration(workspace, {
          ...edit,
          changes: [{ ...edit.changes[0], unset: [path] }],
        }),
      /Cannot unset/,
    );
});

test("configuration cannot inject reserved run metadata through project data", () => {
  for (const projectData of [
    { flow_run_id: "forged" },
    { email_sending_enabled: true },
    { schedule_id: "forged" },
  ])
    assert.throws(
      () =>
        planConfiguration(null, {
          expectedRevision: 0,
          changes: [
            {
              resource: "project",
              operation: "create",
              value: { id: "p", name: "P", projectData },
            },
          ],
        }),
      /Reserved runtime/,
    );
  const plan = planConfiguration(null, {
    expectedRevision: 0,
    changes: [
      {
        resource: "project",
        operation: "create",
        value: {
          id: "minimal",
          name: "Minimal",
          milestones: [
            {
              id: "human",
              name: "Human",
              subtasks: [{ id: "task", name: "Task" }],
            },
          ],
        },
      },
    ],
  });
  assert.equal(
    plan.next.projects[0].milestones[0].subtasks[0].status,
    "Not started",
  );
});

test('query-dispatched promise reviews cannot bypass the human decision boundary',async()=>{
 await assert.rejects(handleCommitments({method:'POST',query:{view:'promise_ledger'},body:{operation:'review'}},actor),/human session/);
});
