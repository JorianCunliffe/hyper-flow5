import { assertHumanDecision } from '../http/authority.js';
import { randomUUID } from "node:crypto";
import { readPage, pageRows } from "../tenantControl/pagination.js";
import { GoogleGenAI } from "@google/genai";
import { listTenantProjects } from "../serverStore.js";
import {
  FLOW_CATALOG,
  FlowError,
  makeVersion,
  projectSnapshot,
  validatePlan,
  type FlowRecord,
} from "./model.js";
import { flowStore, type FlowStore } from "./store.js";
import {
  advanceVisibleRun,
  settleVisibleCallback,
  type StepExecutor,
} from "./runtime.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import { applyActionRun } from "../flowOrchestrator.js";
import { recordAskResponse } from "../humanAsk.js";
import { validateResponse } from "../askResponses.js";

/** Web callers answer as authenticated members; channel capability tokens stay server-side. */
export function publicFlowResponse(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, item) =>
      key === "token" || key === "ask_token" ? undefined : item,
    ),
  );
}

export async function compileVisibleFlow(prompt: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const response = await ai.models.generateContent({
    model: "gemini-3.5-flash",
    contents: `Propose a human-readable flow, not an execution. Use ONLY this catalog: ${JSON.stringify(FLOW_CATALOG)}. Return JSON {name,steps:[{id,name,action,owner,dependsOn,inputs,sources}]}. IDs are short unique identifiers. Inputs use exactly the required keys in the catalog, string values. Do not invent recipients, mailbox identities, owners, permissions, source IDs or facts: use empty strings for unknown inputs/owner. Dependencies must be acyclic. A supplier chase requires explicit channel/recipient clarification; never invent contacts or silently select a send channel. Email is draft only. Read context before preparing an evidence-based report. Source references are labels, not authority or URLs to fetch. If the request needs unsupported tools return {error:"Explain the missing capability"}; never substitute a fictional action. The user request is:\n${prompt}`,
    config: { responseMimeType: "application/json" },
  });
  const raw = JSON.parse(response.text || "{}");
  if (raw.error) throw new FlowError(422, String(raw.error).slice(0, 500));
  return validatePlan(raw).plan;
}
export async function handleVisibleFlows(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: { orgId: string; uid: string },
  deps: {
    store?: FlowStore;
    projects?: typeof listTenantProjects;
    compile?: typeof compileVisibleFlow;
    execute?: StepExecutor;
  } = {},
) {
  assertHumanDecision(member, 'flows', request.body);
  const store = deps.store || flowStore;
  const projects = await (deps.projects || listTenantProjects)(member.orgId);
  const permitted = new Set(projects.map((p) => p.id));
  const assertScope = (row: FlowRecord | null) => {
    if (!row || !permitted.has(row.projectId))
      throw new FlowError(404, "Flow not found in accessible projects");
    return row;
  };
  if (request.method === "GET") {
    if (request.query?.id)
      return {
        item: assertScope(
          await store.read(member.orgId, String(request.query.id)),
        ),
        catalog: FLOW_CATALOG,
      };
    const { after, limit } = readPage(request.query, (message) => {
      throw new FlowError(422, message);
    });
    const page = pageRows(
      await store.list(member.orgId, after, limit + 1),
      limit,
    );
    const accessible = page.rows.filter((r) => permitted.has(r.projectId));
    const items =
      request.query?.shape === "summary"
        ? accessible.map((r) => ({
            id: r.id,
            projectId: r.projectId,
            revision: r.revision,
            name: r.versions.at(-1)?.plan.name,
            currentVersion: r.versions.at(-1)?.version,
          }))
        : accessible;
    if (Buffer.byteLength(JSON.stringify(items)) > 3800000)
      throw new FlowError(
        413,
        "Use shape=summary and retrieve each flow by id",
      );
    return {
      items,
      catalog: FLOW_CATALOG,
      limit,
      next: page.next,
    };
  }
  if (request.method !== "POST") throw new FlowError(405, "Method not allowed");
  const body = request.body || {};
  const operation = body.operation;
  if (operation === "compile") {
    if (
      typeof body.prompt !== "string" ||
      !body.prompt.trim() ||
      body.prompt.length > 8000
    )
      throw new FlowError(422, "Enter a request of up to 8000 characters");
    if (!permitted.has(body.projectId))
      throw new FlowError(403, "Choose an accessible project");
    return {
      proposal: await (deps.compile || compileVisibleFlow)(body.prompt),
    };
  }
  if (operation === "create") {
    if (!permitted.has(body.projectId))
      throw new FlowError(403, "Choose an accessible project");
    const id = randomUUID();
    const version = makeVersion(id, body.projectId, 1, body.plan, member.uid);
    return {
      item: await store.transact(member.orgId, id, (current) => {
        if (current) throw new FlowError(409, "Flow already exists");
        return {
          id,
          projectId: body.projectId,
          revision: 1,
          versions: [version],
          runs: [],
        };
      }),
    };
  }
  if (typeof body.id !== "string" || !/^[a-f0-9-]{36}$/.test(body.id))
    throw new FlowError(422, "Invalid flow identity");
  const initial = assertScope(await store.read(member.orgId, body.id));
  if (operation === "reconcile_publication") {
    const run = initial.runs.find((r) => r.id === body.runId);
    const step = run?.plan.steps.find((s) => s.id === body.nodeId);
    const saved = run?.snapshot.milestones.find((m) => m.id === body.nodeId)
      ?.actionConfig?.lastRun;
    if (
      !run ||
      run.status === "cancelled" ||
      step?.action !== "review_publication" ||
      !saved?.output?.publication_id
    )
      throw new FlowError(409, "Choose a waiting publication step");
    const { publishingRequest } = await import("../publishing/store.js");
    const result: any = await publishingRequest(
      {
        method: "POST",
        body: {
          operation: "reconcile",
          projectId: run.projectId,
          id: saved.output.publication_id,
        },
      },
      member,
    );
    if (
      result.item.state !== "verified" ||
      result.item.contentHash !== step.inputs.contentHash ||
      !result.item.receipt
    )
      throw new FlowError(409, "The exact publication is not verified");
    const updated = await store.transact(member.orgId, body.id, (current) => {
      const record = assertScope(current);
      const r = record.runs.find((r) => r.id === body.runId);
      const action = r?.snapshot.milestones.find((m) => m.id === body.nodeId)
        ?.actionConfig?.lastRun;
      if (
        !r ||
        r.status === "cancelled" ||
        action?.id !== saved.id ||
        action.output?.publication_content_hash !== result.item.contentHash
      )
        throw new FlowError(409, "Publication step changed");
      if (action.status === "success") return record;
      if (action.status !== "pending")
        throw new FlowError(409, "Publication step is no longer waiting");
      r.snapshot = applyActionRun(r.snapshot, body.nodeId, {
        ...action,
        status: "success",
        executionState: "completed",
        resolvedAt: Date.now(),
        output: {
          ...action.output,
          publication_receipt: result.item.receipt,
          verified_at: Date.now(),
        },
      });
      r.revision++;
      record.revision++;
      return record;
    });
    return {
      item:
        updated.runs.find((r) => r.id === body.runId)?.status === "running"
          ? await advanceVisibleRun(member.orgId, body.id, body.runId, {
              store,
              execute: deps.execute,
            })
          : updated,
    };
  }
  if (operation === "reconcile_artifact") {
    const run = initial.runs.find((r) => r.id === body.runId),
      node = run?.snapshot.milestones.find((m) => m.id === body.nodeId),
      saved = node?.actionConfig?.lastRun;
    if (
      !run ||
      run.status === "cancelled" ||
      run.plan.steps.find((s) => s.id === body.nodeId)?.action !==
        "prepare_office_report" ||
      !saved?.output?.artifact_job_id
    )
      throw new FlowError(409, "Choose an existing report preparation step");
    const { handleArtifacts } = await import("../artifacts/api.js");
    const artifact: any = await handleArtifacts(
      {
        method: "GET",
        query: { projectId: run.projectId, id: saved.output.artifact_job_id },
      },
      member,
    );
    if (
      artifact.item.status !== "reviewed" ||
      artifact.item.inputHash !== saved.output.artifact_input_hash
    )
      throw new FlowError(
        409,
        "The exact report file still requires review in Office outputs",
      );
    await handleArtifacts(
      {
        method: "GET",
        query: {
          projectId: run.projectId,
          id: artifact.item.id,
          operation: "download",
        },
      },
      member,
    );
    const updated = await store.transact(member.orgId, body.id, (current) => {
      const record = assertScope(current),
        r = record.runs.find((r) => r.id === body.runId),
        n = r?.snapshot.milestones.find((m) => m.id === body.nodeId),
        operation = n?.actionConfig?.lastRun;
      if (
        !r ||
        r.status === "cancelled" ||
        operation?.id !== saved.id ||
        operation.output?.artifact_job_id !== artifact.item.id
      )
        throw new FlowError(409, "Report step changed");
      if (operation.status === "success") return record;
      if (operation.status !== "pending")
        throw new FlowError(409, "Report step is no longer waiting");
      r.snapshot = applyActionRun(r.snapshot, body.nodeId, {
        ...operation,
        status: "success",
        executionState: "completed",
        resolvedAt: Date.now(),
        output: {
          ...operation.output,
          artifact_receipt: artifact.item.receipt,
          review_required: false,
        },
      });
      r.revision++;
      record.revision++;
      return record;
    });
    return {
      item:
        updated.runs.find((r) => r.id === body.runId)?.status === "running"
          ? await advanceVisibleRun(member.orgId, body.id, body.runId, {
              store,
              execute: deps.execute,
            })
          : updated,
    };
  }
  if (operation === "reconcile") {
    const run = initial.runs.find((r) => r.id === body.runId);
    const step = run?.plan.steps.find((s) => s.id === body.nodeId);
    const saved = run?.snapshot.milestones.find((m) => m.id === body.nodeId)
      ?.actionConfig?.lastRun;
    if (
      !run ||
      !step ||
      !saved?.id ||
      !["send_sms", "outgoing_call"].includes(step.action)
    )
      throw new FlowError(422, "Choose a dispatched SMS or phone step");
    const externalId = saved.externalId || body.communicationId;
    if (
      typeof externalId !== "string" ||
      externalId.length > 200 ||
      !externalId
    )
      throw new FlowError(422, "A Communications receipt identity is required");
    const receipt = await new HttpCommunicationsClient().getCommunication(
      member.orgId,
      externalId,
    );
    const correlation = receipt.correlation;
    if (
      correlation?.tenant_id !== member.orgId ||
      (correlation.external_project_id || correlation.project_id) !==
        run.projectId ||
      correlation.run_id !== saved.id ||
      correlation.task_id !== step.id ||
      receipt.channel !== (step.action === "send_sms" ? "sms" : "voice")
    )
      throw new FlowError(
        409,
        "Receipt does not belong to this exact operation",
      );
    if (!["completed", "failed"].includes(receipt.status))
      return {
        item: initial,
        notice: "The provider has not reported a terminal outcome yet.",
      };
    await settleVisibleCallback(
      member.orgId,
      run.projectId,
      { nodeId: step.id, runId: saved.id, externalId: receipt.id },
      {
        status: receipt.status === "completed" ? "success" : "error",
        output: {
          ...(receipt.output || {}),
          communication_id: receipt.id,
          communication_status: receipt.status,
        },
        error: receipt.error,
      },
      { store, execute: deps.execute },
    );
    return { item: await store.read(member.orgId, body.id) };
  }
  if (operation === "advance") {
    if (!initial.runs.some((r) => r.id === body.runId))
      throw new FlowError(404, "Run not found");
    return {
      item: await advanceVisibleRun(member.orgId, body.id, body.runId, {
        store,
        execute: deps.execute,
      }),
    };
  }
  const versionDraft =
    operation === "revise"
      ? makeVersion(
          body.id,
          initial.projectId,
          initial.versions.length + 1,
          body.plan,
          member.uid,
        )
      : null;
  const responseId = randomUUID();
  const now = Date.now();
  const item = await store.transact(member.orgId, body.id, (current) => {
    const record = assertScope(current);
    if (operation === "start" && typeof body.runKey === "string") {
      const prior = record.runs.find((r) => r.id === body.runKey);
      if (prior) {
        if (prior.hash !== body.hash || prior.version !== body.version)
          throw new FlowError(409, "Run key belongs to another version");
        return record;
      }
    }
    if (body.expectedRevision !== record.revision)
      throw new FlowError(
        409,
        "Flow changed. Reload before reviewing or changing it.",
      );
    const version = record.versions.find((v) => v.version === body.version);
    if (operation === "revise") {
      if (record.versions.length >= 100)
        throw new FlowError(
          409,
          "Version limit reached; create a separate template",
        );
      const prior = record.versions[record.versions.length - 1];
      if (prior.ask.status === "open" && prior.ask.kind === "question")
        prior.ask = {
          ...prior.ask,
          status: "answered",
          responses: [
            {
              id: responseId,
              at: now,
              via: "web",
              actor: member.uid,
              text: `Inputs supplied in version ${versionDraft!.version}; separate approval remains required.`,
            },
          ],
        };
      record.versions.push(versionDraft!);
    } else if (operation === "approve" || operation === "reject") {
      if (
        !version ||
        version.hash !== body.hash ||
        version.missing.length ||
        version.ask.status !== "open" ||
        version.ask.kind !== "approval"
      )
        throw new FlowError(
          409,
          "Review the exact complete version before approval",
        );
      if (!version.ask.assignees?.includes(member.uid))
        throw new FlowError(
          403,
          "This approval belongs to the designated reviewer",
        );
      version.ask = {
        ...version.ask,
        status: "answered",
        responses: [
          {
            id: responseId,
            at: now,
            via: "web",
            actor: member.uid,
            decision: operation === "approve" ? "approved" : "rejected",
          },
        ],
      };
      if (operation === "approve") {
        version.approvedBy = member.uid;
        version.approvedAt = now;
      }
    } else if (operation === "start") {
      if (!version?.approvedBy || version.hash !== body.hash)
        throw new FlowError(409, "An approved pinned version is required");
      if (record.runs.length >= 100)
        throw new FlowError(
          409,
          "Run history limit reached; create a separate template",
        );
      // A caller-supplied key makes a lost HTTP start response recoverable.
      if (
        typeof body.runKey !== "string" ||
        !/^[a-zA-Z0-9_-]{8,80}$/.test(body.runKey)
      )
        throw new FlowError(422, "A stable runKey is required");
      const existing = record.runs.find((r) => r.id === body.runKey);
      if (existing) {
        if (existing.hash !== version.hash)
          throw new FlowError(409, "Run key belongs to another version");
        return record;
      }
      const parent = projects.find((p) => p.id === record.projectId)!;
      record.runs.push({
        id: body.runKey,
        definitionId: record.id,
        version: version.version,
        hash: version.hash,
        projectId: record.projectId,
        createdBy: member.uid,
        createdAt: now,
        revision: 1,
        status: "running",
        snapshot: projectSnapshot(version, parent),
        plan: structuredClone(version.plan),
        history: [
          {
            operation: "start",
            actor: member.uid,
            at: now,
            version: version.version,
          },
        ],
      });
    } else {
      const run = record.runs.find((r) => r.id === body.runId);
      if (!run) throw new FlowError(404, "Run not found");
      if (operation === "answer_update") {
        const node = run.snapshot.milestones.find((m) => m.id === body.nodeId);
        const saved = node?.actionConfig?.lastRun;
        const ask = saved?.output?.ask;
        if (
          run.status === "cancelled" ||
          run.plan.steps.find((s) => s.id === body.nodeId)?.action !==
            "collect_update" ||
          saved?.status !== "pending" ||
          ask?.status !== "open" ||
          ask.id !== body.askId
        )
          throw new FlowError(409, "The current update Ask is unavailable");
        if (!ask.assignees?.includes(member.uid))
          throw new FlowError(
            403,
            "This update Ask belongs to the run creator",
          );
        if (
          typeof body.note !== "string" ||
          !body.note.trim() ||
          body.note.length > 4000
        )
          throw new FlowError(
            422,
            "Enter the reviewed update or explain what is still missing",
          );
        const response = {
          id: responseId,
          at: now,
          via: "web" as const,
          actor: member.uid,
          text: body.note.trim(),
        };
        const invalid = validateResponse(ask, response);
        if (invalid) throw new FlowError(422, invalid);
        run.snapshot = applyActionRun(run.snapshot, body.nodeId, {
          ...saved,
          status: "success",
          executionState: "completed",
          resolvedAt: now,
          output: {
            ask: recordAskResponse(ask, response),
            reviewed_update: body.note.trim(),
            providedBy: member.uid,
            verification:
              "Human-entered review; no provider receipt or obligation fulfillment is inferred.",
          },
        });
      } else if (operation === "pause" || operation === "cancel") {
        if (run.status === "completed" || run.status === "cancelled")
          throw new FlowError(409, "Run is already terminal");
        run.status = operation === "pause" ? "paused" : "cancelled";
        if (operation === "cancel") {
          for (const node of run.snapshot.milestones) {
            const ask = node.actionConfig?.lastRun?.output?.ask;
            if (ask?.status === "open") ask.status = "cancelled";
          }
        }
      } else if (operation === "resume") {
        if (run.status !== "paused")
          throw new FlowError(409, "Only paused runs can resume");
        run.status = "running";
      } else if (operation === "review") {
        if (run.status !== "completed")
          throw new FlowError(409, "Review requires a completed run");
        run.reviewedBy = member.uid;
        run.reviewedAt = now;
      } else if (operation === "promote") {
        if (run.status !== "completed" || !run.reviewedBy)
          throw new FlowError(
            409,
            "Review the completed run before promoting it",
          );
        if (record.versions.length >= 100)
          throw new FlowError(409, "Version limit reached");
        // Inputs only: never copy receipts or approve the new version implicitly.
        record.versions.push(
          makeVersion(
            record.id,
            record.projectId,
            record.versions.length + 1,
            run.plan,
            member.uid,
          ),
        );
      } else if (operation === "migrate") {
        if (
          run.status !== "paused" ||
          run.snapshot.milestones.some((m) => m.actionConfig?.lastRun)
        )
          throw new FlowError(
            409,
            "Only a paused run with no dispatched steps can migrate; otherwise start a new run",
          );
        if (!version?.approvedBy || version.hash !== body.hash)
          throw new FlowError(
            409,
            "Migration requires an approved target version",
          );
        run.version = version.version;
        run.hash = version.hash;
        run.plan = structuredClone(version.plan);
        run.snapshot = projectSnapshot(
          version,
          projects.find((p) => p.id === record.projectId)!,
        );
      } else throw new FlowError(422, "Unknown flow operation");
      run.revision++;
      run.history = [
        ...(run.history || []),
        { operation, actor: member.uid, at: now, version: run.version },
      ];
    }
    record.revision++;
    return record;
  });
  return { item, ...(operation === "start" ? { runId: body.runKey } : {}) };
}
