import {
  pendingReceptionAsks,
  bindReceptionAsk,
  answerReceptionAsk,
  withReceptionAskDispatch,
  askVersion,
} from "../lib/reception/asks.js";
import test from "node:test";
import assert from "node:assert/strict";
import {
  routeReception,
  validateConfig,
  isOpen,
  digest,
} from "../lib/reception/model.js";
import {
  validateBooking,
  bookingRow,
  guardDiaryAppend,
} from "../lib/reception/booking.js";
import {
  handleReception,
  receptionContext,
  receptionCommand,
  finishReception,
  receptionDependencies,
} from "../lib/reception/service.js";
import { receptionAction } from "../lib/reception/actions.js";
import { scopedExtras } from "../lib/setupAssistant/safety.js";
const project = (id = "sharehouse", visibility = "public"): any => ({
  projectId: id,
  label: id === "sharehouse" ? "Cairns Sharehouse" : id,
  aliases: [],
  visibility,
  enabled: true,
  knowledge: "Approved rooms only",
  historySourceProjectIds: [id],
  actions: [],
  intakeOwner: "admin",
});
const config = (): any => ({
  revision: 0,
  lines: [
    {
      id: "line",
      identity: "+61400000001",
      enabled: true,
      name: "Reception",
      greeting: "Hello, Cairns Sharehouse",
      timezone: "Australia/Brisbane",
      projectIds: ["sharehouse", "other", "private"],
      inboxOwner: "admin",
    },
  ],
  projects: [project(), project("other"), project("private", "recognized")],
});
const caller = {
  request_id: "request",
  tenant_id: "tenant",
  person_id: "caller",
  communication_id: "call1",
  thread_id: `reception_thread_${digest(["tenant", "call1"]).slice(0, 32)}`,
  service_identity: "+61400000001",
};
function harness() {
  const records = new Map<string, any>(),
    clone = (v: any) => structuredClone(v),
    k = (o: string, c: string, id: string) => `${o}/${c}/${id}`;
  const store: any = {
    read: async (o: string, c: string, id: string) =>
      clone(records.get(k(o, c, id)) || null),
    list: async (o: string, c: string) =>
      [...records]
        .filter(([key]) => key.startsWith(`${o}/${c}/`))
        .map(([, v]) => clone(v)),
    transact: async (o: string, c: string, id: string, fn: any) => {
      const next = fn(clone(records.get(k(o, c, id)) || null));
      records.set(k(o, c, id), clone(next));
      return clone(next);
    },
  };
  let evidenceCalls: any[] = [];
  let challenge = "";
  const deps: any = {
    ...receptionDependencies,
    store,
    now: () => Date.parse("2026-10-04T05:00:00Z"),
    requireOrganizationMember: async (uid: string) => ({
      uid,
      role: uid === "admin" ? "admin" : "member",
    }),
    listTenantProjects: async () =>
      config().projects.map((p: any) => ({ id: p.projectId, name: p.label })),
    readTenantAgentProfile: async () => ({
      primaryPersonId: "staff",
      allowedProjectIds: ["private"],
      conversation: { historyEnabled: true },
      personProjectAccess: [],
    }),
    client: () => ({
      getCommunication: async (org: string, id: string) => ({
        tenantId: org,
        personId: "caller",
        channel: "voice",
        direction: "inbound",
        id,
      }),
    }),
    evidence: async (input: any) => {
      evidenceCalls.push(input);
      return {
        status: "current",
        sources: [
          {
            id: input.projectId,
            text: "Own enquiry",
            channel: "email",
            direction: "inbound",
          },
        ],
      };
    },
    actions: {
      ...receptionDependencies.actions,
      readiness: async () => [{ name: "fixture", ok: true }],
      challenge: async (_o: any, _s: any, _l: any, code: string) => {
        challenge = code;
      },
    },
  };
  const set = async (c: any) =>
    store.transact("tenant", "config", "current", () => c);
  return {
    deps,
    store,
    set,
    records,
    evidenceCalls,
    get challenge() {
      return challenge;
    },
  };
}
test("line directory routes all association combinations without tenant defaults or private names", () => {
  const c = config();
  assert.equal(routeReception(c, "unknown", []).kind, "legacy");
  for (const associations of [
    [],
    ["other"],
    ["sharehouse"],
    ["sharehouse", "other"],
    ["unserved"],
  ]) {
    const r = routeReception(c, c.lines[0].identity, associations);
    assert.equal(
      r.kind,
      associations.length === 1 &&
        ["other", "sharehouse"].includes(associations[0])
        ? "routed"
        : "clarification",
    );
    assert(!r.candidates.some((p) => p.projectId === "private"));
  }
  assert.equal(
    (routeReception(c, c.lines[0].identity, [], "Cairns Sharehouse") as any)
      .project?.projectId,
    "sharehouse",
  );
  assert.equal(
    routeReception(
      c,
      c.lines[0].identity,
      ["sharehouse"],
      "private",
      "sharehouse",
    ).kind,
    "clarification",
  );
  c.lines[0].projectIds = ["sharehouse"];
  assert.equal(
    (routeReception(c, c.lines[0].identity, []) as any).project?.projectId,
    "sharehouse",
  );
  c.projects[0].enabled = false;
  assert.equal(routeReception(c, c.lines[0].identity, []).kind, "unassigned");
  c.lines[0].enabled = false;
  assert.equal(routeReception(c, c.lines[0].identity, []).kind, "disabled");
});
test("configuration rejects missing resources, unknown projects and invalid timezone", () => {
  const c = config();
  assert.equal(
    validateConfig(c, ["sharehouse", "other", "private"]).lines.length,
    1,
  );
  assert.throws(() => validateConfig(c, ["sharehouse"]), /existing project/);
  c.lines[0].timezone = "";
  assert.throws(
    () => validateConfig(c, ["sharehouse", "other", "private"]),
    /timezone/,
  );
  c.lines[0].timezone = "Australia/Brisbane";
  c.projects[0].actions = ["booking"];
  assert.throws(
    () => validateConfig(c, ["sharehouse", "other", "private"]),
    /Booking requires/,
  );
});
test("Brisbane operating hours are derived internally", () => {
  const l = config().lines[0];
  l.hours = { days: [0], start: "09:00", end: "17:00" };
  assert(isOpen(l, Date.parse("2026-10-04T05:30:00Z")));
  assert(!isOpen(l, Date.parse("2026-10-04T08:00:00Z")));
});
test("save, exact replay, stale conflict and activation are distinct administrator actions", async () => {
  const h = harness(),
    member = { orgId: "tenant", uid: "admin" };
  const c = config();
  await h.set(c);
  const review: any = await handleReception(
    {
      method: "POST",
      body: { operation: "prepare", expectedRevision: 0, config: c },
    },
    member,
    h.deps,
  );
  const b = {
    operation: "apply",
    expectedRevision: 0,
    config: c,
    reviewHash: review.reviewHash,
    requestId: "apply_fixture",
  };
  const saved: any = await handleReception(
    { method: "POST", body: b },
    member,
    h.deps,
  );
  assert.equal(saved.config.lines[0].enabled, false);
  assert.equal(
    (
      (await handleReception(
        { method: "POST", body: b },
        member,
        h.deps,
      )) as any
    ).reconciled,
    true,
  );
  await assert.rejects(
    handleReception(
      { method: "POST", body: { ...b, requestId: "apply_other" } },
      member,
      h.deps,
    ),
    /changed/,
  );
  await assert.rejects(
    handleReception({ method: "GET" }, { ...member, uid: "member" }, h.deps),
    /administrator/,
  );
  await assert.rejects(
    handleReception(
      { method: "GET" },
      { ...member, apiClientId: "machine" },
      h.deps,
    ),
    /human session/,
  );
});
test("own history uses approved project sources, service switches clear context and never grant access", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness();
  await h.set(config());
  const first = await receptionContext(
    { ...caller, utterance: "Cairns Sharehouse" },
    h.deps,
  );
  assert.equal(first.project.id, "sharehouse");
  assert.equal(h.evidenceCalls[0].personId, "caller");
  assert.equal(h.evidenceCalls[0].threadId, undefined);
  const next = await receptionContext(
    { ...caller, utterance: "other" },
    h.deps,
  );
  assert(next.reception.resetContext);
  assert.equal(next.project.id, "other");
  const session = await h.store.read(
    "tenant",
    "sessions",
    first.reception.sessionId,
  );
  assert.equal(session.segments.length, 2);
  assert(session.segments[0].endedAt);
  await assert.rejects(
    receptionCommand(
      {
        ...caller,
        tenant_id: "otherTenant",
        operation: "record_enquiry",
        operation_id: "msg1",
        arguments: { request: "Hello" },
      },
      h.deps,
    ),
    /session required/,
  );
  delete process.env.PROJECT_RECEPTION_ENABLED;
});
test("enquiry acknowledgement, repeated callbacks and post-call intake are idempotent", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness();
  await h.set(config());
  await receptionContext({ ...caller, utterance: "Cairns Sharehouse" }, h.deps);
  const b = {
    ...caller,
    operation: "record_enquiry",
    operation_id: "msg1",
    arguments: { request: "Please call back" },
  };
  const first = await receptionCommand(b, h.deps);
  assert(first.saved);
  assert.deepEqual(await receptionCommand(b, h.deps), first);
  await finishReception("tenant", "call1", h.deps);
  await finishReception("tenant", "call1", h.deps);
  assert.equal((await h.store.list("tenant", "enquiries")).length, 1);
  const saved = await h.store.read("tenant", "enquiries", first.enquiryId);
  assert.deepEqual(saved.completedCallIds, ["call1"]);
  assert.equal(saved.sourceSegmentIds.length, 1);
  assert.deepEqual(
    (await h.store.read("tenant", "people", "caller")).projectIds,
    ["sharehouse"],
  );
  assert.equal(
    (await h.deps.readTenantAgentProfile()).personProjectAccess.length,
    0,
  );
  await assert.rejects(
    receptionCommand({ ...b, arguments: { request: "Different" } }, h.deps),
    /reused/,
  );
  delete process.env.PROJECT_RECEPTION_ENABLED;
});

