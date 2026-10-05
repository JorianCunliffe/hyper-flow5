import {
  digest,
  allowedReceptionActions,
  fail,
  text,
  type ReceptionConfig,
  type ReceptionSession,
} from "./model.js";
import { readProjectWorkspaceResources } from "../workspaceResourceCatalog.js";
import {
  readTenantAgentProfile,
  claimContactDispatch,
} from "../serverStore.js";
import { readTenantCapabilityPolicy } from "../capabilityPolicyStore.js";
import { assertCapabilityAllowed } from "../capabilityPolicy.js";
import {
  createCommunicationsClient,
  HttpCommunicationsClient,
} from "../communications/client.js";
import { withActionExecutionScope } from "../actionExecutionScope.js";
import { readGrantedGoogleSheet } from "../integrations/googleWorkspace.js";
import { serverExecutor } from "../serverExecutor.js";
import { executeNamedWebhook } from "../namedWebhook.js";
import {
  pendingReceptionAsks,
  bindReceptionAsk,
  answerReceptionAsk,
} from "./asks.js";
import { validateBooking, bookingRow, minutes, validDate } from "./booking.js";
export const receptionActionDependencies = {
  async readiness(org: string, config: ReceptionConfig) {
    const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
    try {
      const lines = await new HttpCommunicationsClient().listReceptionLines(
        org,
      );
      for (const l of config.lines)
        checks.push({
          name: `Phone ${l.identity}`,
          ok: lines.some((p) => p.identity === l.identity && p.enabled),
        });
    } catch {
      checks.push({
        name: "Communications line ownership",
        ok: false,
        detail:
          "The matching Communications release and line-read capability are required.",
      });
    }
    if (config.lines.some(l => l.smsEnabled)) {
      try {
        const profile = await readTenantAgentProfile(org);
        assertCapabilityAllowed({ profile: profile ? { ...profile, capabilityPolicy: await readTenantCapabilityPolicy(org) } : null, capability: "sms.send", autonomous: true });
        checks.push({ name: "Reception SMS reply permission", ok: true });
      } catch {
        checks.push({ name: "Reception SMS reply permission", ok: false, detail: "Approve sms.send in the existing capability settings before activating SMS replies." });
      }
    }
    for (const p of config.projects) {
      if (p.booking) {
        const r = (await readProjectWorkspaceResources(org, p.projectId)).find(
          (r) => r.name === p.booking!.resourceName,
        );
        checks.push({
          name: `${p.label} diary`,
          ok:
            !!r &&
            r.permissions.includes("read") &&
            r.permissions.includes("append"),
        });
      }
      if (p.availabilityConnection) {
        let registry: any = {};
        try {
          registry = JSON.parse(process.env.WEBHOOK_CONNECTIONS_JSON || "{}");
        } catch {}
        const w = registry[p.availabilityConnection];
        checks.push({
          name: `${p.label} availability`,
          ok:
            w?.orgId === org &&
            w?.projectIds?.includes(p.projectId) &&
            !!process.env[w?.urlEnv],
        });
      }
    }
    return checks;
  },
  async challenge(
    org: string,
    s: ReceptionSession,
    line: any,
    code: string,
    key: string,
  ) {
    const client = createCommunicationsClient(),
      person = (await client.listPeople(org)).find((p) => p.id === s.personId);
    if (!person?.phone)
      fail(422, "No registered phone is available for verification.");
    const profile = await readTenantAgentProfile(org);
    if (!profile) fail(403, "Contact policy is unavailable.");
    assertCapabilityAllowed({
      profile: {
        ...profile,
        capabilityPolicy: await readTenantCapabilityPolicy(org),
      },
      capability: "sms.send",
      autonomous: true,
    });
    const claim = await claimContactDispatch(org, {
      operationId: `reception_verify_${digest([s.id, key])}`,
      target: person.phone,
      channel: "sms",
      coalesce: false,
    });
    if (!claim.allowed)
      fail(429, claim.reason || "Verification contact limit reached.");
    await client.sendSms({
      to: person.phone,
      from: line.identity,
      body: `${line.name} call verification code: ${code}. Expires in 5 minutes.`,
      purpose: { type: "reception_verification" },
      correlation: {
        tenant_id: org,
        run_id: `reception_verify_${digest([s.id, key])}`,
        task_id: "verify_caller",
      },
    });
  },
  readDiary: (org: string, projectId: string, name: string) =>
    withActionExecutionScope({ resourceName: name }, () =>
      readGrantedGoogleSheet(org, projectId),
    ),
  webhook: executeNamedWebhook,
  execute: serverExecutor,
  pending: pendingReceptionAsks,
  bindAsk: bindReceptionAsk,
  answerAsk: answerReceptionAsk,
};
export async function receptionAction({
  org,
  session,
  project,
  line,
  config,
  args,
  operation,
  key,
  deps,
}: any) {
  const permitted = (name: string) => {
    if (!allowedReceptionActions(line,project,deps.now()).some(action=>action===name))
      fail(403, "This action is not enabled for this service.");
  };
  if (operation === "availability") {
    permitted("availability");
    const result = await deps.actions.webhook(
      { connection_name: project.availabilityConnection, method: "GET" },
      { orgId: org, projectId: project.projectId },
    );
    const fetchedAt = Date.parse(result.webhook_fetched_at);
    if (!Number.isFinite(fetchedAt) || Math.abs(deps.now() - fetchedAt) > 60000)
      fail(
        409,
        "Room availability is missing or stale. Take an enquiry instead.",
      );
    return {
      ...result,
      validUntil: new Date(fetchedAt + 60000).toISOString(),
      instruction:
        "This is a fresh provider lookup, not a room reservation. Recheck after validUntil. If the result itself says unavailable, stale or unknown, report that limitation.",
    };
  }
  if (operation === "pending_asks") {
    permitted("resume_ask");
    if (!(session.verifiedUntil > deps.now()))
      fail(403, "Verify the registered caller before reading staff questions.");
    return {
      asks: await deps.actions.pending(
        org,
        project.projectId,
        session.personId,
      ),
    };
  }
  if (operation === "select_ask") {
    permitted("resume_ask");
    if (!(session.verifiedUntil > deps.now()))
      fail(403, "Verify the registered staff caller first.");
    await deps.actions.bindAsk(
      org,
      project.projectId,
      args.askId,
      session.personId,
      session.id,
    );
    return {
      bound: true,
      ask: (
        await deps.actions.pending(org, project.projectId, session.personId)
      ).find((a: any) => a.id === args.askId),
    };
  }
  if (operation === "reconcile_action") {
    const p = session.proposal;
    if (!p) fail(404, "No saved proposal.");
    if (p.kind === "ask") {
      const pending = await deps.actions.pending(
        org,
        project.projectId,
        session.personId,
      );
      return {
        status: pending.some((a: any) => a.id === p.value.askId)
          ? "pending"
          : "requires_operator_review",
        notice: "Inspect the owning Ask response; no answer was replayed.",
      };
    }
    permitted("booking");
    const lock = await deps.store.read(org, "diary_locks", "booking_dispatch");
    if (lock?.operationId !== p.id || lock?.projectId !== project.projectId)
      fail(409, "This call does not own the pending booking.");
    if (lock.status === "verified")
      return { status: "verified", booking: p.value };
    const result = await (
      await import("./booking.js")
    ).reconcileDiary(org, "booking_dispatch");
    return { ...result, booking: p.value };
  }
  if (operation === "prepare_action") {
    let value: any,
      kind = args.kind;
    if (kind === "booking") {
      permitted("booking");
      const b = project.booking;
      value = {
        date: text(args.date, 10),
        time: text(args.time, 5),
        property: text(args.property, 200),
        attendees: text(args.attendees, 500),
        groupSize: Number(args.groupSize),
      };
      const today = new Intl.DateTimeFormat("en-CA", {
        timeZone: line.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(deps.now());
      if (value.date < today) fail(422, "Choose a future inspection date.");
      const diary = await deps.actions.readDiary(
        org,
        project.projectId,
        b.resourceName,
      );
      const availability = await deps.store.read(
        org,
        "availability",
        digest([project.projectId, b.staffPersonId]),
      );
      validateBooking(
        value,
        b,
        diary.values,
        availability?.expiresAt > deps.now() ? availability.windows : [],
      );
      value = { ...value, diaryHash: digest(diary.values) };
    } else if (kind === "ask") {
      permitted("resume_ask");
      if (!(session.verifiedUntil > deps.now()))
        fail(403, "Verify the registered staff caller first.");
      const asks = await deps.actions.pending(
        org,
        project.projectId,
        session.personId,
      );
      const ask = asks.find((a: any) => a.id === args.askId);
      if (!ask) fail(409, "Choose a current request addressed to this caller.");
      await deps.actions.bindAsk(
        org,
        project.projectId,
        ask.id,
        session.personId,
        session.id,
      );
      value = {
        askId: ask.id,
        runId: ask.runId,
        version: ask.version,
        answers: args.answers || {},
        text: text(args.text, 4000),
      };
      if (args.availabilityWindows) {
        if (project.booking?.staffPersonId !== session.personId)
          fail(
            403,
            "Only the configured inspection staff may confirm availability.",
          );
        value.availabilityWindows = validateAvailability(
          args.availabilityWindows,
          project.booking.properties,
        );
      }
    } else fail(422, "Choose booking or ask.");
    const proposal = {
      id: `proposal_${digest([session.id, key]).slice(0, 32)}`,
      kind,
      value,
      policyRevision: config.revision,
      expiresAt: deps.now() + 10 * 60000,
    };
    const hash = digest(proposal);
    await deps.store.transact(org, "sessions", session.id, (s: any) => ({
      ...s,
      proposal: { ...proposal, hash },
    }));
    return {
      proposal: { ...proposal, hash },
      instruction:
        "Read these exact details aloud and obtain confirmation before confirming this proposal.",
    };
  }
  if (operation !== "confirm_action") fail(422, "Unknown reception action.");
  const p = session.proposal;
  if (
    !p ||
    p.hash !== args.hash ||
    p.policyRevision !== config.revision ||
    p.expiresAt < deps.now() ||
    args.confirmed !== true
  )
    fail(409, "Prepare and confirm the current exact proposal.");
  if (p.kind === "ask") {
    permitted("resume_ask");
    if (!(session.verifiedUntil > deps.now()))
      fail(403, "Caller verification expired.");
    const outcome = await deps.actions.answerAsk(
      org,
      project.projectId,
      session.personId,
      session.id,
      session.communicationId,
      p,
    );
    if (
      outcome.ok &&
      outcome.askStatus === "answered" &&
      p.value.availabilityWindows
    )
      await deps.store.transact(
        org,
        "availability",
        digest([project.projectId, session.personId]),
        () => ({
          windows: p.value.availabilityWindows,
          expiresAt: deps.now() + 24 * 3600000,
          sourceAskId: p.value.askId,
          sourceCommunicationId: session.communicationId,
        }),
      );
    return outcome;
  }
  permitted("booking");
  const diary = await deps.actions.readDiary(
    org,
    project.projectId,
    project.booking.resourceName,
  );
  if (digest(diary.values) !== p.value.diaryHash)
    fail(409, "The diary changed. Review a fresh booking proposal.");
  const marker = `[${p.id}]`,
    row = bookingRow(p.value, project.booking, marker);
  const result = await deps.actions.execute(
    "append_google_sheet",
    JSON.stringify({
      resource_name: project.booking.resourceName,
      values: [row],
      idempotency_key: p.id,
    }),
    { flow_trigger_event_id: session.id },
    {
      orgId: org,
      projectId: project.projectId,
      nodeId: "reception_booking",
      runId: p.id,
    },
  );
  if (result.status !== "success")
    fail(
      409,
      "Booking is not verified. Inspect the saved operation before trying again.",
    );
  const stored = await deps.actions.readDiary(
    org,
    project.projectId,
    project.booking.resourceName,
  );
  if (!stored.values.some((r: any) => digest(r) === digest(row)))
    fail(
      409,
      "Booking readback is uncertain. Do not promise a booking or retry.",
    );
  return {
    verified: true,
    booking: {
      date: p.value.date,
      time: p.value.time,
      property: p.value.property,
      attendees: p.value.attendees,
      groupSize: p.value.groupSize,
    },
    receipt: result.output,
  };
}
export function validateAvailability(input: any, properties: string[]) {
  if (!Array.isArray(input) || !input.length || input.length > 30)
    fail(422, "Supply confirmed availability windows.");
  return input.map((w) => {
    if (
      !validDate(w.date) ||
      minutes(w.end) <= minutes(w.start) ||
      !Array.isArray(w.properties) ||
      !w.properties.length ||
      w.properties.some((p: string) => !properties.includes(p))
    )
      fail(422, "Invalid staff availability window.");
    return {
      date: w.date,
      start: w.start,
      end: w.end,
      properties: w.properties,
    };
  });
}
