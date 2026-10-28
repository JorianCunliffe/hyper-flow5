import { canonicalHash } from "../canonicalHash.js";
import { calendarInstant } from "../calendar/time.js";
import { TenantControlError } from "../tenantControl/model.js";

export type BriefingMember = {
  orgId: string;
  uid: string;
  role?: string;
  email?: string;
  apiClientId?: string;
};
export type Subject = {
  id: string;
  name: string;
  email?: string;
  aliases: string[];
  kind?: "member" | "assignee";
};
export type BriefingItem = {
  id: string;
  source: string;
  sourceId: string;
  kind: "task" | "approval";
  title: string;
  projectId?: string;
  projectName?: string;
  assigneeUid?: string;
  assigneeLabel?: string;
  reviewerUid?: string;
  reviewerUids?: string[];
  status: string;
  version: string;
  dueAt?: string;
  updatedAt?: number;
  actions: string[];
  statusOptions?: string[];
  notice?: string;
  details?: string;
  requiredChecks?: string[];
  evidenceHash?: string;
  /** Never expose domain commands or capability tokens in tool responses. */
  commands?: Record<string, Record<string, any>>;
};
export type BriefingSnapshot = {
  asOf: string;
  timezone?: string;
  statusOptions?: string[];
  items: BriefingItem[];
  progress?: BriefingItem[];
  subjects: Subject[];
  notices: string[];
  incomplete: boolean;
};
export const fingerprint = canonicalHash;
export const fail = (status: number, message: string): never => {
  throw new TenantControlError(status, message);
};
export const rows = <T = any>(value: any): T[] =>
  Array.isArray(value) ? value.filter(Boolean) : Object.values(value || {});
export const publicItem = ({ commands, ...item }: BriefingItem) => item;
export const assignedToSubject = (item: BriefingItem, subject: string) =>
  item.kind === "approval"
    ? (item.reviewerUids || [item.reviewerUid]).includes(subject)
    : item.assigneeUid === subject;
export const closed = (status: string) =>
  [
    "completed",
    "complete",
    "fulfilled",
    "cancelled",
    "dismissed",
    "abandoned",
    "rejected",
  ].includes(status.toLowerCase());