test("history disabled excludes saved voice evidence; an enquiry association never grants staff Ask authority", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness(),
    c = config();
  c.projects[0].actions = ["resume_ask"];
  await h.set(c);
  const profile = await h.deps.readTenantAgentProfile();
  h.deps.readTenantAgentProfile = async () => ({
    ...profile,
    conversation: { historyEnabled: false },
  });
  await h.store.transact("tenant", "voice_segments", "evidence", () => ({
    personId: "caller",
    projectId: "sharehouse",
    visibility: "routine",
    text: "Earlier call",
  }));
  const context = await receptionContext(
    { ...caller, utterance: "Cairns Sharehouse" },
    h.deps,
  );
  assert.deepEqual(context.project.context.history.sources, []);
  assert.equal(h.evidenceCalls.length, 0);
  await receptionCommand(
    {
      ...caller,
      operation: "record_enquiry",
      operation_id: "own_enquiry",
      arguments: { request: "Inspection enquiry" },
    },
    h.deps,
  );
  await h.store.transact(
    "tenant",
    "sessions",
    context.reception.sessionId,
    (s: any) => ({ ...s, verifiedUntil: h.deps.now() + 60000 }),
  );
  await assert.rejects(
    receptionCommand(
      {
        ...caller,
        operation: "pending_asks",
        operation_id: "staff_access",
        arguments: {},
      },
      h.deps,
    ),
    /Staff access/,
  );
  delete process.env.PROJECT_RECEPTION_ENABLED;
});

