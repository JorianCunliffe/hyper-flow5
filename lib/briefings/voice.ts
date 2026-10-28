import { randomInt, timingSafeEqual } from "node:crypto";
import { createCommunicationsClient } from "../communications/client.js";
import {
  readTenantAgentProfile,
  requireOrganizationMember,
} from "../serverStore.js";
import { allowedProjectIdsForPerson } from "../agentRouter.js";
import { handleBriefings, briefingSettings } from "./api.js";
import { prepareChange, confirmChange, readChange, decideVoiceChange } from "./changes.js";
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
  decide: decideVoiceChange,
  result: readChange,
};
const text = (v: any) => (typeof v === "string" ? v.trim() : "");
/** Entry point is reachable only after timestamped Communications signature validation. */
export async function briefingVoice(
  body: any,
  deps = voiceDependencies,
): Promise<Record<string, any>> {
  const started = Date.now();
  let status = "failed";
  try {
    const result = await runBriefingVoice(body, deps);
    status = "ok";
    return result;
  } finally {
    console.info("[briefing] tool finished", {
      operation: text(body?.args?.operation),
      communicationId: text(body?.communication_id),
      durationMs: Date.now() - started,
      status,
    });
  }
}
async function runBriefingVoice(
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
  const [member, communication] = await Promise.all([
    deps.member(profile.primaryUserId, org),
    deps.communication(org, call),
  ]);
  const settings = await deps.settings(member);
  if (!settings.enabled || settings.enrolledBy !== member.uid)
    fail(403, "Enable and enrol daily briefings in HyperFlow first");
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
  const outbound = communication.direction === "outbound" &&
    ["coaching_session", "daily_briefing"].includes(communication.purpose?.type || "");
  const requireSms = settings.requireSmsVerification !== false || !outbound;
  let session = await deps.read(org,"sessions",sessionId);
  const briefingReady = {
    status: "ready", verification: "outbound_number", sections: settings.sections,
    reportSubject: settings.reportSubject, reportType: settings.reportType, reportDays: settings.reportDays,
    nextStep: "Begin the briefing now. No SMS or additional identity confirmation is needed for this outbound call.",
  };
  if (!requireSms) {
    if (!session?.verified || session.expiresAt < Date.now()) session = await deps.transact(org,"sessions",sessionId,current => current?.verified && current.expiresAt > Date.now()
      ? current : {uid:member.uid,call,person,thread,line,issuedAt:Date.now(),expiresAt:Date.now()+90*60000,
        verified:true,verificationMode:"outbound_number",status:"ready"});
    if (["start_briefing","request_code","verify_code"].includes(operation)) return briefingReady;
  }
  if (operation === "request_code" || operation === "start_briefing") {
    const existing = session;
    if (existing && existing.verificationMode !== "outbound_number")
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
      if (current && current.verificationMode !== "outbound_number") return current;
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
        verificationMode: "sms",
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
        current.verificationMode === "outbound_number" ||
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
  if (
    !session?.verified ||
    (requireSms && session.verificationMode === "outbound_number") ||
    session.uid !== member.uid ||
    session.expiresAt < Date.now() ||
    session.thread !== thread
  )
    fail(
      403,
      "Verify the SMS code for this call before accessing the briefing",
    );
  if (operation === "decide_item") {
    const approval = ["approve", "reject"].includes(args.action);
    if (approval ? !settings.allowApprovals : !settings.allowTaskUpdates)
      fail(403, "This write capability is disabled in briefing settings");
    const result = await deps.decide(member, args, scope, call, body.evidence?.human, session.focus);
    return { ...result, nextStep: result.status === "completed"
      ? result.result?.item?.state === "submitted"
        ? "The completion report is saved and submitted for acceptance. Say that it is submitted, not yet fulfilled. Continue to the next item or pending approvals without reconfirming this saved submission."
        : "The decision is saved. Acknowledge it briefly and move to the next item. Do not request another confirmation."
      : "Check change_result for this exact id. Do not repeat an uncertain decision or claim it is saved." };
  }
  if (operation === "prepare_change") {
    const approval = ["approve", "reject"].includes(args.action);
    if (approval ? !settings.allowApprovals : !settings.allowTaskUpdates)
      fail(403, "This write capability is disabled in briefing settings");
    const result = await deps.prepare(member, args, scope, call);
    return { ...result, nextStep: result.status === "prepared"
      ? "This change is NOT saved. Read readback VERBATIM in one uninterrupted turn. Then wait for a separate clear caller confirmation and call confirm_change with this exact id."
      : "Only status completed means saved. For processing or uncertain use change_result; do not repeat the action." };
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
  const result = await deps.handle({ method: "POST", body: query }, member, scope);
  if (operation === "list_approvals") return {
    ...result,
    nextStep: "Discuss one item at a time. Call read_item before presenting an item for a decision. When the caller says yes or approve that, use decide_item to save that decision immediately, then move on. Do not ask them to approve it again. An item without approve in actions needs its specified answer or checks. Reading this list does not approve anything.",
  };
  if (operation === "read_item" && "item" in result && result.item) {
    return {
      ...result,
      changeOptions: (result.item.actions || []).map((action: string) => ({
        operation: "decide_item", itemId: result.item.id, version: result.item.version, action,
        requestId: `voice-${fingerprint([call, result.item.id, result.item.version, action]).slice(0, 48)}`,
      })),
      progressInstruction: "Apply the requested progress update immediately. Include any details the caller gave; a note is optional. Do not require a separate explanation, phrase, transcript or confirmation. Partial completion stays progress rather than overall completion.",
      nextStep: "Describe this item briefly and ask for its decision once. A clear yes, approve that, or other explicit instruction is the final decision: call the returned decide_item option immediately, acknowledge the saved result and move on. Do not prepare a second proposal, read a formal readback or ask for confirmation again. Supply the requested status/note. For requiredChecks, explain the checks in the initial question and set them only if the caller attests them; do not invent checks or attestations. If actions is empty explain notice; nothing has been saved.",
    };
  }
  return result;
}
