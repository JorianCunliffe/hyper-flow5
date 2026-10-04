import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment,
  assertFails,
} from "@firebase/rules-unit-testing";
import { ref, set, get } from "firebase/database";

test("reception configuration persists through cold Firebase transactions, lost responses and concurrent approvals", async () => {
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
  process.env.PROJECT_RECEPTION_ENABLED = "false";
  const env = await initializeTestEnvironment({
    projectId: "demo-hyperflow",
    database: {
      host: "127.0.0.1",
      port: 9010,
      rules: readFileSync("database.rules.json", "utf8"),
    },
  });
  const { getApps, deleteApp } = await import("firebase-admin/app");
  const { handleReception, receptionDependencies } =
    await import("../../lib/reception/service.js");
  const { receptionStore } = await import("../../lib/reception/store.js");
  const member = { orgId: "reception_fixture", uid: "reception_admin" };
  try {
    await env.withSecurityRulesDisabled((c) =>
      set(ref(c.database(), `users/${member.uid}`), { orgId: member.orgId }),
    );
    await env.withSecurityRulesDisabled((c) =>
      set(
        ref(
          c.database(),
          `organizations/${member.orgId}/members/${member.uid}`,
        ),
        { role: "owner" },
      ),
    );
    const deps = {
      ...receptionDependencies,
      listTenantProjects: async () =>
        [{ id: "sharehouse", name: "Fixture" }] as any,
      actions: {
        ...receptionDependencies.actions,
        readiness: async () => [{ name: "isolated fixture", ok: true }],
      },
    };
    const config = {
      revision: 0,
      lines: [
        {
          id: "test_line",
          identity: "+61400000001",
          enabled: true,
          name: "Cairns Sharehouse",
          greeting: "Hello",
          timezone: "Australia/Brisbane",
          projectIds: ["sharehouse"],
          inboxOwner: member.uid,
        },
      ],
      projects: [
        {
          projectId: "sharehouse",
          enabled: true,
          label: "Cairns Sharehouse",
          aliases: [],
          visibility: "public",
          knowledge: "Approved fixture information",
          historySourceProjectIds: [],
          intakeOwner: member.uid,
          actions: [],
        },
      ],
    };
    const send = (body: any) =>
      handleReception({ method: "POST", body }, member, deps);
    const review: any = await send({
      operation: "prepare",
      expectedRevision: 0,
      config,
    });
    const body = {
      operation: "apply",
      expectedRevision: 0,
      config,
      reviewHash: review.reviewHash,
      requestId: "stable_fixture_approval",
    };
    const attempts = await Promise.allSettled([send(body), send(body)]);
    assert(attempts.some((result) => result.status === "fulfilled"));
    const recovered: any = await send(body);
    assert.equal(recovered.appliedRevision, 1);
    assert.equal(recovered.config.revision, 1);
    assert.equal(recovered.config.lines[0].enabled, false);
    await assert.rejects(
      send({ ...body, config: { ...config, projects: [] } }),
      /reused/,
    );
    await assert.rejects(
      send({ ...body, requestId: "different_fixture_approval" }),
      /changed/,
    );
    assert.equal(
      await receptionStore.read("another_tenant", "config", "current"),
      null,
    );
    await assertFails(
      get(
        ref(
          env.authenticatedContext(member.uid).database(),
          `reception/${member.orgId}/config/current`,
        ),
      ),
    );
    await assertFails(
      set(
        ref(
          env.authenticatedContext(member.uid).database(),
          `reception/${member.orgId}/config/current`,
        ),
        { revision: 100 },
      ),
    );
    const activation: any = await send({
      operation: "review_activation",
      expectedRevision: 1,
      config,
    });
    await assert.rejects(
      send({
        operation: "activate",
        expectedRevision: 1,
        config,
        reviewHash: activation.reviewHash,
        requestId: "activation_fixture",
      }),
      /readiness/,
    );
  } finally {
    await env.cleanup();
    await Promise.all(getApps().map(deleteApp));
  }
});
