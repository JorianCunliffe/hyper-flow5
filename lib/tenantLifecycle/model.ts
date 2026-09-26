/** HyperFlow owns these existing roots. Communications exports remain separate. */
export const TENANT_DATA_ROOTS = [
  "captured_work_items",
  "projects",
  "operational_commitments",
  "visible_flows",
  "artifacts",
  "calendar_ledgers",
  "review_execution",
  "review_work",
  "review_owner_bindings",
  "publishing",
  "external_events",
  "ask_resolutions",
  "communication_delivery",
  "triage_items",
  "triage_digests",
  "schedules",
  "schedule_runs",
  "service_setup_drafts",
  "agent_profiles",
  "agent_inbox_jobs",
  "conversation_contexts",
  "agent_voice_context_requests",
  "integration_connections",
  "integration_credentials",
  "oauth_states",
  "workspace_grants",
  "external_action_receipts",
  "coaching_sessions",
  "communication_cursors",
  "serverActivity",
  "contact_dispatch_days",
  "tenant_control",
  "tenant_files",
] as const;
export const SECRET_ROOTS = new Set<string>([
  "integration_credentials",
  "oauth_states",
  "tenant_control",
]);
export const TENANT_INDEX_ROOTS = [
  "invites",
  "agent_inbox_pending",
  "coaching_retry_pending",
] as const;
export function redactTenantExport(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactTenantExport);
  if (!value || typeof value !== "object") {
    if (
      typeof value === "string" &&
      (/\/forms\/ask\/|\/api\/asks\//.test(value) ||
        /[?&](token|key|signature|X-Goog-Signature|X-Amz-Signature)=/i.test(
          value,
        ))
    )
      return "[redacted capability URL]";
    return value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /(secret|password|authorization|credential|api.?key|cookie|headers|signature|token)/i.test(
        key,
      )
        ? "[redacted]"
        : redactTenantExport(item),
    ]),
  );
}
export type LifecycleState =
  "active" | "pausing" | "suspended" | "erasing" | "erased";
export interface LifecycleReceipt {
  id: string;
  actor: string;
  operation: string;
  at: number;
  revision: number;
  status: "working" | "completed" | "blocked";
  detail?: string;
  counts?: Record<string, number>;
}
export interface TenantLifecycle {
  revision: number;
  state: LifecycleState;
  receipts: Record<string, LifecycleReceipt>;
  activeOperation?: string;
  storageLeases: Record<string, { at: number; path: string }>;
  communicationsReceipt?: {
    owner: "communications-service";
    status: string;
    revision: number;
    requestId?: string;
  };
}
export const lifecycleRecord = (value: any): TenantLifecycle => ({
  revision: 0,
  state: "active",
  ...structuredClone(value),
  receipts: structuredClone(value?.receipts || {}),
  storageLeases: structuredClone(value?.storageLeases || {}),
});
export class LifecycleError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export function beginLifecycle(
  raw: TenantLifecycle | null,
  input: {
    id: string;
    actor: string;
    revision: number;
    operation: "suspend" | "resume" | "erase_database";
  },
  now = Date.now(),
): TenantLifecycle {
  const r = lifecycleRecord(raw),
    prior = r.receipts[input.id];
  if (prior) {
    if (prior.actor !== input.actor || prior.operation !== input.operation)
      throw new LifecycleError(409, "Request identity conflict");
    return r;
  }
  if (r.revision !== input.revision || r.activeOperation)
    throw new LifecycleError(
      409,
      "Lifecycle state changed or an operation is still working",
    );
  if (r.state === "erased" || r.state === "erasing")
    throw new LifecycleError(409, "Erased tenant data cannot be reactivated");
  if (input.operation === "erase_database" && r.state !== "suspended")
    throw new LifecycleError(
      409,
      "Suspend and review the export before erasure",
    );
  if (Object.keys(r.storageLeases).length)
    throw new LifecycleError(
      409,
      "A file operation is still running; reconcile it before changing lifecycle state",
    );
  if (
    input.operation !== "resume" &&
    r.communicationsReceipt?.status !== "suspended" &&
    r.communicationsReceipt?.status !== "closed"
  )
    throw new LifecycleError(
      409,
      "A current Communications suspension receipt is required",
    );
  if (Object.keys(r.receipts).length >= 1000)
    throw new LifecycleError(
      409,
      "Lifecycle history requires an export and retention review",
    );
  r.revision++;
  r.state =
    input.operation === "resume"
      ? "active"
      : input.operation === "suspend"
        ? "pausing"
        : "erasing";
  r.receipts[input.id] = {
    id: input.id,
    actor: input.actor,
    operation: input.operation,
    at: now,
    revision: r.revision,
    status: input.operation === "resume" ? "completed" : "working",
  };
  if (input.operation !== "resume") r.activeOperation = input.id;
  return r;
}
export function finishLifecycle(
  raw: TenantLifecycle | null,
  id: string,
  detail: { blockers?: string[]; counts?: Record<string, number> },
  now = Date.now(),
): TenantLifecycle {
  const r = lifecycleRecord(raw),
    receipt = r.receipts[id];
  if (!receipt) throw new LifecycleError(404, "Lifecycle operation not found");
  if (receipt.status !== "working") return r;
  if (r.activeOperation !== id)
    throw new LifecycleError(409, "Lifecycle operation changed");
  r.revision++;
  if (detail.blockers?.length) {
    r.state = receipt.operation === "suspend" ? "active" : "suspended";
    receipt.status = "blocked";
    receipt.detail = detail.blockers.join("; ").slice(0, 2000);
  } else {
    r.state = receipt.operation === "suspend" ? "suspended" : "erased";
    receipt.status = "completed";
    receipt.counts = detail.counts || {};
  }
  receipt.revision = r.revision;
  receipt.at = now;
  delete r.activeOperation;
  return r;
}
