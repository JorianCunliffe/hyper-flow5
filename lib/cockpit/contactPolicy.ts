import type { TenantAgentProfile } from "../../types.js";
export type ContactWindow = NonNullable<TenantAgentProfile["contactWindow"]>;
export function normalizeContactWindow(raw: unknown): ContactWindow {
  if (raw === undefined || raw === null)
    return { startHour: 9, endHour: 17, maxPerDay: 20, maxPerContact: 2 };
  const value = raw as ContactWindow;
  if (
    ![
      value.startHour,
      value.endHour,
      value.maxPerDay,
      value.maxPerContact,
    ].every(Number.isInteger) ||
    value.startHour < 0 ||
    value.endHour > 24 ||
    value.endHour <= value.startHour ||
    value.maxPerDay < 1 ||
    value.maxPerDay > 100 ||
    value.maxPerContact < 1 ||
    value.maxPerContact > 10
  )
    throw new Error(
      "Contact policy requires a valid same-day hour window and bounded daily limits",
    );
  return {
    startHour: value.startHour,
    endHour: value.endHour,
    maxPerDay: value.maxPerDay,
    maxPerContact: value.maxPerContact,
  };
}
export function contactWindowOpen(
  now: number,
  timezone: string,
  policy: ContactWindow,
) {
  const hour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      hour: "2-digit",
      hourCycle: "h23",
    }).format(new Date(now)),
  );
  return hour >= policy.startHour && hour < policy.endHour;
}
export interface ContactDay {
  attempts: Array<{
    operationId: string;
    target: string;
    channel: string;
    at: number;
  }>;
  releasedAttempts?: Record<string, {
    operationId: string;
    target: string;
    channel: string;
    at: number;
    releasedAt: number;
    actor: string;
    reason: string;
    evidence: Record<string, unknown>;
  }>;
}
export function claimContactDay(
  current: ContactDay | null,
  input: {
    operationId: string;
    target: string;
    channel: string;
    now: number;
    coalesce: boolean;
  },
  policy: ContactWindow,
) {
  // RTDB can return sparse numeric children as an object after an audited release.
  // Preserve release evidence through subsequent transactional claims.
  const row: ContactDay = { ...current, attempts: Object.values(current?.attempts || {}).filter(Boolean) };
  const sameOperation = [...row.attempts, ...Object.values(row.releasedAttempts || {})].find(
    (a) => a.operationId === input.operationId,
  );
  if (sameOperation)
    return {
      row,
      allowed: false,
      reason:
        "This contact operation was already claimed; reconcile its receipt.",
      existingOperationId: sameOperation.operationId,
    };
  const sameContact = row.attempts.filter((a) => a.target === input.target);
  const recent = sameContact.find((a) => input.now - a.at < 3600000);
  if (input.coalesce && recent)
    return {
      row,
      allowed: false,
      reason:
        "A follow-up to this contact is already active in the last hour. Review that operation instead of contacting them again.",
      existingOperationId: recent.operationId,
    };
  if (
    row.attempts.length >= policy.maxPerDay ||
    sameContact.length >= policy.maxPerContact
  )
    return {
      row,
      allowed: false,
      reason: "The configured daily contact budget is exhausted.",
    };
  row.attempts.push({
    operationId: input.operationId,
    target: input.target,
    channel: input.channel,
    at: input.now,
  });
  return { row, allowed: true, reason: "" };
}
