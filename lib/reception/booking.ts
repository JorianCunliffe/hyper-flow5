import {
  digest,
  fail,
  type ReceptionProject,
  type ReceptionConfig,
} from "./model.js";
import { receptionStore } from "./store.js";
import { readProjectWorkspaceResources } from "../workspaceResourceCatalog.js";
import { withActionExecutionScope } from "../actionExecutionScope.js";
export const minutes = (v: any) => {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(v)))
    fail(422, "Use a 24-hour HH:mm time.");
  const [h, m] = String(v).split(":").map(Number);
  return h * 60 + m;
};
export const validDate = (v: any) =>
  typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}$/.test(v) &&
  Number.isFinite(Date.parse(v + "T00:00:00Z")) &&
  new Date(v + "T00:00:00Z").toISOString().slice(0, 10) === v;
export function validateBooking(
  value: any,
  policy: NonNullable<ReceptionProject["booking"]>,
  rows: unknown[][],
  windows: any[],
) {
  if (
    !validDate(value.date) ||
    !policy.properties.includes(value.property) ||
    !String(value.attendees || "").trim() ||
    !Number.isInteger(value.groupSize) ||
    value.groupSize < 1
  )
    fail(
      422,
      "Confirm date, configured property, attendees and positive group size.",
    );
  const start = minutes(value.time),
    end = start + policy.durationMinutes;
  if (
    end > 1440 ||
    !windows.some(
      (w) =>
        w.date === value.date &&
        w.properties?.includes(value.property) &&
        minutes(w.start) <= start &&
        minutes(w.end) >= end,
    )
  )
    fail(
      409,
      "No confirmed staff availability covers this inspection. Save an enquiry instead.",
    );
  if (rows.length >= 500)
    fail(
      409,
      "Diary read may be truncated. Review the complete diary before booking.",
    );
  const c = policy.columns;
  for (const row of rows) {
    if (row.every((v) => v === null || v === "")) continue;
    const date = String(row[c.date] || "");
    if (!validDate(date))
      fail(
        409,
        "Diary contains an unrecognized date; review it before booking.",
      );
    if (
      date !== value.date ||
      /cancelled|canceled/i.test(String(row[c.status]))
    )
      continue;
    const t = minutes(row[c.time]),
      same = row[c.property] === value.property;
    if (same && t === start) continue; // A compatible group shares the slot; there is no attendee cap.
    const gap = same ? 0 : policy.travelMinutes;
    if (start < t + policy.durationMinutes + gap && end + gap > t)
      fail(409, "Inspection conflicts with the diary or travel time.");
  }
}
export function bookingRow(
  value: any,
  policy: NonNullable<ReceptionProject["booking"]>,
  marker: string,
) {
  const c = policy.columns,
    row: any[] = Array(Math.max(...Object.values(c)) + 1).fill("");
  row[c.date] = value.date;
  row[c.time] = value.time;
  row[c.property] = value.property;
  row[c.attendees] = value.attendees;
  row[c.groupSize] = value.groupSize;
  row[c.status] = `confirmed ${marker}`;
  return row;
}

/** Shared by morning append nodes and live reception. An uncertain write retains
 * the diary lock until exact readback reconciliation, never a time-based replay. */