test("availability is freshly fetched and stale or missing provider results cannot be advertised", async () => {
  const h = harness();
  let fetchedAt: string | undefined = new Date(h.deps.now()).toISOString();
  h.deps.actions.webhook = async () => ({
    webhook_fetched_at: fetchedAt,
    webhook_response: [],
  });
  const input: any = {
    org: "tenant",
    line: config().lines[0],
    session: {},
    project: {
      ...project(),
      actions: ["availability"],
      availabilityConnection: "rooms",
    },
    operation: "availability",
    deps: h.deps,
  };
  const result = await receptionAction(input);
  assert.equal(Date.parse(result.validUntil), h.deps.now() + 60000);
  fetchedAt = new Date(h.deps.now() - 120000).toISOString();
  await assert.rejects(receptionAction(input), /missing or stale/);
  fetchedAt = undefined;
  await assert.rejects(receptionAction(input), /missing or stale/);
});
test("challenge must be acknowledged, expires and never treats a claimed email as proof", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness();
  await h.set(config());
  await receptionContext({ ...caller, utterance: "Cairns Sharehouse" }, h.deps);
  assert(
    (
      await receptionCommand(
        {
          ...caller,
          operation: "verify",
          operation_id: "verify1",
          arguments: {},
        },
        h.deps,
      )
    ).challengeSent,
  );
  assert.equal(
    (
      await receptionCommand(
        {
          ...caller,
          operation: "verify",
          operation_id: "verify2",
          arguments: { code: "wrong", email: "staff@example.com" },
        },
        h.deps,
      )
    ).verified,
    false,
  );
  assert(
    (
      await receptionCommand(
        {
          ...caller,
          operation: "verify",
          operation_id: "verify3",
          arguments: { code: h.challenge },
        },
        h.deps,
      )
    ).verified,
  );
  assert(!JSON.stringify([...h.records]).includes(h.challenge));
  delete process.env.PROJECT_RECEPTION_ENABLED;
});
const policy: any = {
  resourceName: "diary",
  staffPersonId: "carol",
  durationMinutes: 15,
  travelMinutes: 5,
  properties: ["Martyn St", "Other St"],
  columns: {
    date: 0,
    time: 1,
    property: 2,
    attendees: 3,
    groupSize: 4,
    status: 5,
  },
};
const value = {
  date: "2026-10-04",
  time: "16:00",
  property: "Martyn St",
  attendees: "Jorian",
  groupSize: 1,
};
const windows = [
  {
    date: "2026-10-04",
    start: "15:00",
    end: "17:00",
    properties: policy.properties,
  },
];
test("inspection rules reject conflicts, travel gaps, missing availability and invalid dates; allow unlimited compatible attendees", () => {
  const rows = [
    bookingRow({ ...value, time: "15:40", property: "Other St" }, policy, ""),
  ];
  assert.doesNotThrow(() => validateBooking(value, policy, rows, windows));
  assert.throws(
    () => validateBooking({ ...value, time: "15:59" }, policy, rows, windows),
    /conflicts/,
  );
  assert.doesNotThrow(() =>
    validateBooking(
      { ...value, groupSize: 1000000 },
      policy,
      [bookingRow(value, policy, "")],
      windows,
    ),
  );
  assert.throws(() => validateBooking(value, policy, [], []), /availability/);
  assert.throws(
    () =>
      validateBooking({ ...value, date: "2026-02-31" }, policy, [], windows),
    /Confirm/,
  );
  assert.throws(
    () => validateBooking(value, policy, Array(500).fill([]), windows),
    /truncated/,
  );
});
test("unverified staff answers, expired proposals and unrelated reconciliation cannot dispatch", async () => {
  const h = harness();
  const session: any = {
    id: "s",
    personId: "caller",
    proposal: {
      id: "p",
      kind: "booking",
      value,
      hash: "hash",
      policyRevision: 0,
      expiresAt: h.deps.now() - 1,
    },
  };
  const p = {
    ...project(),
    actions: ["resume_ask", "booking"],
    booking: policy,
  };
  const common = {
    org: "tenant",
    session,
    project: p,
    line: config().lines[0],
    config: config(),
    args: { kind: "ask" },
    key: "op",
    deps: h.deps,
  };
  await assert.rejects(
    receptionAction({ ...common, operation: "prepare_action" }),
    /Verify/,
  );
  await assert.rejects(
    receptionAction({
      ...common,
      operation: "confirm_action",
      args: { hash: "hash", confirmed: true },
    }),
    /current exact/,
  );
  await assert.rejects(
    receptionAction({ ...common, operation: "reconcile_action" }),
    /does not own/,
  );
});
test("setup assistant cannot expand an element into reception authority", () => {
  assert.throws(
    () =>
      scopedExtras(
        { kind: "element", projectId: "sharehouse", nodeId: "call" },
        { reception: project() },
      ),
    /workflow scope/,
  );
  assert.throws(
    () =>
      scopedExtras(
        { kind: "workflow", projectId: "sharehouse" },
        { reception: project("other") },
      ),
    /selected project/,
  );
});

