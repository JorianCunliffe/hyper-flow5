import { assertHumanDecision } from '../http/authority.js';
import { randomUUID } from "node:crypto";
import { readPage, pageRows } from "../tenantControl/pagination.js";
import {
  listTenantProjects,
  requireOrganizationMember,
  listWorkspaceConnectionRefs,
  readTenantCommunicationsSettings,
} from "../serverStore.js";
import { listGoogleWorkspaceResources } from "../integrations/googleWorkspace.js";
import { ReportSheetProvider } from "./sheets.js";
import { operatingSnapshot } from "../cockpit/snapshot.js";
import { HttpCommunicationsClient } from "../communications/client.js";
import { createAsk } from "../asks/createAsk.js";
import { recordAskResponse } from "../humanAsk.js";
import {
  artifactStore,
  type ArtifactStore,
  type ArtifactFile,
} from "./store.js";
import { renderArtifact, reportSections } from "./render.js";
import {
  ArtifactError,
  BUILTIN_TEMPLATES,
  hash,
  reportInputs,
  validateTemplate,
  publicArtifact,
  normalizeJob,
  type ArtifactJob,
  type ArtifactRegistry,
} from "./model.js";
export async function handleArtifacts(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: { orgId: string; uid: string },
  deps: {
    store?: ArtifactStore;
    projects?: typeof listTenantProjects;
    membership?: typeof requireOrganizationMember;
    snapshot?: typeof operatingSnapshot;
    memory?: HttpCommunicationsClient["getMemoryContext"];
    render?: typeof renderArtifact;
    resources?: typeof listGoogleWorkspaceResources;
    connections?: typeof listWorkspaceConnectionRefs;
    sheetProvider?: (
      target: import("./sheets.js").SheetTarget,
    ) => Pick<ReportSheetProvider, "apply">;
  } = {},
) {
  assertHumanDecision(member, 'artifacts', request.body);
  const store = deps.store || artifactStore,
    body = request.body || {},
    q = request.query || {},
    projects = await (deps.projects || listTenantProjects)(member.orgId);
  const projectId = String(body.projectId || q.projectId || ""),
    project = projects.find((p) => p.id === projectId);
  if (request.method === "GET" && !projectId && !q.id)
    return { projects: projects.map((p) => ({ id: p.id, name: p.name })) };
  if (!project) throw new ArtifactError(403, "Choose a permitted project");
  const registry = (await store.read<ArtifactRegistry>(
    member.orgId,
    "registries",
    projectId,
  )) || { revision: 0, templates: [] };
  const templates = [...BUILTIN_TEMPLATES, ...(registry.templates || [])];
  const scope = (row: ArtifactJob | null) => {
    if (!row || row.projectId !== projectId)
      throw new ArtifactError(404, "Artifact not found");
    return normalizeJob(row);
  };
  if (request.method === "GET" && q.operation === "sheet_resources")
    return {
      resources: await (deps.resources || listGoogleWorkspaceResources)(
        member.orgId,
        String(q.connectionId || ""),
        "spreadsheet",
      ),
    };
  if (request.method === "GET" && !q.id) {
    const { after, limit } = readPage(q, (message) => {
      throw new ArtifactError(422, message);
    });
    const page = pageRows(
      await store.list(member.orgId, after, limit + 1),
      limit,
    );
    return {
      items: publicArtifact(
        page.rows
          .filter((r) => r.projectId === projectId)
          .map(({ inputs, ...summary }) =>
            q.shape === "summary"
              ? {
                  id: summary.id,
                  projectId: summary.projectId,
                  status: summary.status,
                  createdAt: summary.createdAt,
                  revision: summary.revision,
                  template: {
                    id: summary.template.id,
                    name: summary.template.name,
                    version: summary.template.version,
                  },
                }
              : summary,
          ),
      ),
      templates: publicArtifact(
        q.shape === "summary"
          ? templates.map((t) => ({
              ...t,
              brand: {
                ...t.brand,
                logo: t.brand.logo
                  ? {
                      width: t.brand.logo.width,
                      height: t.brand.logo.height,
                      sha256: t.brand.logo.sha256,
                    }
                  : undefined,
              },
            }))
          : templates,
      ),
      registryRevision: registry.revision,
      sheetTarget: registry.sheetTarget || null,
      connections: await (deps.connections || listWorkspaceConnectionRefs)(
        member.orgId,
      ),
      limit,
      next: page.next,
    };
  }
  if (request.method === "POST" && body.operation === "configure_sheet") {
    const actor = await (deps.membership || requireOrganizationMember)(
      member.uid,
      member.orgId,
    );
    if (!["owner", "admin"].includes(actor.role))
      throw new ArtifactError(
        403,
        "An administrator must grant creation of report tabs",
      );
    let target = registry.sheetTarget;
    if (body.enabled !== false) {
      if (body.allowNewTabs !== true)
        throw new ArtifactError(
          422,
          "Explicitly grant creation of new report tabs",
        );
      const resource = (
        await (deps.resources || listGoogleWorkspaceResources)(
          member.orgId,
          String(body.connectionId || ""),
          "spreadsheet",
        )
      ).find((r) => r.id === body.spreadsheetId && r.canEdit);
      if (!resource)
        throw new ArtifactError(
          403,
          "Choose an editable connected spreadsheet",
        );
      target = {
        connectionId: body.connectionId,
        spreadsheetId: resource.id,
        name: resource.name,
        enabled: true,
        revision: registry.revision + 1,
        configuredBy: member.uid,
      };
    } else if (target)
      target = {
        ...target,
        enabled: false,
        revision: registry.revision + 1,
        configuredBy: member.uid,
      };
    else throw new ArtifactError(422, "No report spreadsheet is configured");
    const updated = await store.transact<ArtifactRegistry>(
      member.orgId,
      "registries",
      projectId,
      (current) => {
        const r = current || { revision: 0, templates: [] };
        if (r.revision !== body.revision)
          throw new ArtifactError(409, "Registry changed; reload it");
        return { ...r, revision: r.revision + 1, sheetTarget: target };
      },
    );
    return { registry: publicArtifact(updated) };
  }
  if (request.method === "POST" && body.operation === "save_template") {
    const actor = await (deps.membership || requireOrganizationMember)(
      member.uid,
      member.orgId,
    );
    if (!["admin", "owner"].includes(actor.role))
      throw new ArtifactError(
        403,
        "An administrator must register brand and template permissions",
      );
    const saved = await store.transact<ArtifactRegistry>(
      member.orgId,
      "registries",
      projectId,
      (current) => {
        const r = current || { revision: 0, templates: [] };
        if (r.revision !== body.revision)
          throw new ArtifactError(409, "Template registry changed; reload it");
        const history = r.templates || [];
        if (history.length >= 30)
          throw new ArtifactError(409, "Registry reached its 30-version limit");
        const v =
          1 +
          Math.max(
            0,
            ...history
              .filter((t) => t.id === body.template?.id)
              .map((t) => t.version),
          );
        return {
          ...r,
          revision: r.revision + 1,
          templates: [
            ...history,
            validateTemplate(body.template, member.uid, v),
          ],
        };
      },
    );
    return { registry: publicArtifact(saved) };
  }
  if (request.method === "POST" && body.operation === "create_flow") {
    const template = templates.find(
      (t) => t.id === body.templateId && t.version === body.templateVersion,
    );
    if (!template)
      throw new ArtifactError(422, "Choose an existing template version");
    const { handleVisibleFlows, publicFlowResponse } =
      await import("../visibleFlows/api.js");
    return publicFlowResponse(
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId,
            plan: {
              name: template.name,
              steps: [
                {
                  id: "office",
                  name: "Prepare and review the weekly report",
                  action: "prepare_office_report",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: {
                    templateId: template.id,
                    templateVersion: String(template.version),
                    windowDays: "7",
                  },
                  sources: [],
                },
              ],
            },
          },
        },
        member,
      ),
    );
  }
  if (request.method === "POST" && body.operation === "prepare") {
    if (
      typeof body.requestId !== "string" ||
      !/^[a-zA-Z0-9_-]{8,100}$/.test(body.requestId)
    )
      throw new ArtifactError(422, "Provide a stable request identity");
    const template = templates.find(
      (t) => t.id === body.templateId && t.version === body.templateVersion,
    );
    if (!template)
      throw new ArtifactError(422, "Choose an existing template version");
    const requestHash = hash({
        projectId,
        templateId: template.id,
        templateVersion: template.version,
        start: body.periodStart,
        cutoff: body.cutoff,
        uid: member.uid,
      }),
      id = hash(projectId + ":" + body.requestId);
    const prior = await store.read<ArtifactJob>(member.orgId, "jobs", id);
    if (prior) {
      if (prior.requestHash !== requestHash)
        throw new ArtifactError(
          409,
          "Request identity already belongs to different report inputs",
        );
      return { item: publicArtifact(scope(prior)) };
    }
    const [snapshot, memory] = await Promise.all([
      (deps.snapshot || operatingSnapshot)(member, [projectId]),
      (
        deps.memory ||
        new HttpCommunicationsClient().getMemoryContext.bind(
          new HttpCommunicationsClient(),
        )
      )(member.orgId, {
        kind: "evidence",
        external_project_id: projectId,
        allowed_project_ids: [projectId],
        include_private: false,
        limit: 30,
      }),
    ]);
    const inputs = reportInputs(
        project,
        body.periodStart,
        body.cutoff,
        snapshot,
        memory,
      ),
      inputHash = hash({ template, inputs });
    const ask = createAsk({
      taskId: id,
      projectId,
      question: `Approve these frozen inputs and ${template.name} version ${template.version} for draft generation?`,
      responseType: "approval",
      assignees: [member.uid],
      channels: ["web"],
    });
    const item = await store.transact<ArtifactJob>(
      member.orgId,
      "jobs",
      id,
      (current) => {
        if (current) {
          if (current.requestHash !== requestHash)
            throw new ArtifactError(409, "Request identity collision");
          return current;
        }
        return {
          id,
          projectId,
          revision: 1,
          requestHash,
          inputHash,
          createdBy: member.uid,
          createdAt: Date.now(),
          template,
          inputs,
          status: "proposed",
          ask,
        };
      },
    );
    return { item: publicArtifact(item) };
  }
  const id = String(body.id || q.id || "");
  if (!/^[a-f0-9]{64}$/.test(id))
    throw new ArtifactError(422, "Invalid artifact identity");
  const initial = scope(
    await store.read<ArtifactJob>(member.orgId, "jobs", id),
  );
  if (request.method === "POST" && body.operation === "draft_flow") {
    if (initial.status !== "reviewed" || !initial.receipt)
      throw new ArtifactError(
        409,
        "Review this file before preparing its handoff",
      );
    if (
      typeof body.to !== "string" ||
      !/^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]+$/.test(body.to)
    )
      throw new ArtifactError(422, "Enter one email recipient");
    const settings = await readTenantCommunicationsSettings(member.orgId);
    const { handleVisibleFlows, publicFlowResponse } =
      await import("../visibleFlows/api.js");
    return publicFlowResponse(
      await handleVisibleFlows(
        {
          method: "POST",
          body: {
            operation: "create",
            projectId,
            plan: {
              name: "Draft weekly report handoff",
              steps: [
                {
                  id: "file",
                  name: "Check the reviewed report file",
                  action: "check_artifact",
                  owner: member.uid,
                  dependsOn: [],
                  inputs: { artifactId: id, fileHash: initial.receipt.sha256 },
                  sources: [id],
                },
                {
                  id: "draft",
                  name: "Prepare an email draft",
                  action: "draft_email",
                  owner: member.uid,
                  dependsOn: ["file"],
                  sources: [id],
                  inputs: {
                    connectionId: settings.mailboxConnectionId || "",
                    to: body.to,
                    subject: `Weekly report for ${project.name}`,
                    body: `The reviewed weekly report for ${project.name} covers ${initial.inputs.periodStart} to ${initial.inputs.cutoff}. Records were read at ${initial.inputs.observedAt}.\n\nFile: ${initial.receipt.filename}\n\nDRAFT CHECK: attach the reviewed file before sending. This draft has no attachment.\nFile fingerprint: ${initial.receipt.sha256}`,
                  },
                },
              ],
            },
          },
        },
        member,
      ),
    );
  }
  if (request.method === "GET") {
    if (q.operation === "download") {
      const file = await store.read<ArtifactFile>(member.orgId, "files", id);
      if (
        !file ||
        !initial.receipt ||
        hash(Buffer.from(file.base64, "base64")) !== initial.receipt.sha256
      )
        throw new ArtifactError(
          409,
          "Generated file is unavailable or failed integrity verification",
        );
      return { download: { ...initial.receipt, base64: file.base64 } };
    }
    return { item: publicArtifact(initial), preview: reportSections(initial) };
  }
  if (request.method !== "POST")
    throw new ArtifactError(405, "Method not allowed");
  const assertVersion = (row: ArtifactJob) => {
    if (row.revision !== body.revision || row.inputHash !== body.inputHash)
      throw new ArtifactError(
        409,
        "Artifact changed; reload the exact version",
      );
  };
  if (
    [
      "propose_sheet",
      "approve_sheet",
      "export_sheet",
      "reconcile_sheet",
    ].includes(body.operation)
  ) {
    if (initial.status !== "reviewed" || !initial.receipt)
      throw new ArtifactError(
        409,
        "Review the generated file before proposing a spreadsheet export",
      );
    const target = registry.sheetTarget;
    if (!target?.enabled)
      throw new ArtifactError(
        403,
        "Report-tab creation is not enabled for this project",
      );
    if (body.operation === "propose_sheet") {
      const updated = await store.transact<ArtifactJob>(
        member.orgId,
        "jobs",
        id,
        (current) => {
          const row = scope(current);
          assertVersion(row);
          if (row.sheetExport)
            throw new ArtifactError(
              409,
              "This job already has an export proposal",
            );
          return {
            ...row,
            revision: row.revision + 1,
            sheetExport: {
              target,
              status: "proposed",
              ask: createAsk({
                taskId: id,
                projectId,
                question: `Create a new report tab in ${target.name} using this reviewed snapshot? People with access to that spreadsheet can read it. Existing tabs remain unchanged.`,
                responseType: "approval",
                assignees: [row.createdBy],
                channels: ["web"],
              }),
            },
          };
        },
      );
      return { item: publicArtifact(updated) };
    }
    const validateTarget = (row: ArtifactJob) => {
      if (
        !row.sheetExport ||
        row.sheetExport.target.revision !== target.revision ||
        row.sheetExport.target.spreadsheetId !== target.spreadsheetId ||
        row.sheetExport.target.connectionId !== target.connectionId
      )
        throw new ArtifactError(
          409,
          "Spreadsheet grant changed; this approval is stale",
        );
    };
    validateTarget(initial);
    if (body.operation === "approve_sheet") {
      const updated = await store.transact<ArtifactJob>(
        member.orgId,
        "jobs",
        id,
        (current) => {
          const row = scope(current);
          assertVersion(row);
          validateTarget(row);
          if (
            row.createdBy !== member.uid ||
            row.sheetExport!.status !== "proposed"
          )
            throw new ArtifactError(
              403,
              "The designated reviewer must approve the open export Ask",
            );
          return {
            ...row,
            revision: row.revision + 1,
            sheetExport: {
              ...row.sheetExport!,
              status: "approved",
              ask: recordAskResponse(row.sheetExport!.ask, {
                id: randomUUID(),
                at: Date.now(),
                via: "web",
                actor: member.uid,
                decision: "approved",
              }),
            },
          };
        },
      );
      return { item: publicArtifact(updated) };
    }
    const write = body.operation === "export_sheet";
    if (write && initial.sheetExport!.status === "verified")
      return { item: publicArtifact(initial) };
    if (write) {
      await store.transact<ArtifactJob>(member.orgId, "jobs", id, (current) => {
        const row = scope(current);
        assertVersion(row);
        validateTarget(row);
        if (row.sheetExport!.status !== "approved")
          throw new ArtifactError(
            409,
            "Approve this export or reconcile its existing attempt",
          );
        return {
          ...row,
          revision: row.revision + 1,
          sheetExport: { ...row.sheetExport!, status: "running" },
        };
      });
    } else if (
      !["running", "uncertain", "verified"].includes(
        initial.sheetExport!.status,
      )
    )
      throw new ArtifactError(
        409,
        "Only an attempted export can be reconciled",
      );
    try {
      await (deps.membership || requireOrganizationMember)(
        member.uid,
        member.orgId,
      );
      const latest = await store.read<ArtifactRegistry>(
        member.orgId,
        "registries",
        projectId,
      );
      if (
        !latest?.sheetTarget?.enabled ||
        latest.sheetTarget.revision !== target.revision
      )
        throw new ArtifactError(
          403,
          "Spreadsheet grant was revoked before dispatch",
        );
      const receipt = await (
        deps.sheetProvider
          ? deps.sheetProvider(target)
          : new ReportSheetProvider(member.orgId, target)
      ).apply(initial, write, async () => {
        await (deps.membership || requireOrganizationMember)(
          member.uid,
          member.orgId,
        );
        const current = await store.read<ArtifactRegistry>(
          member.orgId,
          "registries",
          projectId,
        );
        if (
          !current?.sheetTarget?.enabled ||
          current.sheetTarget.revision !== target.revision
        )
          throw new ArtifactError(
            403,
            "Spreadsheet grant changed during preflight; no write was dispatched",
          );
      });
      const updated = await store.transact<ArtifactJob>(
        member.orgId,
        "jobs",
        id,
        (current) => {
          const row = scope(current);
          validateTarget(row);
          return {
            ...row,
            revision: row.revision + 1,
            sheetExport: {
              ...row.sheetExport!,
              status: "verified",
              receipt,
              error: undefined,
            },
          };
        },
      );
      return { item: publicArtifact(updated) };
    } catch (error) {
      await store.transact<ArtifactJob>(member.orgId, "jobs", id, (current) => {
        const row = scope(current);
        return {
          ...row,
          revision: row.revision + 1,
          sheetExport: {
            ...row.sheetExport!,
            status: "uncertain",
            error:
              error instanceof Error
                ? error.message
                : "Export verification failed",
          },
        };
      });
      throw error;
    }
  }
  if (["approve", "reject", "review"].includes(body.operation)) {
    const result = await store.transact<ArtifactJob>(
      member.orgId,
      "jobs",
      id,
      (current) => {
        const row = scope(current);
        assertVersion(row);
        if (row.createdBy !== member.uid)
          throw new ArtifactError(
            403,
            "Only the designated reviewer may answer this Ask",
          );
        const review = body.operation === "review";
        if (review ? row.status !== "generated" : row.status !== "proposed")
          throw new ArtifactError(409, "This Ask is no longer open");
        if (
          review &&
          (!row.receipt ||
            body.fileHash !== row.receipt.sha256 ||
            body.visualChecked !== true ||
            body.contentChecked !== true)
        )
          throw new ArtifactError(
            422,
            "Inspect the generated file and confirm layout and source content for its exact fingerprint",
          );
        const response = {
          id: randomUUID(),
          at: Date.now(),
          via: "web" as const,
          actor: member.uid,
          decision:
            body.operation === "reject"
              ? ("rejected" as const)
              : ("approved" as const),
        };
        return {
          ...row,
          revision: row.revision + 1,
          status: review
            ? "reviewed"
            : body.operation === "approve"
              ? "approved"
              : "rejected",
          ...(review
            ? {
                reviewAsk: recordAskResponse(row.reviewAsk!, response),
                receipt: { ...row.receipt!, visual: "reviewed" },
              }
            : { ask: recordAskResponse(row.ask, response) }),
        };
      },
    );
    return { item: publicArtifact(result) };
  }
  if (body.operation === "reconcile") {
    if (!["building", "failed"].includes(initial.status))
      return { item: publicArtifact(initial) };
    const file = await store.read<ArtifactFile>(member.orgId, "files", id);
    if (
      !file ||
      hash(Buffer.from(file.base64, "base64")) !== file.sha256 ||
      file.receipt.sha256 !== file.sha256
    )
      throw new ArtifactError(
        409,
        "No intact saved output is available. Create a new report job; this job remains retained for diagnosis.",
      );
    const row = await store.transact<ArtifactJob>(
      member.orgId,
      "jobs",
      id,
      (current) => {
        const row = scope(current);
        assertVersion(row);
        if (!["building", "failed"].includes(row.status)) return row;
        return {
          ...row,
          status: "generated",
          revision: row.revision + 1,
          error: undefined,
          receipt: file.receipt,
          reviewAsk: createAsk({
            taskId: id,
            projectId,
            question:
              "Inspect the recovered file for content, references, formulas and layout.",
            responseType: "approval",
            assignees: [row.createdBy],
            channels: ["web"],
          }),
        };
      },
    );
    return { item: publicArtifact(row) };
  }
  if (body.operation !== "generate")
    throw new ArtifactError(422, "Unknown artifact operation");
  if (["generated", "reviewed"].includes(initial.status))
    return { item: publicArtifact(initial) };
  const claim = randomUUID();
  const claimed = await store.transact<ArtifactJob>(
    member.orgId,
    "jobs",
    id,
    (current) => {
      const row = scope(current);
      assertVersion(row);
      if (row.status !== "approved")
        throw new ArtifactError(409, "Approve the inputs before generating");
      return { ...row, status: "building", revision: row.revision + 1, claim };
    },
  );
  try {
    await (deps.membership || requireOrganizationMember)(
      member.uid,
      member.orgId,
    );
    const generated = await (deps.render || renderArtifact)(claimed);
    await store.transact<ArtifactFile>(member.orgId, "files", id, (current) => {
      if (current) {
        if (current.sha256 !== generated.receipt.sha256)
          throw new ArtifactError(
            409,
            "A different file already occupies this job",
          );
        return current;
      }
      return {
        base64: generated.bytes.toString("base64"),
        sha256: generated.receipt.sha256,
        receipt: generated.receipt,
      };
    });
    const result = await store.transact<ArtifactJob>(
      member.orgId,
      "jobs",
      id,
      (current) => {
        const row = scope(current);
        if (row.claim !== claim || row.status !== "building")
          throw new ArtifactError(409, "Generation claim changed");
        return {
          ...row,
          status: "generated",
          revision: row.revision + 1,
          receipt: generated.receipt,
          reviewAsk: createAsk({
            taskId: id,
            projectId,
            question:
              "Inspect the generated file for content, source references, formulas and layout before approving it for use.",
            responseType: "approval",
            assignees: [row.createdBy],
            channels: ["web"],
          }),
        };
      },
    );
    return { item: publicArtifact(result) };
  } catch (error) {
    await store.transact<ArtifactJob>(member.orgId, "jobs", id, (current) => {
      const row = scope(current);
      return row.claim === claim && row.status === "building"
        ? {
            ...row,
            status: "failed",
            revision: row.revision + 1,
            error:
              "Generation did not complete. Existing output is retained for reconciliation; no external delivery occurred.",
          }
        : row;
    });
    throw error;
  }
}
