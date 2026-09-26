import { TenantControlError } from "../tenantControl/model.js";
export type Principal = { uid: string; apiClientId?: string };
/** A delegated API credential is never evidence that its human issuer reviewed a decision. */
export function assertHumanDecision(
  member: Principal,
  domain: string,
  body: any = {},
) {
  if (!member.apiClientId) return;
  const decisions: Record<string, string[]> = {
    flows: ["approve", "reject", "review", "answer_update"],
    calendar: ["approve", "reject"],
    artifacts: ["approve", "reject", "review", "approve_sheet"],
    publishing: ["approve", "reject"],
    captured_work: ["resolve", "dismiss"],
    triage: [
      "approve_agent_proposal",
      "reject_agent_proposal",
      "accept_interpretation",
    ],
    commitments: ["respond"],
  };
  const nested =
    domain === "commitments" &&
    ((body.action === "promise_ledger" && body.operation === "review") ||
      (body.action === "operational_review" &&
        ["respond", "advance", "action"].includes(body.operation)));
  if (
    nested ||
    [body.operation, body.action].some((value) =>
      decisions[domain]?.includes(value),
    )
  )
    throw new TenantControlError(
      403,
      "A human session must make this review decision",
    );
}
