import test from "node:test";
import {execFile} from "node:child_process";
import {promisify} from "node:util";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { set, ref, get } from "firebase/database";
import express from "express";
test("agent config-to-test workflow over HTTP with real Firebase tenant isolation and Vercel parity", async () => {
  assert.equal(process.env.FIREBASE_DATABASE_EMULATOR_HOST, "127.0.0.1:9010");
  const { privateKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
    project_id: "demo-hyperflow",
    client_email: "fixture@demo-hyperflow.iam.gserviceaccount.com",
    private_key: privateKey,
  });
  process.env.FIREBASE_DATABASE_URL = "https://demo-hyperflow.firebaseio.com";
  process.env.FIREBASE_ENFORCE_TENANT_LIFECYCLE = "true";
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const { handleTenantControl } =
    await import("../../lib/tenantControl/api.js");
  const { mountApi } = await import("../../lib/http/express.js");
  const { default: vercel } = await import("../../api/gemini/index.js");
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const app = express();
  mountApi(app);
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((r) => server.once("listening", r));
  try {
    await env.withSecurityRulesDisabled(async (c) => {
      for (const suffix of ["a", "b"]) {
        await set(ref(c.database(), "users/agent_" + suffix), {
          orgId: "agent_tenant_" + suffix,
        });
        await set(
          ref(
            c.database(),
            "organizations/agent_tenant_" + suffix + "/members/agent_" + suffix,
          ),
          { role: "owner" },
        );
      }
    });
    const keys: any = {};
    for (const suffix of ["a", "b"]) {
      const secret = "agent_fixture_secret_1234567890_" + suffix;
      const client = await handleTenantControl(
        {
          method: "POST",
          body: {
            operation: "create_client",
            requestId: "fixture_client",
            name: "Agent acceptance",
            revision: 0,
            secret,
            expiresAt: Date.now() + 86400000,
            scopes: [
              "configuration:read",
              "configuration:write",
              "test-runs:read",
              "test-runs:write",
              "discovery:read",
              "flows:write",
              "workspace:write",
            ],
          },
        },
        {
          orgId: "agent_tenant_" + suffix,
          uid: "agent_" + suffix,
          role: "owner",
        },
      );
      keys[suffix] = client.credentialPrefix + secret;
    }
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const call = async (
      path: string,
      method = "GET",
      body?: any,
      tenant = "a",
    ) => {
      const response = await fetch(base + path, {
        method,
        headers: {
          Authorization: "Bearer " + keys[tenant],
          ...(body ? { "Content-Type": "application/json" } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    };
    assert.equal((await call("/api/discovery")).status, 200);
    const changes = [
      {
        resource: "project",
        operation: "create",
        value: {
          id: "agent_project",
          name: "Agent project",
          milestones: [
            {
              id: "report",
              name: "Fixture report",
              nodeType: "report",
              actionConfig: {
                template: '{"prompt":"Hello {{name}}"}',
                autoExecute: true,
              },
              dependsOn: [],
              subtasks: [],
            },
          ],
          projectData: { name: "Fixture" },
        },
      },
    ];
    const plan = await call("/api/configuration", "POST", {
      operation: "plan",
      expectedRevision: 0,
      changes,
    });
    assert.equal(plan.status, 200, JSON.stringify(plan.body));
    const input = {
      operation: "apply",
      expectedRevision: 0,
      requestId: "create_project_001",
      planHash: plan.body.planHash,
      changes,
    };
    const applied = await call("/api/configuration", "POST", input);
    assert.equal(applied.status, 200, JSON.stringify(applied.body));
    assert.equal(applied.body.revision, 1);
    assert.equal(
      (await call("/api/configuration", "POST", input)).body.revision,
      1,
    );
    assert.equal(
      (
        await call("/api/configuration", "POST", {
          ...input,
          requestId: "stale_write",
        })
      ).status,
      409,
    );
    assert.equal(
      (await call("/api/projects?id=agent_project", "GET", undefined, "b"))
        .status,
      404,
    );
    assert.equal(
      (await call("/api/workspace", "PUT", { expectedRevision: 1, data: {} }))
        .status,
      403,
    );
    assert.equal(
      (await call("/api/flows", "POST", { operation: "approve" })).status,
      403,
    );
    const invalid = await call("/api/configuration", "POST", {
      operation: "plan",
      expectedRevision: 1,
      changes: [
        {
          resource: "node",
          operation: "update",
          projectId: "agent_project",
          id: "report",
          value: { nodeType: "imaginary" },
        },
      ],
    });
    assert.equal(invalid.status, 422);
    const testRun = await call("/api/test-runs", "POST", {
      requestId: "fixture_test_001",
      projectId: "agent_project",
      expectedRevision: 1,
      fixtures: {
        report: {
          status: "success",
          output: { report_content: "Hello Fixture" },
        },
      },
      assertions: [
        {
          path: "data.report_content",
          operator: "equals",
          expected: "Hello Fixture",
        },
      ],
    });
    assert.equal(testRun.status, 200, JSON.stringify(testRun.body));
    assert.equal(testRun.body.item.result.status, "passed");
    assert.equal(testRun.body.item.result.providerCalls, 0);
    assert.equal(
      (
        await call(
          "/api/test-runs?id=" + testRun.body.item.id,
          "GET",
          undefined,
          "b",
        )
      ).status,
      404,
    );
    const recipe=await promisify(execFile)(process.execPath,['examples/configure-and-test.mjs'],{env:{...process.env,HYPERFLOW_URL:base,HYPERFLOW_API_TOKEN:keys.a},timeout:30000});
    assert.match(recipe.stdout,/"status": "passed"/);
    assert.match(recipe.stdout,/"providerCalls": 0/);
    const httpView = await call("/api/configuration");
    let hosted: any;
    let code = 0;
    await vercel(
      {
        url: "/api/gemini",
        method: "GET",
        headers: { authorization: "Bearer " + keys.a },
        query: { action: "configuration" },
        body: undefined,
      } as any,
      {
        setHeader() {
          return this;
        },
        status(n: number) {
          code = n;
          return this;
        },
        json(body: any) {
          hosted = body;
          return this;
        },
      } as any,
    );
    assert.equal(code, 200);
    assert.deepEqual(hosted, httpView.body);
    await assertFails(
      get(
        ref(
          env.authenticatedContext("agent_b").database(),
          "agent_test_runs/agent_tenant_a",
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext("agent_a").database(),
          "agent_test_runs/agent_tenant_a/forged",
        ),
        { status: "passed" },
      ),
    );
    await env.withSecurityRulesDisabled((c) =>
      set(
        ref(c.database(), "tenant_lifecycle/agent_tenant_a/state"),
        "suspended",
      ),
    );
    assert.notEqual((await call("/api/test-runs")).status, 200);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