/** Legacy names resolve only against unique verified membership/email bindings. */
export function resolveAssignee(
  value: unknown,
  subjects: Subject[],
  bindings: Record<string, string> = {},
): string | undefined {
  if (typeof value !== "string" || !value.trim()) return;
  const v = value.trim();
  if (bindings[v] && subjects.some((s) => s.id === bindings[v]))
    return bindings[v];
  const matches = subjects.filter((s) =>
    [s.id, `user:${s.id}`, s.email, ...s.aliases].some(
      (a) => a?.toLowerCase() === v.toLowerCase(),
    ),
  );
  return matches.length === 1 ? matches[0].id : undefined;
}
export function subjectFor(
  input: unknown,
  member: BriefingMember,
  subjects: Subject[],
): string {
  if (!input || input === "me") return member.uid;
  if (input === "all") {
    if (!["owner", "admin"].includes(member.role || ""))
      fail(403, "Only an administrator may request all users");
    return "all";
  }
  const id = resolveAssignee(input, subjects);
  if (!id)
    fail(
      422,
      "Choose one of the returned user IDs; this person is unknown or ambiguous",
    );
  if (id !== member.uid && !["owner", "admin"].includes(member.role || ""))
    fail(403, "Reports for other users require administrator membership");
  return id;
}
export function queryBriefing(
  snapshot: BriefingSnapshot,
  member: BriefingMember,
  input: any = {},
) {
  const subject = subjectFor(input.subject, member, snapshot.subjects);
  const kind = input.kind || "task";
  if (!["task", "approval", "all"].includes(kind))
    fail(422, "Choose tasks or approvals");
  const limit = input.limit === undefined ? 20 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    fail(422, "limit must be 1–100");
  let items = snapshot.items.filter(
    (i) =>
      (kind === "all" || i.kind === kind) &&
      (!input.projectId || i.projectId === input.projectId),
  );
  items = items.filter(
    (i) => subject === "all" || assignedToSubject(i, subject),
  );
  if (input.status) items = items.filter((i) => i.status === input.status);
  else if (!input.includeClosed) items = items.filter((i) => !closed(i.status));
  items.sort(
    (a, b) =>
      (a.dueAt || "9999").localeCompare(b.dueAt || "9999") ||
      a.id.localeCompare(b.id),
  );
  const total = items.length;
  if (input.after) {
    const index = items.findIndex((i) => i.id === input.after);
    if (index < 0) fail(409, "The list changed; refresh before continuing");
    items = items.slice(index + 1);
  }
  const page = items.slice(0, limit);
  return {
    asOf: snapshot.asOf,
    subject,
    items: page.map(publicItem),
    total,
    next: items.length > limit ? page.at(-1)!.id : null,
    incomplete: snapshot.incomplete,
    notices: snapshot.notices,
    statusOptions: snapshot.statusOptions,
  };
}
export function briefingReport(
  snapshot: BriefingSnapshot,
  member: BriefingMember,
  input: any = {},
) {
  const subject = subjectFor(input.subject, member, snapshot.subjects);
  const reportType = input.reportType || "workload";
  if (!["workload", "progress", "approvals"].includes(reportType))
    fail(422, "Choose workload, progress or approvals");
  const date = (value: any) => {
    if (!value) return undefined;
    if (
      typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      !Number.isFinite(Date.parse(value)) ||
      new Date(value).toISOString().slice(0, 10) !== value
    )
      fail(422, "Report dates must be valid ISO calendar dates");
    return Date.parse(
      calendarInstant(value + "T00:00", snapshot.timezone || "UTC"),
    );
  };
  const start = date(input.startDate),
    endStart = date(input.endDate);
  const nextDay = input.endDate
    ? new Date(Date.parse(input.endDate) + 86400000).toISOString().slice(0, 10)
    : undefined;
  const end = nextDay ? date(nextDay)! - 1 : undefined;
  if (start !== undefined && end !== undefined && end < start)
    fail(422, "End date precedes start date");
  const selected = (
    reportType === "progress" ? snapshot.progress || [] : snapshot.items
  )
    .filter(
      (i) =>
        (reportType === "approvals"
          ? i.kind === "approval"
          : i.kind === "task") &&
        (subject === "all" || assignedToSubject(i, subject)) &&
        (!input.projectId || input.projectId === i.projectId),
    )
    .filter((i) => {
      const time =
        reportType === "progress"
          ? i.updatedAt
          : i.dueAt
            ? Date.parse(i.dueAt)
            : undefined;
      return (
        (start === undefined || (time !== undefined && time >= start)) &&
        (end === undefined || (time !== undefined && time <= end))
      );
    });
  const byUser = (
    subject === "all"
      ? snapshot.subjects
      : snapshot.subjects.filter((s) => s.id === subject)
  ).map((s) => {
    const items = selected.filter((i) => assignedToSubject(i, s.id));
    return {
      userId: s.id,
      name: s.name,
      total: items.length,
      open: items.filter((i) => !closed(i.status)).length,
      closed: items.filter((i) => closed(i.status)).length,
      completed: items.filter((i) =>
        ["completed", "complete", "fulfilled"].includes(i.status.toLowerCase()),
      ).length,
      overdue: items.filter(
        (i) =>
          !closed(i.status) &&
          i.dueAt &&
          Date.parse(i.dueAt) < Date.parse(snapshot.asOf),
      ).length,
    };
  });
  return {
    asOf: snapshot.asOf,
    timezone: snapshot.timezone || "UTC",
    subject,
    reportType,
    startDate: input.startDate || null,
    endDate: input.endDate || null,
    byUser,
    items: selected.slice(0, 100).map(publicItem),
    total: selected.length,
    truncated: selected.length > 100,
    incomplete: snapshot.incomplete,
    notices: snapshot.notices,
    text: byUser
      .map((r) =>
        reportType === "progress"
          ? `${r.name}: ${r.total} recorded updates, ${r.completed} completion records.`
          : `${r.name}: ${r.open} open, ${r.completed} completed, ${r.closed - r.completed} otherwise closed, ${r.overdue} overdue.`,
      )
      .join(" "),
  };
}
