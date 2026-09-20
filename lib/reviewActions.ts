import { createHash, randomUUID } from "node:crypto";
import { runtimeDatabase } from "./runtimeDatabase.js";
import { HttpCommunicationsClient } from "./communications/client.js";
import { requireOrganizationMember, findProject } from "./serverStore.js";
import { handleCalendar } from "./calendar/api.js";

export interface ReviewActionEvent {
  type: "review.action.requested";
  tenant_id: string;
  payload: {
    contract_version: "review-action.v1";
    action_id: string;
    idempotency_key: string;
    owner_id: string;
    session_id: string;
    instruction: string;
    scope: Record<string, any>;
    proposal: {
      version: "review-action.v1";
      type: "email" | "follow_up" | "calendar" | "reminder" | "task";
      project_id: string;
      authorization: "CONFIRMED";
      clarification: string[];
      parameters: Record<string, any>;
      timezone?: string;
    };
  };
}
type Receipt = {
  status: "RUNNING" | "SUCCEEDED" | "FAILED";
  receipt_id: string;
  result: Record<string, unknown>;
};
type State = {
  hash: string;
  receipt?: Receipt;
  event_json: string;
  created_at: string;
  lease_owner?: string;
  lease_until?: number;
};
export interface ReviewActionDependencies {
  authorize(event: ReviewActionEvent): Promise<string>;
  transact(
    tenant: string,
    id: string,
    update: (state: State | null) => State,
  ): Promise<State>;
  execute(event: ReviewActionEvent, uid: string): Promise<Receipt>;
  report(tenant: string, id: string, receipt: Receipt): Promise<unknown>;
}
const canonical = (value: any): any =>
  Array.isArray(value)
    ? value.map(canonical)
    : value && typeof value === "object"
      ? Object.fromEntries(
          Object.keys(value)
            .sort()
            .map((k) => [k, canonical(value[k])]),
        )
      : value;
