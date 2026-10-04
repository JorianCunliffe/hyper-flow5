import { runtimeDatabase } from "../runtimeDatabase.js";
import { normalizeFlowRun } from "../flowRunStore.js";
import { respondToAsk } from "../asks/respondToAsk.js";
import { receptionStore } from "./store.js";
import { digest, fail } from "./model.js";
import type { HumanAsk } from "../../types.js";
const key = (v: string) => encodeURIComponent(v).replace(/\./g, "%2E");
export async function listActiveReceptionRuns(org: string, project: string) {
  const ref = (await runtimeDatabase()).ref(
    `flow_runs/${key(org)}/${key(project)}`,
  );
  const snapshots = await Promise.all(
    ["running", "waiting"].map((status) =>
      ref.orderByChild("status").equalTo(status).get(),
    ),
  );
  return snapshots.flatMap((s) =>
    Object.values(s.val() || {}).map(normalizeFlowRun),
  );
}
export const askVersion = (ask: HumanAsk, runId: string) =>
  digest({
    id: ask.id,
    runId,
    prompt: ask.prompt,
    fields: ask.fields,
    cycle: ask.escalationState?.cycle,
    revision: ask.revision,
    responses: ask.responses,
  });
export const addressedTo = (ask: HumanAsk, person: string) =>
  ask.personId === person ||
  ask.assignees?.includes(person) ||
  ask.deliveries?.some((d) => d.personId === person);
export async function pendingReceptionAsks(
  org: string,
  project: string,
  person: string,
  readRuns = listActiveReceptionRuns,
  now = Date.now(),
) {
  const runs = await readRuns(org, project);
  return runs.flatMap((run) =>
    run.state.milestones.flatMap((node) =>
      (node.asks || [])
        .filter(
          (a) =>
            a.status === "open" &&
            (!a.dueAt || a.dueAt > now) &&
            addressedTo(a, person),
        )
        .map((a) => ({
          id: a.id,
          runId: run.id,
          version: askVersion(a, run.id),
          prompt: a.prompt,
          fields: a.fields || [],
          responses: a.responses
            .filter((r) => r.actor === person)
            .map((r) => ({ values: r.values, text: r.text })),
          cycle: a.escalationState?.cycle || 0,
        })),
    ),
  );
}
const leaseId = (project: string, ask: string) => digest([project, ask]);
export async function bindReceptionAsk(
  org: string,
  project: string,
  ask: string,
  person: string,
  session: string,
  deps = {
    store: receptionStore,
    pending: pendingReceptionAsks,
    now: Date.now,
  },
) {
  if (!(await deps.pending(org, project, person)).some((a) => a.id === ask))
    fail(409, "This request is no longer pending for this caller.");
  return deps.store.transact<any>(
    org,
    "ask_leases",
    leaseId(project, ask),
    (lease) => {
      if (
        lease?.kind === "outbound" ||
        (lease?.kind === "inbound" &&
          lease.session !== session &&
          lease.until > deps.now())
      )
        fail(
          409,
          "Another delivery is already in progress. Please take a message.",
        );
      return {
        kind: "inbound",
        session,
        person,
        until: deps.now() + 15 * 60000,
      };
    },
  );
}
/** Serializes dispatch against verified inbound participation. Unknown outbound
 * outcomes remain held rather than expiring into a duplicate call. */
export async function withReceptionAskDispatch<T>(
  org: string,
  project: string,
  ask: string,
  operation: string,
  dispatch: () => Promise<T>,
  deps = { store: receptionStore, now: Date.now },
): Promise<T> {
  if (process.env.PROJECT_RECEPTION_ENABLED !== "true") return dispatch();
  const config = await deps.store.read<any>(org, "config", "current");
  if (
    !config?.projects?.some(
      (p: any) =>
        p.projectId === project &&
        p.enabled &&
        p.actions.includes("resume_ask"),
    ) ||
    !config.lines.some((l: any) => l.enabled && l.projectIds.includes(project))
  )
    return dispatch();
  const id = leaseId(project, ask);
  await deps.store.transact<any>(org, "ask_leases", id, (l) => {
    if (
      l?.kind === "outbound" ||
      (l?.kind === "inbound" && l.until > deps.now())
    )
      fail(409, "An inbound answer or unresolved delivery owns this Ask.");
    return { kind: "outbound", operation, id, projectId: project, askId: ask };
  });
  const result = await dispatch();
  await deps.store.transact<any>(org, "ask_leases", id, (l) =>
    l?.operation === operation ? { kind: "idle" } : l,
  );
  return result;
}
export async function answerReceptionAsk(
  org: string,
  project: string,
  person: string,
  session: string,
  communicationId: string,
  proposal: any,
  deps = {
    pending: pendingReceptionAsks,
    bind: bindReceptionAsk,
    respond: respondToAsk,
  },
) {
  const p = proposal.value;
  const current = (await deps.pending(org, project, person)).find(
    (a) => a.id === p.askId && a.runId === p.runId && a.version === p.version,
  );
  if (!current)
    fail(409, "Questions changed or expired. Refresh the pending request.");
  await deps.bind(org, project, p.askId, person, session);
  const result = await deps.respond({
    orgId: org,
    projectId: project,
    askId: p.askId,
    channel: "voice",
    communicationId,
    actorVerified: true,
    expectedAsk: { runId: p.runId, version: p.version },
    response: { structured: p.answers, text: p.text, actor: person },
  });
  return result;
}

export async function reconcileReceptionAsk(org: string, id: string) {
  const lease = await receptionStore.read<any>(org, "ask_leases", id);
  if (lease?.kind !== "outbound")
    fail(409, "No uncertain outbound dispatch owns this Ask.");
  const { readActionDispatch } = await import("../actionDispatch.js");
  const receipt = await readActionDispatch(org, lease.operation);
  if (!receipt?.outcome && !receipt?.terminal)
    return {
      status: "uncertain",
      operationId: lease.operation,
      notice:
        "Reconcile the owning Communications request before releasing this Ask.",
    };
  await receptionStore.transact<any>(org, "ask_leases", id, (l) => {
    if (l?.operation !== lease.operation) fail(409, "Ask ownership changed.");
    return { kind: "idle", reconciledOperation: lease.operation };
  });
  return {
    status: "reconciled",
    receipt: { state: receipt.state, externalId: receipt.externalId },
  };
}
