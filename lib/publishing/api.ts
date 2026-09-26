import { assertHumanDecision } from '../http/authority.js';
import { createHash, randomUUID } from "node:crypto";
import { createAsk } from "../asks/createAsk.js";
import { recordAskResponse } from "../humanAsk.js";
import {
  PublishingError,
  normalizeLedger,
  type PublishingStore,
  type PublishingAdapter,
  type PublishingTarget,
  type Publication,
  type PublicationContent,
  type PublicationObservation,
} from "./model.js";
const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const content = (raw: any): PublicationContent => {
  if (
    typeof raw?.title !== "string" ||
    typeof raw?.text !== "string" ||
    !raw.text.trim() ||
    raw.title.length > 160 ||
    raw.text.length > 12000
  )
    throw new PublishingError(
      422,
      "Enter a title up to 160 characters and content up to 12,000 characters",
    );
  return { title: raw.title.trim(), text: raw.text.trim() };
};
const publicResult = (r: unknown): any =>
  JSON.parse(
    JSON.stringify(r, (key, value) => (key === "token" ? undefined : value)),
  );
const assertVersion = (p: Publication, b: any) => {
  if (p.revision !== b.revision || p.contentHash !== b.contentHash)
    throw new PublishingError(409, "This version changed; reload its preview");
};
const verifiedObservation = (
  o: PublicationObservation | null,
  expected: PublicationContent,
) => {
  if (
    !o ||
    !o.id ||
    !o.revision ||
    o.content?.title !== expected.title ||
    o.content?.text !== expected.text
  )
    throw new PublishingError(
      409,
      "Provider content is not verified; reconcile before taking another action",
    );
  let url: URL;
  try {
    url = new URL(o.url);
  } catch {
    throw new PublishingError(
      409,
      "Provider did not return a valid result URL",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password)
    throw new PublishingError(409, "Provider result URL is not supported");
  return o;
};
/** This engine has no implicit provider or publication grant. Adapters are explicitly installed by the host application. */
export async function handlePublishing(
  request: { method?: string; query?: Record<string, any>; body?: any },
  member: { orgId: string; uid: string },
  deps: {
    store: PublishingStore;
    projects: (org: string) => Promise<Array<{ id: string; name: string }>>;
    membership: (uid: string, org: string) => Promise<{ role: string }>;
    adapters: Record<string, PublishingAdapter>;
  },
) {
  assertHumanDecision(member, 'publishing', request.body);
  const b = request.body || {},
    q = request.query || {},
    projectId = String(b.projectId || q.projectId || ""),
    projects = await deps.projects(member.orgId);
  if (request.method === "GET" && !projectId) return { projects };
  if (!projects.some((p) => p.id === projectId))
    throw new PublishingError(403, "Choose a permitted project");
  await deps.membership(member.uid, member.orgId);
  const store = deps.store,
    read = async () =>
      normalizeLedger(await store.read(member.orgId, projectId));
  const transact = async (
    update: (r: ReturnType<typeof normalizeLedger>) => void,
  ) =>
    store.transact(member.orgId, projectId, (raw) => {
      const r = normalizeLedger(raw);
      update(r);
      r.revision++;
      return r;
    });
  const admin = async () => {
    const actor = await deps.membership(member.uid, member.orgId);
    if (!["owner", "admin"].includes(actor.role))
      throw new PublishingError(
        403,
        "An administrator must grant or approve public publication",
      );
  };
  const initial = await read(),
    id = String(b.id || q.id || ""),
    pick = (r: ReturnType<typeof normalizeLedger>) => {
      const p = r.items[id];
      if (!p) throw new PublishingError(404, "Publication not found");
      return p;
    };
  if (request.method === "GET")
    return publicResult(
      id
        ? { item: pick(initial) }
        : {
            items: Object.values(initial.items).map(
              ({ content, sourceNotes, history, ...row }) => ({
                ...row,
                title: content.title,
              }),
            ),
            targets: Object.values(initial.targets),
            revision: initial.revision,
            adapters: Object.keys(deps.adapters),
          },
    );
  if (request.method !== "POST")
    throw new PublishingError(405, "Method not allowed");
  if (b.operation === "configure_target") {
    await admin();
    const targetId = String(b.target?.id || "");
    if (!/^[a-z][a-z0-9_-]{2,60}$/.test(targetId))
      throw new PublishingError(422, "Enter a stable target identity");
    const old = initial.targets[targetId];
    let target: PublishingTarget;
    if (b.enabled === false) {
      if (!old) throw new PublishingError(404, "Target not found");
      target = { ...old, enabled: false, revision: old.revision + 1 };
    } else {
      const t = b.target;
      if (!deps.adapters[t.adapter])
        throw new PublishingError(
          503,
          "Select and connect a supported social or website provider first",
        );
      if (
        !["social", "website"].includes(t.kind) ||
        typeof t.resource !== "string" ||
        !t.resource.trim() ||
        t.resource.length > 500 ||
        typeof t.label !== "string" ||
        !t.label.trim() ||
        t.label.length > 120 ||
        b.allowPublish !== true
      )
        throw new PublishingError(
          422,
          "Specify the exact resource and explicitly grant publication",
        );
      target = {
        id: targetId,
        adapter: t.adapter,
        kind: t.kind,
        label: t.label,
        resource: t.resource,
        enabled: true,
        revision: (old?.revision || 0) + 1,
        configuredBy: member.uid,
      };
      await deps.adapters[target.adapter].inspect(target);
    }
    const result = await transact((r) => {
      if (r.revision !== b.revision)
        throw new PublishingError(409, "Target settings changed; reload");
      r.targets[targetId] = target;
    });
    return { revision: result.revision, target };
  }
  if (b.operation === "create") {
    if (
      !/^[a-zA-Z0-9_-]{8,100}$/.test(b.requestId || "") ||
      !["social", "website"].includes(b.kind)
    )
      throw new PublishingError(
        422,
        "Provide a stable request identity and content kind",
      );
    const c = content(b.content),
      notes = String(b.sourceNotes || "").trim();
    if (!notes || notes.length > 4000)
      throw new PublishingError(
        422,
        "Describe the sources and any public-use restrictions",
      );
    const newId = fingerprint([member.uid, b.requestId]).slice(0, 32),
      h = fingerprint([b.kind, c, notes]);
    const result = await transact((r) => {
      if (r.items[newId]) {
        if (r.items[newId].requestHash !== h)
          throw new PublishingError(
            409,
            "Request identity was already used with different content",
          );
        return;
      }
      if (Object.keys(r.items).length >= 200)
        throw new PublishingError(
          422,
          "This project has reached its publication history limit",
        );
      const now = Date.now();
      r.items[newId] = {
        id: newId,
        projectId,
        createdBy: member.uid,
        revision: 1,
        createdAt: now,
        updatedAt: now,
        kind: b.kind,
        content: c,
        sourceNotes: notes,
        contentHash: h,
        requestHash: h,
        state: "draft",
        history: [],
      };
    });
    return publicResult({ item: result.items[newId] });
  }
  const p = pick(initial),
    adapter = () => {
      if (!p.target || !deps.adapters[p.target.adapter])
        throw new PublishingError(
          503,
          "Publication provider is not configured",
        );
      return deps.adapters[p.target.adapter];
    };
  const currentGrant = (
    r: ReturnType<typeof normalizeLedger>,
    row: Publication,
  ) => {
    const t = row.target && r.targets[row.target.id];
    if (!t?.enabled || t.revision !== row.target?.revision)
      throw new PublishingError(
        409,
        "Publication grant changed; prepare a new preview",
      );
    return t;
  };
  if (b.operation === "edit") {
    if (p.createdBy !== member.uid)
      throw new PublishingError(403, "Only the draft author can edit it");
    const c = content(b.content),
      notes = String(b.sourceNotes || "").trim();
    if (!notes || notes.length > 4000)
      throw new PublishingError(
        422,
        "Describe the sources and public-use restrictions",
      );
    const result = await transact((r) => {
      const row = pick(r);
      assertVersion(row, b);
      if (["dispatching", "uncertain", "verified"].includes(row.state))
        throw new PublishingError(
          409,
          "Retain this publication receipt; create a new draft for further changes",
        );
      if (row.history.length >= 30)
        throw new PublishingError(422, "This draft reached its revision limit");
      const history = [
        ...row.history,
        {
          revision: row.revision,
          content: row.content,
          sourceNotes: row.sourceNotes,
          contentHash: row.contentHash,
          at: Date.now(),
          ask: row.ask,
          target: row.target,
          baseline: row.baseline,
        },
      ];
      r.items[id] = {
        id: row.id,
        projectId,
        createdBy: row.createdBy,
        createdAt: row.createdAt,
        updatedAt: Date.now(),
        revision: row.revision + 1,
        kind: row.kind,
        content: c,
        sourceNotes: notes,
        contentHash: fingerprint([row.kind, c, notes]),
        requestHash: row.requestHash,
        state: "draft",
        history,
      };
    });
    return publicResult({ item: result.items[id] });
  }
  if (b.operation === "preview") {
    assertVersion(p, b);
    if (
      !["draft", "rejected", "awaiting_approval", "approved"].includes(p.state)
    )
      throw new PublishingError(
        409,
        "This publication already has an external operation",
      );
    const target = initial.targets[String(b.targetId || "")];
    if (
      !target?.enabled ||
      target.kind !== p.kind ||
      !deps.adapters[target.adapter]
    )
      throw new PublishingError(
        409,
        "Choose a configured target with a current publication grant",
      );
    const baseline = await deps.adapters[target.adapter].inspect(target);
    if (p.kind === "website" && !baseline)
      throw new PublishingError(
        404,
        "The approved website resource does not exist",
      );
    const result = await transact((r) => {
      const row = pick(r);
      assertVersion(row, b);
      if (
        r.targets[target.id]?.revision !== target.revision ||
        !r.targets[target.id]?.enabled
      )
        throw new PublishingError(409, "Target changed during preview");
      if (row.ask) {
        if (row.history.length >= 30)
          throw new PublishingError(
            422,
            "This draft reached its revision limit",
          );
        row.history.push({
          revision: row.revision,
          content: row.content,
          sourceNotes: row.sourceNotes,
          contentHash: row.contentHash,
          at: Date.now(),
          ask: row.ask,
          target: row.target,
          baseline: row.baseline,
        });
      }
      row.target = target;
      row.baseline = baseline;
      row.state = "awaiting_approval";
      row.revision++;
      row.updatedAt = Date.now();
      row.ask = createAsk({
        taskId: id,
        projectId,
        question: `Approve exact ${row.kind} content for ${target.label}? Review source rights and the before/after text. This will be public.`,
        responseType: "approval",
        assignees: [target.configuredBy],
        channels: ["web"],
      });
    });
    return publicResult({ item: result.items[id] });
  }
  if (["approve", "reject"].includes(b.operation)) {
    await admin();
    const result = await transact((r) => {
      const row = pick(r);
      assertVersion(row, b);
      currentGrant(r, row);
      if (
        row.state !== "awaiting_approval" ||
        !row.ask?.assignees?.includes(member.uid)
      )
        throw new PublishingError(
          403,
          "This public-content Ask belongs to the designated administrator",
        );
      if (b.operation === "approve" && b.publicUseChecked !== true)
        throw new PublishingError(
          422,
          "Confirm this exact content is permitted for public use",
        );
      row.ask = recordAskResponse(row.ask, {
        id: randomUUID(),
        at: Date.now(),
        via: "web",
        actor: member.uid,
        decision: b.operation === "approve" ? "approved" : "rejected",
      });
      row.state = b.operation === "approve" ? "approved" : "rejected";
      row.revision++;
      row.updatedAt = Date.now();
    });
    return publicResult({ item: result.items[id] });
  }
  if (!["publish", "reconcile"].includes(b.operation))
    throw new PublishingError(400, "Unknown publishing operation");
  if (b.operation === "publish" && p.state !== "verified") assertVersion(p, b);
  const provider = adapter();
  if (b.operation === "publish" && p.state === "verified")
    return publicResult({ item: p });
  let claimed = p;
  if (b.operation === "publish") {
    await deps.membership(member.uid, member.orgId);
    const result = await transact((r) => {
      const row = pick(r);
      assertVersion(row, b);
      currentGrant(r, row);
      if (row.state !== "approved")
        throw new PublishingError(
          409,
          "A current public-content approval is required",
        );
      row.operationId = fingerprint([
        member.orgId,
        projectId,
        id,
        row.contentHash,
        row.target?.revision,
        row.ask?.id,
      ]);
      row.state = "dispatching";
      row.revision++;
      row.updatedAt = Date.now();
    });
    claimed = result.items[id];
  } else if (!["dispatching", "uncertain", "verified"].includes(p.state))
    throw new PublishingError(409, "No external operation exists to reconcile");
  try {
    if (b.operation === "publish") {
      await deps.membership(member.uid, member.orgId);
      currentGrant(await read(), claimed);
      const baseline = await provider.inspect(claimed.target!);
      if ((baseline?.revision || null) !== (claimed.baseline?.revision || null))
        throw new PublishingError(
          409,
          "Provider content changed after approval",
        );
      // Adapter performs its own provider-side conditional write; this read is not a substitute for it.
      await deps.membership(member.uid, member.orgId);
      currentGrant(await read(), claimed);
      const sent = await provider.publish(claimed.target!, {
        operationId: claimed.operationId!,
        content: claimed.content,
        expectedRevision: claimed.baseline?.revision || null,
      });
      const saved = await transact((r) => {
        const row = pick(r);
        if (row.operationId !== claimed.operationId)
          throw new PublishingError(409, "Publication operation changed");
        row.externalId = sent.id;
        row.revision++;
      });
      claimed = saved.items[id];
    }
    const observation = verifiedObservation(
      await provider.reconcile(claimed.target!, {
        operationId: claimed.operationId!,
        id: claimed.externalId,
      }),
      claimed.content,
    );
    const result = await transact((r) => {
      const row = pick(r);
      if (row.operationId !== claimed.operationId)
        throw new PublishingError(409, "Publication operation changed");
      row.receipt = observation;
      row.state = "verified";
      delete row.error;
      row.revision++;
      row.updatedAt = Date.now();
    });
    return publicResult({ item: result.items[id] });
  } catch (error: any) {
    await transact((r) => {
      const row = pick(r);
      if (
        row.operationId === claimed.operationId &&
        row.revision === claimed.revision
      ) {
        row.state = "uncertain";
        row.error =
          error instanceof PublishingError
            ? error.message
            : "Provider outcome is uncertain; reconcile before taking further action";
        row.revision++;
        row.updatedAt = Date.now();
      }
    });
    throw error instanceof PublishingError
      ? error
      : new PublishingError(
          502,
          "Provider outcome is uncertain; reconcile before taking further action",
        );
  }
}