test("morning and inbound booking writes serialize; uncertain provider writes never replay", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness(),
    c = config();
  c.projects[0].booking = policy;
  c.lines[0].projectIds = ["sharehouse"];
  await h.set(c);
  await h.store.transact(
    "tenant",
    "availability",
    digest(["sharehouse", "carol"]),
    () => ({ expiresAt: h.deps.now() + 60000, windows }),
  );
  let rows: any[][] = [],
    writes = 0;
  let release: any, started: any;
  const ready = new Promise((r) => (started = r)),
    gate = new Promise((r) => (release = r));
  const deps: any = {
    store: h.store,
    now: h.deps.now,
    resources: async () => [
      { name: "diary", spreadsheetId: "sheet", range: "Diary!A2:F" },
    ],
    read: async () => ({ values: structuredClone(rows) }),
  };
  const selected = { spreadsheetId: "sheet", range: "Diary!A2:F" },
    row = bookingRow(value, policy, "[one]");
  const first = guardDiaryAppend(
    "tenant",
    "sharehouse",
    selected,
    [row],
    "first",
    async () => {
      writes++;
      started();
      await gate;
      rows.push(row);
      return { updates: { saved: true } };
    },
    deps,
  );
  await ready;
  await assert.rejects(
    guardDiaryAppend(
      "tenant",
      "morning",
      selected,
      [row],
      "second",
      async () => {
        writes++;
      },
      deps,
    ),
    /unresolved/,
  );
  release();
  await first;
  assert.equal(writes, 1);
  const row2 = bookingRow({ ...value, time: "16:20" }, policy, "[two]");
  await assert.rejects(
    guardDiaryAppend(
      "tenant",
      "sharehouse",
      selected,
      [row2],
      "uncertain",
      async () => {
        writes++;
        rows.push(row2);
        throw new Error("lost response");
      },
      deps,
    ),
    /lost response/,
  );
  await assert.rejects(
    guardDiaryAppend(
      "tenant",
      "sharehouse",
      selected,
      [row2],
      "different_id",
      async () => {
        writes++;
      },
      deps,
    ),
    /unresolved/,
  );
  assert.equal(writes, 2);
  delete process.env.PROJECT_RECEPTION_ENABLED;
});
test("external diary edits after a write hold the result for reconciliation", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness(),
    c = config();
  c.projects[0].booking = policy;
  await h.set(c);
  await h.store.transact(
    "tenant",
    "availability",
    digest(["sharehouse", "carol"]),
    () => ({ expiresAt: h.deps.now() + 60000, windows }),
  );
  let rows: any[][] = [];
  const row = bookingRow(value, policy, "[one]");
  const deps: any = {
    store: h.store,
    now: h.deps.now,
    resources: async () => [
      { name: "diary", spreadsheetId: "s", range: "Diary!A2:F" },
    ],
    read: async () => ({ values: structuredClone(rows) }),
  };
  await assert.rejects(
    guardDiaryAppend(
      "tenant",
      "sharehouse",
      { spreadsheetId: "s", range: "Diary!A2:F" },
      [row],
      "external_edit",
      async () => {
        rows = [
          row,
          bookingRow({ ...value, time: "16:01" }, policy, "external"),
        ];
        return {};
      },
      deps,
    ),
    /readback differs/,
  );
  assert.equal(
    (await h.store.read("tenant", "diary_locks", "booking_dispatch")).status,
    "pending",
  );
  delete process.env.PROJECT_RECEPTION_ENABLED;
});

