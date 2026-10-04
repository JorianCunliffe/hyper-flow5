import { createHash } from "node:crypto";
import { TenantControlError } from "../tenantControl/model.js";
export const fail = (status: number, message: string): never => {
  throw new TenantControlError(status, message);
};
export const digest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export const text = (v: unknown, max = 500) =>
  typeof v === "string" ? v.trim().slice(0, max) : "";
export type ReceptionAction = "availability" | "booking" | "resume_ask";
export interface ReceptionProject {
  projectId: string;
  enabled: boolean;
  label: string;
  aliases: string[];
  visibility: "public" | "recognized";
  knowledge: string;
  historySourceProjectIds: string[];
  intakeOwner: string;
  actions: ReceptionAction[];
  availabilityConnection?: string;
  booking?: {
    resourceName: string;
    staffPersonId: string;
    durationMinutes: number;
    travelMinutes: number;
    properties: string[];
    columns: {
      date: number;
      time: number;
      property: number;
      attendees: number;
      groupSize: number;
      status: number;
    };
  };
}
export interface ReceptionLine {
  id: string;
  identity: string;
  enabled: boolean;
  name: string;
  greeting: string;
  timezone: string;
  projectIds: string[];
  inboxOwner: string;
  hours?: { days: number[]; start: string; end: string };
}
export interface ReceptionConfig {
  revision: number;
  lines: ReceptionLine[];
  projects: ReceptionProject[];
  updatedBy?: string;
  receipts?: Record<string, { fingerprint: string; revision: number }>;
}
export interface ReceptionSession {
  id: string;
  orgId: string;
  personId: string;
  threadId: string;
  communicationId: string;
  identity: string;
  revision: number;
  createdAt: number;
  updatedAt: number;
  policyRevision: number;
  projectId?: string;
  enquiryId?: string;
  segments: Array<{
    id: string;
    projectId?: string;
    startedAt: number;
    endedAt?: number;
    enquiryId?: string;
  }>;
  routingDecisions?: Array<{
    at: number;
    kind: string;
    reason: string;
    projectId?: string;
    policyVersion: number;
  }>;
  verificationEvidence?: {
    channel: "sms";
    verifiedAt: number;
    expiresAt: number;
  };
  verifiedUntil?: number;
  verification?: {
    hash: string;
    expiresAt: number;
    attempts: number;
    sent: boolean;
  };
  operations: Record<
    string,
    {
      fingerprint: string;
      status: "started" | "completed" | "uncertain";
      result?: any;
    }
  >;
  proposal?: {
    id: string;
    hash: string;
    kind: "booking" | "ask";
    value: any;
    policyRevision: number;
    expiresAt: number;
  };
}
export interface ReceptionEnquiry {
  completedCallIds?: string[];
  sourceSegmentIds?: string[];
  visibility?: "routine" | "restricted";
  id: string;
  personId: string;
  projectId?: string;
  lineId: string;
  owner: string;
  name: string;
  request: string;
  callbackPreference: string;
  status: "needs_review" | "open" | "closed";
  communicationIds: string[];
  updatedAt: number;
}
export const emptyConfig = (): ReceptionConfig => ({
  revision: 0,
  lines: [],
  projects: [],
});
export function validateConfig(
  raw: any,
  projectIds: string[],
): ReceptionConfig {
  if (
    !raw ||
    !Array.isArray(raw.lines) ||
    !Array.isArray(raw.projects) ||
    raw.lines.length > 25 ||
    raw.projects.length > 100
  )
    fail(
      422,
      "Supply reception lines and projects (maximum 25 lines and 100 projects).",
    );
  const known = new Set(projectIds),
    unique = (values: string[]) => new Set(values).size === values.length;
  if (
    !unique(raw.lines.map((l: any) => l.id)) ||
    !unique(raw.lines.map((l: any) => l.identity)) ||
    !unique(raw.projects.map((p: any) => p.projectId))
  )
    fail(422, "Duplicate reception identity or project.");
  const projects: ReceptionProject[] = raw.projects.map((p: any) => {
    if (
      !known.has(p.projectId) ||
      !text(p.label) ||
      !["public", "recognized"].includes(p.visibility) ||
      !text(p.intakeOwner)
    )
      fail(
        422,
        "Choose an existing project, public label, visibility and intake owner.",
      );
    if (
      !Array.isArray(p.aliases || []) ||
      !Array.isArray(p.actions || []) ||
      !Array.isArray(p.historySourceProjectIds || [])
    )
      fail(422, "Aliases, actions and history sources must be arrays.");
    const sources = [
      ...new Set<string>([p.projectId, ...(p.historySourceProjectIds || [])]),
    ];
    if (sources.some((id) => !known.has(id)))
      fail(422, "History sources must belong to this organization.");
    const actions = [...new Set<ReceptionAction>(p.actions || [])];
    if (
      actions.some(
        (a) => !["availability", "booking", "resume_ask"].includes(a),
      )
    )
      fail(422, "Unsupported receptionist action.");
    const value: ReceptionProject = {
      projectId: p.projectId,
      enabled: p.enabled === true,
      label: text(p.label, 100),
      aliases: (p.aliases || [])
        .map((v: any) => text(v, 100))
        .filter(Boolean)
        .slice(0, 20),
      visibility: p.visibility,
      knowledge: text(p.knowledge, 12000),
      historySourceProjectIds: sources,
      intakeOwner: p.intakeOwner,
      actions,
    };
    if (p.availabilityConnection)
      value.availabilityConnection = text(p.availabilityConnection, 100);
    if (actions.includes("availability") && !value.availabilityConnection)
      fail(422, "Choose a named availability connection.");
    if (p.booking) {
      const b = p.booking,
        columns = b.columns;
      if (
        !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(b.resourceName) ||
        !text(b.staffPersonId) ||
        !Number.isInteger(b.durationMinutes) ||
        b.durationMinutes < 5 ||
        b.durationMinutes > 120 ||
        !Number.isInteger(b.travelMinutes) ||
        b.travelMinutes < 0 ||
        b.travelMinutes > 120 ||
        !Array.isArray(b.properties) ||
        !b.properties.length ||
        !columns ||
        ["date", "time", "property", "attendees", "groupSize", "status"].some(
          (k) =>
            !Number.isInteger(columns[k]) || columns[k] < 0 || columns[k] > 49,
        ) ||
        !unique(Object.values(columns) as string[])
      )
        fail(
          422,
          "Configure the diary, staff, properties, duration, travel and distinct column indexes.",
        );
      value.booking = {
        resourceName: b.resourceName,
        staffPersonId: b.staffPersonId,
        durationMinutes: b.durationMinutes,
        travelMinutes: b.travelMinutes,
        properties: b.properties.map((v: any) => text(v, 200)),
        columns: {
          date: columns.date,
          time: columns.time,
          property: columns.property,
          attendees: columns.attendees,
          groupSize: columns.groupSize,
          status: columns.status,
        },
      };
    }
    if (actions.includes("booking") && !value.booking)
      fail(422, "Booking requires a named diary and scheduling rules.");
    return value;
  });
  const lines: ReceptionLine[] = raw.lines.map((l: any) => {
    if (
      !/^[\w-]{1,100}$/.test(l.id) ||
      !/^\+[1-9]\d{7,14}$/.test(l.identity) ||
      !text(l.name) ||
      !text(l.inboxOwner) ||
      !Array.isArray(l.projectIds) ||
      l.projectIds.some(
        (id: string) => !projects.some((p) => p.projectId === id),
      )
    )
      fail(
        422,
        "Choose a valid line identity, owner and configured reception projects.",
      );
    try {
      if (typeof l.timezone !== "string" || !l.timezone) throw new Error();
      new Intl.DateTimeFormat("en", { timeZone: l.timezone }).format();
    } catch {
      fail(422, "Choose a valid reception timezone.");
    }
    const value: ReceptionLine = {
      id: l.id,
      identity: l.identity,
      enabled: l.enabled === true,
      name: text(l.name, 100),
      greeting: text(l.greeting, 500),
      timezone: l.timezone,
      projectIds: [...new Set<string>(l.projectIds)],
      inboxOwner: l.inboxOwner,
    };
    if (l.hours) {
      const h = l.hours;
      if (
        !Array.isArray(h.days) ||
        !h.days.length ||
        h.days.some((d: any) => !Number.isInteger(d) || d < 0 || d > 6) ||
        ![h.start, h.end].every((v) => /^([01]\d|2[0-3]):[0-5]\d$/.test(v)) ||
        h.start >= h.end
      )
        fail(
          422,
          "Opening hours require weekdays and a same-day start/end time.",
        );
      value.hours = { days: h.days, start: h.start, end: h.end };
    }
    return value;
  });
  return { revision: Number(raw.revision) || 0, lines, projects };
}
const norm = (v: string) =>
  v
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
export function routeReception(
  config: ReceptionConfig,
  identity: string,
  associations: string[],
  utterance = "",
  activeProjectId?: string,
) {
  const line = config.lines.find((l) => l.identity === identity);
  if (!line)
    return { kind: "legacy" as const, candidates: [] as ReceptionProject[] };
  if (!line.enabled)
    return {
      kind: "disabled" as const,
      line,
      candidates: [] as ReceptionProject[],
    };
  const candidates = config.projects.filter(
    (p) =>
      p.enabled &&
      line.projectIds.includes(p.projectId) &&
      (p.visibility === "public" || associations.includes(p.projectId)),
  );
  const words = ` ${norm(utterance)} `;
  const matches = candidates.filter((p) =>
    [p.label, ...p.aliases].some(
      (n) => norm(n).length > 2 && words.includes(` ${norm(n)} `),
    ),
  );
  const result = (p: ReceptionProject, reason: string) => ({
    kind: "routed" as const,
    line,
    candidates,
    project: p,
    reason,
  });
  if (matches.length === 1) return result(matches[0], "explicit_service");
  if (matches.length > 1)
    return { kind: "clarification" as const, line, candidates: matches };
  // Nonempty unknown service wording must not silently fall back to a remembered/default project.
  if (utterance.trim())
    return { kind: "clarification" as const, line, candidates };
  const active = candidates.find((p) => p.projectId === activeProjectId);
  if (active) return result(active, "active_enquiry");
  const related = candidates.filter((p) => associations.includes(p.projectId));
  if (related.length === 1) return result(related[0], "single_association");
  if (candidates.length === 1) return result(candidates[0], "single_service");
  return {
    kind: candidates.length
      ? ("clarification" as const)
      : ("unassigned" as const),
    line,
    candidates,
  };
}
export function isOpen(line: ReceptionLine, now = Date.now()) {
  if (!line.hours) return true;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: line.timezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const get = (key: string) => parts.find((p) => p.type === key)?.value || "";
  return (
    line.hours.days.includes(
      ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday")),
    ) &&
    `${get("hour")}:${get("minute")}` >= line.hours.start &&
    `${get("hour")}:${get("minute")}` < line.hours.end
  );
}
