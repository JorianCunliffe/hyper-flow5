import { advanceProjectFlow } from "../flowOrchestrator.js";
import { isNodeComplete, resolveNodeStates } from "../flowEngine.js";
import {
  renderActionTemplate,
  readFlowPath,
  validateFlowOutput,
  validateOutputSchema,
} from "../flowData.js";
import {
  readTenantWorkspace,
  readAgentTestRuns,
  transactAgentTestRuns,
} from "../serverStore.js";
import { workspaceView } from "../tenantControl/workspace.js";
import { TenantControlError } from "../tenantControl/model.js";
import { projectConfiguration } from "./schema.js";
import { hash, validateProject } from "./model.js";
import { redactTenantExport } from "../tenantLifecycle/model.js";
export const testDependencies = {
  workspace: readTenantWorkspace,
  read: readAgentTestRuns,
  transact: transactAgentTestRuns,
};
/** Uses the production pure orchestrator and ONLY a fixture executor. No provider executor is imported. */
export async function simulateProject(source: any, input: any, id: string) {
  const project = projectConfiguration(source);
  const issues = validateProject(project);
  if (issues.length) throw new TenantControlError(422, JSON.stringify(issues));
  if (
    !input.fixtures ||
    typeof input.fixtures !== "object" ||
    Array.isArray(input.fixtures)
  )
    throw new TenantControlError(
      422,
      "fixtures must be a map of node IDs to outcomes",
    );
  const rounds = input.maxRounds ?? 20;
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100)
    throw new TenantControlError(422, "maxRounds must be 1–100");
  if (
    !Array.isArray(input.assertions) ||
    input.assertions.length < 1 ||
    input.assertions.length > 100
  )
    throw new TenantControlError(422, "Supply 1–100 assertions");
  for (const a of input.assertions)
    if (
      !a ||
      !["equals", "exists"].includes(a.operator) ||
      typeof a.path !== "string" ||
      a.path.length > 300 ||
      (a.operator === "equals" && !Object.hasOwn(a, "expected"))
    )
      throw new TenantControlError(
        422,
        "Assertions require path and equals/exists operator",
      );
  project.projectData = {
    ...project.projectData,
    ...input.inputs,
    flow_occurrence_id: id,
    flow_run_id: id,
  };
  for (const n of project.milestones || []) {
    if (n.loopConfig) n.loopConfig.currentIteration = 0;
    n.actionConfig && (n.actionConfig.autoExecute = true);
  }
  const dispatches: any[] = [];
  const missing: string[] = [];
  const result = await advanceProjectFlow(
    project,
    async (taskType, template, data, ctx) => {
      const rendered = renderActionTemplate(template, data);
      const fixture =
        input.fixtures[ctx.nodeId] || input.fixtures[ctx.nodeId.split("__")[0]];
      dispatches.push({
        nodeId: ctx.nodeId,
        taskType,
        inputs: rendered.templateData,
        simulated: true,
      });
      if (!fixture) {
        missing.push(ctx.nodeId);
        return { status: "error", error: "Missing fixture for " + ctx.nodeId };
      }
      if (!["success", "error", "pending"].includes(fixture.status))
        return { status: "error", error: "Invalid fixture status" };
      if (fixture.status === "success" && rendered.templateData.output_schema)
        validateFlowOutput(
          fixture.output,
          validateOutputSchema(rendered.templateData.output_schema),
        );
      return {
        status: fixture.status,
        output: fixture.output,
        error: fixture.error,
        logs: ["Fixture result; no provider call"],
      };
    },
    {
      orgId: "simulation",
      maxRounds: rounds,
      reviewCaptures: async (_p, node) => ({
        node,
        log: ["Capture review requires a human; simulation held"],
      }),
    },
  );
  const states = resolveNodeStates(result.project);
  const nodes = result.project.milestones.map((n) => ({
    id: n.id,
    state: states.get(n.id),
    complete: isNodeComplete(n, result.project.projectData),
    status: n.actionConfig?.lastRun?.status || "pending",
    error: n.actionConfig?.lastRun?.error,
  }));
  const subject = { data: result.project.projectData, nodes, dispatches };
  const assertions = input.assertions.map((a: any) => {
    let actual: any,
      exists = true;
    try {
      actual = readFlowPath(subject, a.path);
    } catch {
      exists = false;
    }
    return {
      ...a,
      actual: actual ?? null,
      passed:
        a.operator === "exists"
          ? exists
          : exists && hash(actual) === hash(a.expected),
    };
  });
  const failures = nodes.filter((n) => n.status === "error");
  const held = nodes.some((n) => !n.complete && n.state !== "skipped");
  return {
    mode: "simulation",
    providerCalls: 0,
    status:
      missing.length ||
      failures.length ||
      assertions.some((a: any) => !a.passed)
        ? "failed"
        : held
          ? "held"
          : "passed",
    assertions,
    nodes,
    dispatches,
    missingFixtures: missing,
    log: result.log,
    limitations: [
      "Provider grants and live availability are not verified",
      "Human reviews, waits and external callbacks remain held",
      "Passing assertions do not authorize live execution",
    ],
  };
}
export async function handleTestRuns(
  req: { method?: string; query?: any; body?: any },
  member: { orgId: string; uid: string; apiClientId?: string },
  deps = testDependencies,
) {
  const q = req.query || {},
    b = req.body || {};
  const rows = await deps.read(member.orgId);
  const owns = (r: any) =>
    r.actor === member.uid &&
    (!member.apiClientId || r.clientId === member.apiClientId);
  if (req.method === "GET") {
    if (q.id) {
      const item = rows[q.id];
      if (!item || !owns(item))
        throw new TenantControlError(404, "Test run not found");
      return { item };
    }
    const limit = q.limit === undefined ? 25 : Number(q.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100)
      throw new TenantControlError(422, "limit must be 1–100");
    const items: any[] = Object.values(rows)
      .filter((r: any) => owns(r) && r.id > String(q.after || ""))
      .sort((a: any, b: any) => a.id.localeCompare(b.id));
    return {
      items: items
        .slice(0, limit)
        .map(({ result, ...r }) => ({ ...r, status: result.status })),
      next: items.length > limit ? items[limit - 1].id : null,
    };
  }
  if (req.method === "DELETE") {
    const id = String(b.id || q.id || "");
    await deps.transact(member.orgId, (current) => {
      if (!current[id] || !owns(current[id]))
        throw new TenantControlError(404, "Test run not found");
      delete current[id];
      return current;
    });
    return { deleted: true, id };
  }
  if (req.method !== "POST")
    throw new TenantControlError(405, "Method not allowed");
  if (!/^[A-Za-z0-9_-]{8,100}$/.test(b.requestId || ""))
    throw new TenantControlError(422, "Stable requestId required");
  if (Buffer.byteLength(JSON.stringify(b)) > 500000)
    throw new TenantControlError(413, "Test input exceeds 500 KB");
  const id =
    "test_" +
    hash({
      actor: member.uid,
      client: member.apiClientId || "",
      request: b.requestId,
    }).slice(0, 32);
  const fingerprint = hash(b);
  if (rows[id]) {
    if (!owns(rows[id]) || rows[id].fingerprint !== fingerprint)
      throw new TenantControlError(409, "requestId conflict");
    return { item: rows[id], duplicate: true };
  }
  const workspace = workspaceView(await deps.workspace(member.orgId));
  if (workspace.dataRevision !== b.expectedRevision)
    throw new TenantControlError(
      409,
      "Workspace changed; reload before testing",
    );
  const project = workspace.projects.find((p: any) => p.id === b.projectId);
  if (!project) throw new TenantControlError(404, "Project not found");
  const result = redactTenantExport(await simulateProject(project, b, id));
  if (Buffer.byteLength(JSON.stringify(result)) > 256000)
    throw new TenantControlError(
      413,
      "Test result exceeds 256 KB; reduce fixtures/rounds",
    );
  const item = {
    id,
    projectId: b.projectId,
    revision: b.expectedRevision,
    actor: member.uid,
    clientId: member.apiClientId || null,
    at: Date.now(),
    fingerprint,
    result,
  };
  const saved = await deps.transact(member.orgId, (current) => {
    if (current[id]) {
      if (current[id].fingerprint !== fingerprint)
        throw new TenantControlError(409, "requestId conflict");
      return current;
    }
    if (Object.keys(current).length >= 100)
      throw new TenantControlError(
        409,
        "Delete old test runs before creating more (100 run limit)",
      );
    const next = { ...current, [id]: item };
    if (Buffer.byteLength(JSON.stringify(next)) > 3800000)
      throw new TenantControlError(
        413,
        "Test history exceeds 3.8 MB; delete old tests",
      );
    return next;
  });
  return { item: saved[id] };
}
