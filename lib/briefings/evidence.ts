import { randomUUID } from "node:crypto";
/** Server-only metadata. HTTP payload fields can never manufacture a decision context. */
const decisions = new WeakMap<
  object,
  { id: string; channel: "web" | "voice" }
>();
export function withBriefingDecision<T extends object>(
  member: T,
  id: string,
  voice: boolean,
): T {
  const trusted = { ...member };
  decisions.set(trusted, { id, channel: voice ? "voice" : "web" });
  return trusted;
}
export const briefingDecisionEvidence = (member: object) =>
  decisions.has(member)
    ? {
        id: `briefing_${decisions.get(member)!.id}`,
        via: decisions.get(member)!.channel,
      }
    : undefined;
export const decisionResponseId = (member: object) =>
  decisions.has(member)
    ? `briefing_${decisions.get(member)!.id}`
    : randomUUID();
export const decisionChannel = (member: object): "web" | "voice" =>
  decisions.get(member)?.channel || "web";