export const diaryDependencies = {
  store: receptionStore,
  resources: readProjectWorkspaceResources,
  now: Date.now,
  read: async (org: string, project: string, name: string) =>
    withActionExecutionScope({ resourceName: name }, async () =>
      (
        await import("../integrations/googleWorkspace.js")
      ).readGrantedGoogleSheet(org, project),
    ),
};
export async function guardDiaryAppend(
  org: string,
  projectId: string,
  selected: { spreadsheetId: string; range: string; resourceName?: string },
  values: unknown[][],
  operationId: string,
  write: () => Promise<any>,
  deps = diaryDependencies,
) {
  if (process.env.PROJECT_RECEPTION_ENABLED !== "true") return write();
  const config = await deps.store.read<ReceptionConfig>(
    org,
    "config",
    "current",
  );
  const policies = (config?.projects || []).filter(
    (p) =>
      p.enabled &&
      p.booking &&
      config!.lines.some(
        (l) => l.enabled && l.projectIds.includes(p.projectId),
      ),
  );
  let policy: ReceptionProject | undefined;
  for (const p of policies) {
    const resource = (await deps.resources(org, p.projectId)).find(
      (r) => r.name === p.booking!.resourceName,
    );
    if (resource?.spreadsheetId === selected.spreadsheetId) {
      if (resource.range !== selected.range)
        fail(409, "Use the exact protected diary range for inspection writes.");
      if (policy && digest(policy.booking) !== digest(p.booking))
        fail(409, "Conflicting policies share this diary.");
      policy = p;
    }
  }
  if (!policy) return write();
  const p = policy,
    b = p.booking!,
    lockId = "booking_dispatch";
  const owner = digest([projectId, operationId]),
    fingerprint = digest(values);
  const current = await deps.store.read<any>(org, "diary_locks", lockId);
  if (current?.owner === owner && current.status === "verified") {
    if (current.fingerprint !== fingerprint)
      fail(409, "Diary operation payload changed.");
    return current.result;
  }
  await deps.store.transact<any>(org, "diary_locks", lockId, (lock) => {
    if (lock?.status === "pending")
      fail(
        409,
        "Diary has an unresolved operation. Reconcile it before booking.",
      );
    return {
      owner,
      projectId,
      operationId,
      fingerprint,
      status: "pending",
      values,
      resourceName: b.resourceName,
      policyProjectId: p.projectId,
      policy: b,
      startedAt: deps.now(),
    };
  });
  let dispatched = false;
  try {
    const read = () => deps.read(org, p.projectId, b.resourceName);
    const before = await read();
    const availability = await deps.store.read<any>(
      org,
      "availability",
      digest([p.projectId, b.staffPersonId]),
    );
    const windows =
      availability?.expiresAt > deps.now() ? availability.windows : [];
    const planned = [...before.values];
    for (const row of values) {
      const c = b.columns;
      validateBooking(
        {
          date: row[c.date],
          time: row[c.time],
          property: row[c.property],
          attendees: row[c.attendees],
          groupSize: Number(row[c.groupSize]),
        },
        b,
        planned,
        windows,
      );
      planned.push(row);
    }
    await deps.store.transact<any>(org, "diary_locks", lockId, (l) => ({
      ...l,
      before: before.values,
    }));
    if (digest((await read()).values) !== digest(before.values))
      fail(
        409,
        "Diary changed before dispatch. Review the proposed booking again.",
      );
    const latest = await deps.store.read<ReceptionConfig>(
      org,
      "config",
      "current",
    );
    if (latest?.revision !== config!.revision)
      fail(409, "Reception policy changed before booking.");
    if (
      digest(
        await deps.store.read(
          org,
          "availability",
          digest([p.projectId, b.staffPersonId]),
        ),
      ) !== digest(availability)
    )
      fail(409, "Staff availability changed before dispatch.");
    dispatched = true;
    const result = await write();
    const after = await read();
    if (digest(after.values) !== digest([...before.values, ...values]))
      fail(
        409,
        "Diary readback differs from the expected rows; the booking needs reconciliation.",
      );
    await deps.store.transact<any>(org, "diary_locks", lockId, (l) => ({
      ...l,
      status: "verified",
      result,
    }));
    return result;
  } catch (error) {
    if (!dispatched)
      await deps.store.transact<any>(org, "diary_locks", lockId, (l) => ({
        ...l,
        status: "held",
      }));
    throw error;
  }
}
export async function reconcileDiary(org: string, id: string) {
  const lock = await receptionStore.read<any>(org, "diary_locks", id);
  if (!lock || lock.status !== "pending" || !lock.before)
    fail(409, "No dispatched diary operation is available to reconcile.");
  const { readGrantedGoogleSheet } =
    await import("../integrations/googleWorkspace.js");
  const read = await withActionExecutionScope(
    { resourceName: lock.resourceName },
    () => readGrantedGoogleSheet(org, lock.policyProjectId),
  );
  if (digest(read.values) !== digest([...lock.before, ...lock.values]))
    return {
      status: "uncertain",
      notice:
        "Review the diary and owning provider receipt. No operation was repeated.",
    };
  await receptionStore.transact<any>(org, "diary_locks", id, (l) => ({
    ...l,
    status: "verified",
    result: { verified: true, reconciled: true },
  }));
  return { status: "verified" };
}

export async function rejectDiaryUpsert(
  org: string,
  selected: { spreadsheetId: string },
) {
  if (process.env.PROJECT_RECEPTION_ENABLED !== "true") return;
  const config = await receptionStore.read<ReceptionConfig>(
    org,
    "config",
    "current",
  );
  for (const p of config?.projects || [])
    if (p.enabled && p.booking) {
      const r = (await readProjectWorkspaceResources(org, p.projectId)).find(
        (r) => r.name === p.booking!.resourceName,
      );
      if (r?.spreadsheetId === selected.spreadsheetId)
        fail(
          409,
          "Protected inspection diaries require the shared append/receipt path. Review changes manually.",
        );
    }
}