test("Carol sees only current addressed questions; inbound ownership suppresses simultaneous retry and retains partial answers", async () => {
  process.env.PROJECT_RECEPTION_ENABLED = "true";
  const h = harness(),
    c = config();
  c.projects[0].actions = ["resume_ask"];
  await h.set(c);
  const ask: any = {
    id: "ask",
    prompt: "Which times?",
    fields: [{ id: "time" }],
    status: "open",
    assignees: ["carol"],
    deliveries: [],
    responses: [],
    escalationState: { cycle: 1 },
  };
  let runs: any = [
    {
      id: "morning1",
      state: {
        milestones: [
          {
            asks: [
              ask,
              { ...ask, id: "expired", dueAt: 1 },
              { ...ask, id: "cancelled", status: "cancelled" },
              { ...ask, id: "other_caller", assignees: ["elsewhere"] },
              { ...ask, id: "second" },
            ],
          },
        ],
      },
    },
  ];
  const pending = (o: string, p: string, person: string) =>
    pendingReceptionAsks(o, p, person, async () => runs, h.deps.now());
  const choices = await pending("tenant", "sharehouse", "carol");
  assert.deepEqual(
    choices.map((a) => a.id),
    ["ask", "second"],
  );
  assert.equal((await pending("tenant", "sharehouse", "stranger")).length, 0);
  const bound = { store: h.store, pending, now: h.deps.now };
  await bindReceptionAsk("tenant", "sharehouse", "ask", "carol", "call", bound);
  let calls = 0;
  await assert.rejects(
    withReceptionAskDispatch(
      "tenant",
      "sharehouse",
      "ask",
      "retry",
      async () => {
        calls++;
        return {};
      },
      { store: h.store, now: h.deps.now },
    ),
    /inbound answer/,
  );
  assert.equal(calls, 0);
  let response: any;
  const deps: any = {
    pending,
    bind: (...args: any[]) =>
      bindReceptionAsk(args[0], args[1], args[2], args[3], args[4], bound),
    respond: async (input: any) => {
      response = input;
      ask.responses.push({ actor: "carol", values: input.response.structured });
      return { ok: true, askStatus: "open" };
    },
  };
  const proposal = {
    value: {
      askId: "ask",
      runId: "morning1",
      version: askVersion(ask, "morning1"),
      answers: { time: "15:30" },
      text: "Available at 15:30",
    },
  };
  assert.equal(
    (
      await answerReceptionAsk(
        "tenant",
        "sharehouse",
        "carol",
        "call",
        "communication",
        proposal,
        deps,
      )
    ).askStatus,
    "open",
  );
  assert.deepEqual(response.response.structured, { time: "15:30" });
  assert.equal(response.expectedAsk.runId, "morning1");
  await assert.rejects(
    answerReceptionAsk(
      "tenant",
      "sharehouse",
      "carol",
      "call",
      "communication",
      proposal,
      deps,
    ),
    /changed or expired/,
  );
  assert.equal(
    (await pending("tenant", "sharehouse", "carol"))[0].responses.length,
    1,
  );
  delete process.env.PROJECT_RECEPTION_ENABLED;
});