const key = (s: string) => encodeURIComponent(s).replace(/\./g, "%2E");
export function validateReviewAction(
  value: any,
): asserts value is ReviewActionEvent {
  const p = value?.payload,
    proposal = p?.proposal;
  if (
    value?.type !== "review.action.requested" ||
    typeof value.tenant_id !== "string" ||
    !value.tenant_id ||
    p?.contract_version !== "review-action.v1" ||
    !p.action_id ||
    p.idempotency_key !== p.action_id ||
    !p.owner_id ||
    !p.session_id ||
    proposal?.version !== "review-action.v1" ||
    proposal.authorization !== "CONFIRMED" ||
    !Array.isArray(proposal.clarification) ||
    proposal.clarification.length ||
    !["email", "follow_up", "reminder", "calendar", "task"].includes(
      proposal.type,
    ) ||
    !proposal.project_id ||
    !proposal.parameters
  )
    throw new Error("Invalid authorized review action");
  if (
    (p.scope?.external_project_id &&
      p.scope.external_project_id !== proposal.project_id) ||
    (p.scope?.allowed_project_ids &&
      !p.scope.allowed_project_ids.includes(proposal.project_id))
  )
    throw new Error("Review action is outside its authorized scope");
  const required: Record<string, string[]> = {
    email: ["recipient_person_id", "recipient_email", "subject", "body"],
    follow_up: ["recipient_person_id", "recipient_email", "subject", "body"],
    reminder: ["text", "scheduled_at"],
    task: ["title"],
    calendar: ["calendar_key", "proposal_id", "hash"],
  };
  if (
    required[proposal.type].some(
      (f) =>
        typeof proposal.parameters[f] !== "string" ||
        !proposal.parameters[f].trim(),
    )
  )
    throw new Error("Review action needs clarification");
  if(proposal.type==="calendar"&&(!Number.isSafeInteger(proposal.parameters.expected_revision)||proposal.parameters.expected_revision<1))throw new Error("Calendar approval revision required");
  if (
    proposal.type === "reminder" &&
    !Number.isFinite(Date.parse(proposal.parameters.scheduled_at))
  )
    throw new Error("Invalid reminder schedule");
}
export async function consumeReviewAction(
  event: unknown,
  deps: ReviewActionDependencies = productionReviewActions,
) {
  validateReviewAction(event);
  const uid = await deps.authorize(event);
  const hash = createHash("sha256")
    .update(JSON.stringify(canonical(event.payload)))
    .digest("hex");
  const tenant = event.tenant_id,
    id = event.payload.action_id,
    worker = randomUUID();
  let state = await deps.transact(tenant, id, (current) => {
    if (current && current.hash !== hash)
      throw new Error("Review action identity conflict");
    const row = current || {
      hash,
      event_json: JSON.stringify(event),
      created_at: new Date().toISOString(),
    };
    if (row.receipt && row.receipt.status !== "RUNNING") return row;
    if (row.lease_until && row.lease_until > Date.now()) return row;
    return { ...row, lease_owner: worker, lease_until: Date.now() + 120000 };
  });
  // Every adapter below owns its provider idempotency/atomic claim. A worker
  // receipt is committed before callback so a lost callback never repeats effects.
  if (!state.receipt || state.receipt.status === "RUNNING") {
    if (state.lease_owner !== worker)
      throw new Error(
        "Review action is already executing; retry after its lease",
      );
    let receipt: Receipt;
    try {
      receipt = await deps.execute(JSON.parse(state.event_json), uid);
    } catch (error) {
      const summary =
        `Execution is unconfirmed; reconciliation will retry. ${error instanceof Error ? error.message : String(error)}`.slice(
          0,
          1000,
        );
      const uncertain: Receipt = {
        status: "RUNNING",
        receipt_id: `${id}:uncertain:${createHash("sha256").update(summary).digest("hex").slice(0, 16)}`,
        result: { summary, retryable: true },
      };
      await deps.transact(tenant, id, (current) => {
        if (!current || current.lease_owner !== worker) throw error;
        return { ...current, receipt: uncertain };
      });
      await deps.report(tenant, id, uncertain).catch(() => undefined);
      throw error;
    }
    state = await deps.transact(tenant, id, (current) => {
      if (!current || current.hash !== hash)
        throw new Error("Review action changed");
      if (current.receipt && current.receipt.status !== "RUNNING")
        return current;
      if (current.lease_owner !== worker)
        throw new Error("Review execution lease changed");
      return { ...current, receipt, lease_until: 0 };
    });
  }
  await deps.report(tenant, id, state.receipt!);
  return state.receipt;
}
async function authorize(event: ReviewActionEvent) {
  const db = await runtimeDatabase();
  const binding = (
    await db
      .ref(
        `review_owner_bindings/${key(event.tenant_id)}/${key(event.payload.owner_id)}`,
      )
      .get()
  ).val();
  if (
    !binding?.enabled ||
    !binding.uid ||
    !binding.project_ids?.includes(event.payload.proposal.project_id)
  )
    throw new Error(
      "Review executor owner or project authorization is unavailable",
    );
  await requireOrganizationMember(binding.uid, event.tenant_id);
  if (!(await findProject(event.tenant_id, event.payload.proposal.project_id)))
    throw new Error("Review action project unavailable");
  return binding.uid;
}
export const productionReviewActions: ReviewActionDependencies = {
  authorize,
  async transact(tenant, id, update) {
    const ref = (await runtimeDatabase()).ref(
      `review_execution/${key(tenant)}/${key(id)}`,
    );
    const result = await ref.transaction((current) =>
      JSON.parse(JSON.stringify(update(current))),
    );
    if (!result.committed)
      throw new Error("Review execution transaction failed");
    return result.snapshot.val();
  },
  async execute(event, uid) {
    const { proposal, action_id: id, owner_id } = event.payload,
      tenant = event.tenant_id,
      p = proposal.parameters;
    const client = new HttpCommunicationsClient();
    const succeeded = (
      provider_id: string,
      summary: string,
      completed_at = new Date().toISOString(),
    ): Receipt => ({
      status: "SUCCEEDED",
      receipt_id: `${id}:succeeded`,
      result: { provider_id, summary, completed_at },
    });
    if (proposal.type === "task" || proposal.type === "reminder") {
      const ref = (await runtimeDatabase()).ref(
        `review_work/${key(tenant)}/${key(id)}`,
      );
      const result = await ref.transaction(
        (current) =>
          current || {
            id,
            owner_id,
            uid,
            project_id: proposal.project_id,
            type: proposal.type,
            title: p.title || p.text,
            status: "OPEN",
            scheduled_at: p.scheduled_at || null,
            timezone: proposal.timezone || null,
            created_at: new Date().toISOString(),
          },
      );
      if (!result.committed) throw new Error("Work item persistence failed");
      return succeeded(
        id,
        proposal.type === "reminder"
          ? `Reminder scheduled for ${p.scheduled_at}`
          : "Task created",
        result.snapshot.val().created_at,
      );
    }
    if (proposal.type === "calendar") {
      const body = {
        operation: "execute",
        projectId: proposal.project_id,
        calendarKey: p.calendar_key,
        proposalId: p.proposal_id,
        hash: p.hash,
        expectedRevision: p.expected_revision,
      };
      let result: any;
      try {
        result = await handleCalendar(
          { method: "POST", body },
          { orgId: tenant, uid },
        );
      } catch (error) {
        // The calendar primitive reconciles provider state after uncertain writes.
        result = await handleCalendar(
          { method: "POST", body: { ...body, operation: "reconcile" } },
          { orgId: tenant, uid },
        );
      }
      const saved = result.item?.proposals?.find(
        (x: any) => x.id === p.proposal_id,
      );
      if (saved?.status !== "verified" || !saved.receipt?.eventId)
        throw new Error(
          saved?.error || "Calendar outcome requires reconciliation",
        );
      return succeeded(
        saved.receipt.eventId,
        "Calendar change verified",
        saved.receipt.observedAt,
      );
    }
    const sent = await client.sendEmail({
      to: [p.recipient_email],
      person_id: p.recipient_person_id,
      subject: p.subject,
      text: p.body,
      ...(p.provider_connection_id
        ? { provider_connection_id: p.provider_connection_id }
        : {}),
      correlation: {
        tenant_id: tenant,
        external_project_id: proposal.project_id,
        run_id: id,
        task_id: id,
      },
      purpose: { type: "workflow_action" },
    });
    const observed = await client.getCommunication(tenant, sent.id);
    if (observed.status === "failed")
      return {
        status: "FAILED",
        receipt_id: `${id}:failed`,
        result: {
          provider_id: sent.id,
          summary: observed.error || "Email delivery failed",
          retryable: false,
        },
      };
    // Queued mail is not provider execution evidence.
    if (
      observed.status !== "completed" &&
      !(
        ["accepted", "sent", "delivered"].includes(
          observed.deliveryStatus || "",
        ) && observed.providerId
      )
    )
      return {
        status: "RUNNING",
        receipt_id: `${id}:running`,
        result: {
          provider_id: sent.id,
          summary: "Email is awaiting provider completion",
        },
      };
    return succeeded(
      observed.providerId || observed.messageId || observed.id,
      "Email accepted by the provider for sending",
      observed.occurredAt,
    );
  },
  report(tenant, id, receipt) {
    return new HttpCommunicationsClient().reviewActionResult(
      tenant,
      id,
      receipt,
    );
  },
};

export async function retryReviewActions() {
  const db = await runtimeDatabase(),
    root = await db.ref("review_execution").get();
  const results = [];
  for (const group of Object.values(root.val() || {}) as Record<
    string,
    State
  >[])
    for (const state of Object.values(group)) {
      const event: ReviewActionEvent = JSON.parse(state.event_json);
      // Re-send terminal receipts too: callback failure is recoverable without a new effect.
      if ((state as any).reported_at && state.receipt?.status !== "RUNNING")
        continue;
      try {
        await consumeReviewAction(event);
        await db
          .ref(
            `review_execution/${key(event.tenant_id)}/${key(event.payload.action_id)}`,
          )
          .update({ reported_at: new Date().toISOString() });
        results.push({ id: event.payload.action_id, status: "reported" });
      } catch (error) {
        results.push({
          id: event.payload.action_id,
          status: "pending",
          error: String(error),
        });
      }
    }
  return results;
}
