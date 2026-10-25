import { randomInt, timingSafeEqual } from "node:crypto";
import { createCommunicationsClient } from "../communications/client.js";
import {
  readTenantAgentProfile,
  requireOrganizationMember,
} from "../serverStore.js";
import { allowedProjectIdsForPerson } from "../agentRouter.js";
import { handleBriefings, briefingSettings } from "./api.js";
import { prepareChange, confirmChange, readChange } from "./changes.js";
import { fingerprint, fail } from "./model.js";
import { readBriefingRecord, transactBriefingRecord } from "./store.js";

export const voiceDependencies = {
  profile: readTenantAgentProfile,
  member: requireOrganizationMember,
  settings: briefingSettings,
  read: readBriefingRecord,
  transact: transactBriefingRecord,
  communication: (org: string, id: string) =>
    createCommunicationsClient().getCommunication(org, id),
  people: (org: string) => createCommunicationsClient().listPeople(org),
  sendSms: (request: any) => createCommunicationsClient().sendSms(request),
  handle: handleBriefings,
  prepare: prepareChange,
  confirm: confirmChange,
  result: readChange,
};
const text = (v: any) => (typeof v === "string" ? v.trim() : "");
/** Entry point is reachable only after timestamped Communications signature validation. */
export async function briefingVoice(
  body: any,
  deps = voiceDependencies,
): Promise<Record<string, any>> {
  const org = text(body.tenant_id),
    person = text(body.person_id),
    call = text(body.communication_id),
    thread = text(body.thread_id),
    line = text(body.service_identity);
  if (!org || !person || !call || !thread || !line)
    fail(422, "Trusted call context is required");
  const profile = await deps.profile(org);
  if (
    !profile?.primaryUserId ||
    profile.primaryPersonId !== person ||
    profile.serviceIdentities?.phone !== line
  )
    fail(403, "This caller is not enrolled for briefings");
  const member = await deps.member(profile.primaryUserId, org),
    settings = await deps.settings(member);
  if (!settings.enabled || settings.enrolledBy !== member.uid)
    fail(403, "Enable and enrol daily briefings in HyperFlow first");
  const communication = await deps.communication(org, call);
  if (
    communication.tenantId !== org ||
    communication.personId !== person ||
    communication.threadId !== thread ||
    communication.channel !== "voice" ||
    ["completed", "failed", "cancelled"].includes(String(communication.status))
  )
    fail(403, "This is not an active call for the enrolled person");
  const granted = allowedProjectIdsForPerson(profile, person);
  const scope = settings.projectIds
    ? settings.projectIds.filter(
        (id: string) => !granted || granted.includes(id),
      )
    : granted;
  const args = body.args || {},
    operation = args.operation;
  const sessionId = `call_${fingerprint(call).slice(0, 40)}`;
  if (operation === "request_code") {
    const existing = await deps.read(org, "sessions", sessionId);
    if (existing)
      return {
        status: existing.verified ? "verified" : "code_already_requested",
        message:
          "Use the code sent for this call. A new call is required if the challenge expired or failed.",
      };
    const contact = (await deps.people(org)).find((p) => p.id === person);
    if (!contact?.phone)
      fail(409, "The enrolled caller has no verified SMS destination");
    const code = String(randomInt(100000, 1000000)),
      now = Date.now();
    let created = false;
    await deps.transact(org, "sessions", sessionId, (current) => {
      created = false;
      if (current) return current;
      created = true;
      return {
        uid: member.uid,
        call,
        person,
        thread,
        line,
        issuedAt: now,
        challengeExpiresAt: now + 5 * 60000,
        expiresAt: now + 90 * 60000,
        codeHash: fingerprint([call, code]),
        attempts: 0,
        verified: false,
        status: "sending",
      };
    });
    if (!created) return { status: "code_already_requested" };
    try {
      const result = await deps.sendSms({
        to: contact.phone,
        from: line,
        body: `Your HyperFlow briefing code is ${code}. It expires in 5 minutes and authorises access during this call. Read it only to your HyperFlow assistant.`,
        correlation: {
          tenant_id: org,
          run_id: call,
          task_id: "briefing_verification",
        },
        purpose: { type: "briefing_verification" },
      });
      await deps.transact(org, "sessions", sessionId, (current) => ({
        ...current,
        status: "challenge",
        smsId: result.id,
      }));
      return {
        status: "code_sent",
        message:
          "A verification code was sent to your enrolled number. Please read the six digits.",
      };
    } catch {
      await deps.transact(org, "sessions", sessionId, (current) => ({
        ...current,
        status: "uncertain",
      }));
      fail(
        503,
        "Code delivery could not be confirmed. Do not send another automatically.",
      );
    }
  }
  if (operation === "verify_code") {
    const code = text(args.code).replace(/[\s-]/g, "");
    let verified = false;
    await deps.transact(org, "sessions", sessionId, (current) => {
      if (
        !current ||
        current.uid !== member.uid ||
        current.call !== call ||
        current.expiresAt < Date.now()
      )
        fail(403, "Request a code for this call first");
      if (current.verified) {
        verified = true;
        return current;
      }
      if (
        current.status !== "challenge" ||
        current.challengeExpiresAt < Date.now() ||
        current.attempts >= 5
      )
        return current;
      const hash = Buffer.from(fingerprint([call, code])),
        expected = Buffer.from(current.codeHash);
      verified =
        /^\d{6}$/.test(code) &&
        hash.length === expected.length &&
        timingSafeEqual(hash, expected);
      return {
        ...current,
        attempts: current.attempts + 1,
        verified,
        verifiedAt: verified ? Date.now() : null,
      };
    });
    if (!verified)
      fail(
        403,
        "The code is incorrect, expired or locked. No briefing information was disclosed",
      );
    return {
      status: "verified",
      sections: settings.sections,
      reportSubject: settings.reportSubject,
      reportType: settings.reportType,
      reportDays: settings.reportDays,
    };
  }
  const session = await deps.read(org, "sessions", sessionId);
  if (
    !session?.verified ||
    session.uid !== member.uid ||
    session.expiresAt < Date.now() ||
    session.thread !== thread
  )
    fail(
      403,
      "Verify the SMS code for this call before accessing the briefing",
    );
  if (operation === "prepare_change") {
    const approval = ["approve", "reject"].includes(args.action);
    if (approval ? !settings.allowApprovals : !settings.allowTaskUpdates)
      fail(403, "This write capability is disabled in briefing settings");
    return deps.prepare(member, args, scope, call);
  }
  if (operation === "confirm_change") {
    const proposal = await deps.read(org, "changes", text(args.id));
    if (!proposal || proposal.callId !== call || proposal.uid !== member.uid)
      fail(404, "Proposal not found for this call");
    if (
      ["approve", "reject"].includes(proposal.action)
        ? !settings.allowApprovals
        : !settings.allowTaskUpdates
    )
      fail(403, "This write capability is disabled");
    const spoken = body.evidence?.assistant;
    const normal = (v: any) =>
      text(v)
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]/gu, "");
    if (
      !spoken ||
      spoken.at < proposal.createdAt ||
      !spoken.playedAt ||
      spoken.interrupted ||
      !normal(spoken.text).includes(normal(proposal.readback))
    )
      fail(
        422,
        "Read the exact proposal aloud in full before requesting confirmation",
      );
    const human = body.evidence?.human;
    if (!human || human.at <= spoken.playedAt)
      fail(422, "Wait for the caller to confirm after the complete readback");
    return deps.confirm(member, args, scope, call, {
      ...human,
      channel: "voice",
      communicationId: call,
      readbackAt: spoken.at,
    });
  }
  if (operation === "change_result")
    return deps.result(member, text(args.id), call);
  if (
    ![
      "subjects",
      "list_tasks",
      "list_approvals",
      "read_item",
      "report",
    ].includes(operation)
  )
    fail(422, "This operation is not available through the voice gateway");
  const query = { ...args };
  if (operation === "report") {
    query.subject ||= settings.reportSubject;
    query.reportType ||= settings.reportType;
    if (query.reportType === "progress" && !query.startDate && !query.endDate) {
      const parts = Object.fromEntries(
        new Intl.DateTimeFormat("en-CA", {
          timeZone: profile.timezone || "UTC",
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
        })
          .formatToParts(new Date())
          .map((p) => [p.type, p.value]),
      );
      query.endDate = `${parts.year}-${parts.month}-${parts.day}`;
      query.startDate = new Date(
        Date.parse(query.endDate) -
          (Number(settings.reportDays || 7) - 1) * 86400000,
      )
        .toISOString()
        .slice(0, 10);
    }
  }
  return deps.handle({ method: "POST", body: query }, member, scope);
}
