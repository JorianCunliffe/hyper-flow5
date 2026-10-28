import { test } from "node:test";
import { clearConfirmation } from "../lib/briefings/changes.js";
import { outboundBriefingEnabled } from "../lib/briefings/outbound.js";
import assert from "node:assert/strict";
import { buildSnapshot, loadBriefing, type SourceData } from "../lib/briefings/sources.js";
import {
  queryBriefing,
  briefingReport,
  resolveAssignee,
  fingerprint,
} from "../lib/briefings/model.js";
import {
  prepareChange,
  confirmChange,
  readChange,
  executeChange,
  decideVoiceChange,
  executionDependencies,
} from "../lib/briefings/changes.js";
import {
  decisionResponseId,
  decisionChannel,
} from "../lib/briefings/evidence.js";
import { briefingVoice } from "../lib/briefings/voice.js";
import { POST as eventsPost } from "../api/events.js";
import { createHmac } from "node:crypto";
import { requestScope } from "../lib/tenantControl/clients.js";

const member = {
  orgId: "org",
  uid: "alice",
  role: "owner",
  email: "alice@example.test",
};
test('item reads revalidate their source without waiting for unrelated domain stores', async () => {
  const data = empty();
  const touched: string[] = [];
  const deps: any = {
    workspace: async () => data.workspace, profile: async () => ({}), members: async () => data.members,
    work: async () => { touched.push('review_work'); return {}; },
    commitments: async () => { touched.push('commitment'); return []; },
    flows: async () => { touched.push('flow_approval'); return []; },
    artifacts: async () => { touched.push('artifact_approval'); return []; },
    calendars: async () => { touched.push('calendar_approval'); return []; },
    triage: async () => { touched.push('triage_approval'); return []; },
    publishing: async () => { touched.push('publication_approval'); return null; },
    runs: async () => { touched.push('workflow_ask'); return []; },
  };
  const full = await loadBriefing(member, undefined, deps);
  touched.length = 0;
  const item = full.items.find(i => i.source === 'subtask')!;
  const focused = await loadBriefing(member, undefined, deps, item.id);
  assert.deepEqual(focused.items.find(i => i.id === item.id), item);
  assert.deepEqual(touched, []);
  for (const source of ['review_work', 'commitment', 'commitment_approval', 'flow_approval', 'artifact_approval', 'calendar_approval', 'triage_approval', 'publication_approval', 'workflow_ask']) {
    touched.length = 0;
    await loadBriefing(member, undefined, deps, `${source}:fixture`);
    assert.deepEqual(touched, [source === 'commitment_approval' ? 'commitment' : source]);
  }
});

test('verified voice reads offer a single decision without claiming an approval was saved', async () => {
  const f = voiceFixture();
  await briefingVoice({...f.body,args:{operation:'request_code'}}, f.deps);
  await briefingVoice({...f.body,args:{operation:'verify_code',code:f.code()}}, f.deps);
  f.deps.handle = async () => ({item:{id:'task_approval:p:n:t', version:'current', actions:['approve','reject'], requiredChecks:['visualChecked']}});
  const response = await briefingVoice({...f.body,args:{operation:'read_item',itemId:'task_approval:p:n:t'}}, f.deps);
  assert.equal(response.changeOptions[0].itemId, 'task_approval:p:n:t');
  assert.equal(response.changeOptions[0].version, 'current');
  assert.equal(response.changeOptions[0].action, 'approve');
  assert.equal(response.changeOptions[0].operation, 'decide_item');
  assert.equal(response.changeOptions[0].visualChecked, undefined);
  assert.match(response.nextStep, /final decision/);
  assert.match(response.nextStep, /Do not prepare a second proposal/);
  const again = await briefingVoice({...f.body,args:{operation:'read_item'}}, f.deps);
  assert.equal(again.changeOptions[0].requestId, response.changeOptions[0].requestId);
});
test("live briefing and private history opt in only for the enrolled unambiguous coaching recipient", async () => {
  let settings: any = { enabled: true, enrolledBy: "alice" };
  const deps: any = {
    available: () => true,
    profile: async () => ({
      primaryUserId: "alice",
      primaryPersonId: "person",
    }),
    read: async () => settings,
  };
  const client: any = {
    listPeople: async () => [{ id: "person", phone: "+61400000000" }],
  };
  assert.equal(
    await outboundBriefingEnabled("org", "+61400000000", client, deps),
    true,
  );
  assert.equal(
    await outboundBriefingEnabled("org", "+61400000001", client, deps),
    false,
  );
  settings = { enabled: false, enrolledBy: "alice" };
  assert.equal(
    await outboundBriefingEnabled("org", "+61400000000", client, deps),
    false,
  );
  settings = { enabled: true, enrolledBy: "someone_else" };
  assert.equal(
    await outboundBriefingEnabled("org", "+61400000000", client, deps),
    false,
  );
  settings = { enabled: true, enrolledBy: "alice" };
  client.listPeople = async () => [
    { id: "person", phone: "+61400000000" },
    { id: "other", phone: "+61400000000" },
  ];
  assert.equal(
    await outboundBriefingEnabled("org", "+61400000000", client, deps),
    false,
  );
});
test("version and idempotency hashes do not depend on JSON field order", () => {
  assert.equal(
    fingerprint({ b: 2, a: { y: 2, x: 1 }, absent: undefined }),
    fingerprint({ a: { x: 1, y: 2 }, b: 2 }),
  );
});
test("reports preserve workspace staff choices without granting those labels approval authority", async () => {
  const d = empty();
  d.workspace.settings.people = ["Alice", "Contractor"];
  d.workspace.projects[0].milestones[0].subtasks[1].assignedTo = "Contractor";
  d.flows = [
    {
      id: "flow",
      projectId: "p",
      revision: 1,
      versions: [
        {
          version: 1,
          hash: "h",
          missing: [],
          ask: {
            status: "open",
            kind: "approval",
            prompt: "Contractor decision",
            assignees: ["Contractor"],
          },
        },
      ],
    },
  ];
  const snapshot = buildSnapshot(d, member);
  const staff = snapshot.subjects.find((s) => s.name === "Contractor")!;
  assert.match(staff.id, /^assignee:/);
  assert.equal(staff.kind, "assignee");
  assert.equal(
    briefingReport(snapshot, member, {
      subject: staff.id,
      reportType: "approvals",
    }).total,
    1,
  );
  assert.equal(
    briefingReport(snapshot, member, { subject: staff.id }).total,
    1,
  );
  assert.throws(
    () =>
      briefingReport(
        snapshot,
        { ...member, role: "member" },
        { subject: staff.id },
      ),
    /administrator/,
  );
  const f = changeFixture();
  f.setSnapshot(snapshot);
  const approval = snapshot.items.find((i) => i.source === "flow_approval")!;
  await assert.rejects(
    prepareChange(
      member,
      {
        itemId: approval.id,
        version: approval.version,
        action: "approve",
        requestId: "not_my_approval",
      },
      undefined,
      undefined,
      f.deps,
    ),
    /not available to you/,
  );
});
test("legacy memberships use the current verified email and configured task statuses remain available", async () => {
  const d = empty();
  d.members.alice = { role: "owner" };
  d.workspace.settings.statuses = ["Waiting for materials"];
  const snapshot = buildSnapshot(d, member);
  assert.equal(snapshot.items[0].assigneeUid, "alice");
  const f = changeFixture();
  f.setSnapshot(snapshot);
  const result = await prepareChange(
    member,
    { ...f.input, status: "Waiting for materials" },
    undefined,
    undefined,
    f.deps,
  );
  assert.match(result.readback, /Waiting for materials/);
  await assert.rejects(
    prepareChange(
      member,
      { ...f.input, status: "Invented status", requestId: "other_request_id" },
      undefined,
      undefined,
      f.deps,
    ),
    /Choose one of/,
  );
});
test("commitment transitions use PATCH and reject successful responses for a different record", async () => {
  const d = empty();
  d.commitments = [
    {
      id: "ob_test",
      projectId: "p",
      version: 2,
      state: "candidate",
      reviewerUid: "alice",
      terms: { owner: "user:alice", deliverable: "Fixture" },
      review: {
        ask: { id: "ask", kind: "approval", status: "open", prompt: "Accept?" },
      },
    },
  ];
  const item = buildSnapshot(d, member).items.find(
    (i) => i.source === "commitment_approval",
  )!;
  const change: any = {
    id: "change_commitment",
    uid: member.uid,
    item,
    action: "approve",
    parameters: { note: "Explicit acceptance" },
  };
  const deps = {
    ...executionDependencies,
    commitments: async (req: any) => {
      assert.equal(req.method, "PATCH");
      assert.equal(req.body.action, "respond");
      return { item: { id: "different_record" } } as any;
    },
  };
  await assert.rejects(
    executeChange(member, change, deps),
    /different obligation/,
  );
});
test("confirmation cannot reverse an approval decision or hide a qualification after truncation", () => {
  assert.equal(clearConfirmation("approve it", "reject"), false);
  assert.equal(clearConfirmation("reject it", "approve"), false);
  assert.equal(clearConfirmation("Yes, approve that.", "approve"), true);
  assert.equal(clearConfirmation("Yes — approve.", "approve"), true);
  assert.equal(clearConfirmation("Yes, approve that.", "reject"), false);
  assert.equal(clearConfirmation("Approve that.", "approve"), true);
  assert.equal(
    clearConfirmation("yes, but do not change it", "set_status"),
    false,
  );
  assert.equal(
    clearConfirmation("yes" + " ".repeat(250) + "do not do that", "set_status"),
    false,
  );
  assert.equal(clearConfirmation("Yes, please.", "set_status"), true);
});
test("natural explicit voice confirmations accept the caller's actual phrases without accepting qualifications", () => {
  for (const action of ["approve", "reject", "set_status"]) {
    for (const phrase of ["Yep.", "Yeah, please.", "I confirm the change.", "Confirm the change.", "I confirm this change.", "Yes, confirm this change."]) {
      assert.equal(clearConfirmation(phrase, action), true, `${action}: ${phrase}`);
    }
    for (const phrase of ["Yep, but wait", "I confirm the change if it is correct", "Do not confirm the change", "Can I confirm the change?", "I confirm the change, no wait", "I completed it", "Yep, reject it", "Yeah, approve it"]) {
      assert.equal(clearConfirmation(phrase, action), false, `${action}: ${phrase}`);
    }
  }
});
test("briefing HTTP boundary rejects unsigned and legacy signatures and grants report reads no write scope", async () => {
  const before = process.env.COMMUNICATIONS_WEBHOOK_SECRET;
  process.env.COMMUNICATIONS_WEBHOOK_SECRET = "briefing-test-secret";
  try {
    const unsigned = await eventsPost(
      new Request("https://fixture.test/api/events?action=briefing", {
        method: "POST",
        body: "{}",
      }),
    );
    assert.equal(unsigned.status, 401);
    const legacy = await eventsPost(
      new Request("https://fixture.test/api/events?action=briefing", {
        method: "POST",
        body: "{}",
        headers: {
          "x-communications-signature": `sha256=${createHmac("sha256", "briefing-test-secret").update("{}").digest("hex")}`,
        },
      }),
    );
    assert.equal(legacy.status, 401);
    const oversized = await eventsPost(
      new Request("https://fixture.test/api/events?action=briefing", {
        method: "POST",
        body: "x".repeat(65537),
      }),
    );
    assert.equal(oversized.status, 413);
  } finally {
    if (before === undefined) delete process.env.COMMUNICATIONS_WEBHOOK_SECRET;
    else process.env.COMMUNICATIONS_WEBHOOK_SECRET = before;
  }
  assert.equal(
    requestScope({
      url: "/api/briefings",
      method: "POST",
      body: { operation: "report" },
    }),
    "briefings:read",
  );
  assert.equal(
    requestScope({
      url: "/api/briefings",
      method: "POST",
      body: { operation: "confirm_change" },
    }),
    "briefings:write",
  );
});
test("report date boundaries use the tenant timezone and reject impossible dates", () => {
  const d = empty();
  d.timezone = "Australia/Brisbane";
  d.workspace.projects[0].milestones[0].subtasks[0].dueDate = Date.parse(
    "2026-10-24T15:00:00Z",
  );
  const snapshot = buildSnapshot(d, member);
  assert.equal(
    briefingReport(snapshot, member, {
      startDate: "2026-10-25",
      endDate: "2026-10-25",
    }).total,
    1,
  );
  assert.throws(
    () => briefingReport(snapshot, member, { endDate: "2026-02-30" }),
    /valid ISO/,
  );
});
const empty = (): SourceData => ({
  workspace: {
    dataRevision: 1,
    settings: {
      teamMemberDetails: {
        Alice: { email: "alice@example.test" },
        Bob: { email: "bob@example.test" },
      },
    },
    projects: [
      {
        id: "p",
        name: "Project",
        milestones: [
          {
            id: "n",
            subtasks: [
              {
                id: "t",
                name: "Inspection",
                assignedTo: "Alice",
                status: "Started",
                description: "Inspect rooms",
                dueDate: Date.parse("2026-10-24"),
              },
              {
                id: "b",
                name: "Bobs task",
                assignedTo: "Bob",
                status: "Completed",
              },
              {
                id: "u",
                name: "Unknown",
                assignedTo: "Unmapped",
                status: "Not started",
              },
            ],
          },
        ],
      },
    ],
  },
  members: {
    alice: { email: "alice@example.test" },
    bob: { email: "bob@example.test" },
  },
  commitments: [],
  flows: [],
  artifacts: [],
  calendars: [],
  publications: [],
  runs: [],
  triage: [],
  work: [],
  notices: [],
});

test("briefing resolves only unique member names and keeps unresolved assignments visible as incomplete", () => {
  const s = buildSnapshot(empty(), member, undefined, Date.parse("2026-10-25"));
  assert.equal(s.items.find((i) => i.sourceId === "t")!.assigneeUid, "alice");
  assert.equal(s.incomplete, true);
  assert.match(s.notices.join(" "), /1 project tasks/);
  assert.equal(queryBriefing(s, member).total, 1);
  assert.equal(
    queryBriefing(s, member, { subject: "bob", includeClosed: true }).items[0]
      .title,
    "Bobs task",
  );
  const duplicate = [
    { id: "a", name: "Alex", aliases: ["Alex"] },
    { id: "b", name: "Alex", aliases: ["Alex"] },
  ];
  assert.equal(resolveAssignee("Alex", duplicate), undefined);
  assert.equal(resolveAssignee("Alex", duplicate, { Alex: "a" }), "a");
});
test("report subject permissions, scope, paging and hidden commands are enforced", () => {
  const s = buildSnapshot(empty(), member, undefined, Date.parse("2026-10-25"));
  assert.throws(
    () => briefingReport(s, { ...member, role: "member" }, { subject: "all" }),
    /administrator/,
  );
  assert.throws(
    () => briefingReport(s, member, { subject: "nobody" }),
    /unknown or ambiguous/,
  );
  const result = briefingReport(s, member, { subject: "all" });
  assert.equal(result.byUser.find((r) => r.userId === "alice")!.overdue, 1);
  assert.equal(result.byUser.find((r) => r.userId === "bob")!.completed, 1);
  assert.equal("commands" in result.items[0], false);
  assert.equal(buildSnapshot(empty(), member, ["other"]).items.length, 0);
  assert.throws(() => queryBriefing(s, member, { limit: 0 }), /1–100/);
  assert.throws(
    () => queryBriefing(s, member, { after: "gone" }),
    /list changed/,
  );
});
test("approval queue pins exact domain versions and leaves visual/public checks held", () => {
  const d = empty();
  d.commitments = [
    {
      id: "c",
      projectId: "p",
      version: 2,
      state: "candidate",
      reviewerUid: "alice",
      terms: { owner: "user:alice", deliverable: "Paint" },
      review: {
        ask: {
          id: "ask",
          kind: "approval",
          status: "open",
          prompt: "Accept paint?",
        },
      },
    },
  ];
  d.artifacts = [
    {
      id: "a",
      projectId: "p",
      revision: 3,
      inputHash: "hash",
      createdBy: "alice",
      status: "proposed",
      inputs: { title: "Report" },
    },
  ];
  d.calendars = [
    {
      id: "cal",
      proposals: {
        proposal: {
          id: "proposal",
          projectId: "p",
          status: "review",
          revision: 1,
          hash: "calendar-hash",
          ask: { assignees: ["alice"], prompt: "Book?" },
        },
      },
    },
  ];
  d.publications = [
    {
      id: "pub",
      projectId: "p",
      state: "awaiting_approval",
      revision: 4,
      contentHash: "pub-hash",
      ask: { assignees: ["alice"] },
    },
  ];
  const s = buildSnapshot(d, member);
  assert.equal(queryBriefing(s, member, { kind: "approval" }).total, 4);
  assert.equal(
    s.items.find((i) => i.source === "artifact_approval")!.commands!.approve
      .inputHash,
    "hash",
  );
  assert.equal(
    s.items.find((i) => i.source === "calendar_approval")!.commands!.approve
      .proposalId,
    "proposal",
  );
  assert.deepEqual(
    s.items.find((i) => i.source === "publication_approval")!.requiredChecks,
    ["publicUseChecked"],
  );
});
function changeFixture() {
  const records = new Map<string, any>();
  let snapshot = buildSnapshot(empty(), member),
    effects = 0;
  const deps: any = {
    audit: async () => {},
    reconcile: async () => null,
    snapshot: async () => snapshot,
    read: async (_o: any, _k: any, id: string) => records.get(id),
    transact: async (_o: any, _k: any, id: string, fn: any) => {
      const next = fn(records.get(id) || null);
      records.set(id, next);
      return next;
    },
    membership: async () => member,
    execute: async () => {
      effects++;
      return { saved: true };
    },
  };
  const input = {
    itemId: snapshot.items[0].id,
    version: snapshot.items[0].version,
    action: "set_status",
    status: "Completed",
    requestId: "request_12345",
  };
  return {
    deps,
    input,
    records,
    setSnapshot: (s: any) => (snapshot = s),
    effects: () => effects,
  };
}
test("prepare requires exact version and confirmation is idempotent across repeated deliveries", async () => {
  const f = changeFixture();
  await assert.rejects(
    prepareChange(
      member,
      { ...f.input, version: "old" },
      undefined,
      undefined,
      f.deps,
    ),
    /changed/,
  );
  await assert.rejects(
    prepareChange(
      { ...member, apiClientId: "machine" },
      f.input,
      undefined,
      undefined,
      f.deps,
    ),
    /verified person/,
  );
  const prepared = await prepareChange(
    member,
    f.input,
    undefined,
    undefined,
    f.deps,
  );
  assert.equal(prepared.status, "prepared");
  assert.equal(f.effects(), 0);
  await assert.rejects(
    confirmChange(
      member,
      { id: prepared.id },
      undefined,
      undefined,
      undefined,
      f.deps,
    ),
    /Explicit confirmation/,
  );
  const confirmed = await confirmChange(
    member,
    { id: prepared.id, confirmed: true },
    undefined,
    undefined,
    undefined,
    f.deps,
  );
  assert.equal(confirmed.status, "completed");
  await confirmChange(
    member,
    { id: prepared.id, confirmed: true },
    undefined,
    undefined,
    undefined,
    f.deps,
  );
  assert.equal(f.effects(), 1);
  await assert.rejects(
    prepareChange(
      member,
      { ...f.input, status: "Started" },
      undefined,
      undefined,
      f.deps,
    ),
    /different content/,
  );
});
test("voice changes cannot reuse another call or an old, negative or ambiguous human turn", async () => {
  const f = changeFixture();
  const p = await prepareChange(member, f.input, undefined, "call1", f.deps);
  await assert.rejects(readChange(member, p.id, "call2", f.deps), /not found/);
  for (const c of [
    { text: "yes", at: 0 },
    { text: "no", at: Date.now() + 1 },
    { text: "yes but do not do that", at: Date.now() + 1 },
  ]) {
    await assert.rejects(
      confirmChange(member, { id: p.id }, undefined, "call1", c, f.deps),
      /confirmation/,
    );
  }
  await new Promise((r) => setTimeout(r, 2));
  const r = await confirmChange(
    member,
    { id: p.id },
    undefined,
    "call1",
    { text: "confirm", at: Date.now() },
    f.deps,
  );
  assert.equal(r.status, "completed");
  assert.equal(f.effects(), 1);
});
test("one conversational decision saves immediately without a second proposal or confirmation", async () => {
  const f = changeFixture();
  const focus = { itemId: f.input.itemId, version: f.input.version, at: Date.now() - 100 };
  const human = { text: "Yes.", at: Date.now() - 10, itemId: "caller-decision" };
  const result = await decideVoiceChange(member, f.input, undefined, "call", human, focus, f.deps);
  assert.equal(result.status, "completed");
  assert.equal(f.effects(), 1);
  assert.equal(f.records.get(f.input.requestId).confirmation.mode, "conversation");
  assert.ok(f.records.get(f.input.requestId).createdAt > human.at);
  await decideVoiceChange(member, f.input, undefined, "call", human, focus, f.deps);
  assert.equal(f.effects(), 1);
  assert.equal((await decideVoiceChange(member, f.input, undefined, "call", null, null as any, f.deps)).status,'completed');
  await assert.rejects(decideVoiceChange(member, {...f.input,status:'Started'}, undefined, "call", human, focus, f.deps),/different content/);
});
test("interpreted call decisions do not require ASR wording, timing or a prior focus marker", async () => {
  const f = changeFixture();
  assert.equal((await decideVoiceChange(member,f.input,undefined,'call',null,undefined,f.deps)).status,'completed');
  assert.equal(f.effects(),1);
  const g=changeFixture();
  const changed = buildSnapshot(empty(),member);changed.items[0].version = 'new';f.setSnapshot(changed);
  g.setSnapshot(changed);
  await assert.rejects(decideVoiceChange(member,g.input,undefined,"call",null,undefined,g.deps),/changed/);
  assert.equal(g.effects(),0);
});
test("progress accepts the interpreted update immediately and does not require an extra note", async () => {
  const f=changeFixture(), snapshot=buildSnapshot(empty(),member);
  snapshot.items[0].actions=['progress'];f.setSnapshot(snapshot);
  const text='That particular piece is done, but the overall tests are ongoing.';
  const input={...f.input,action:'progress',note:text};
  const focus={itemId:input.itemId,version:input.version,at:Date.now()-100};
  const human={text,at:Date.now()};
  assert.equal((await decideVoiceChange(member,input,undefined,'call',human,focus,f.deps)).status,'completed');
  assert.equal(f.records.get(input.requestId).parameters.note,text);
  assert.equal((await decideVoiceChange(member,input,undefined,'call',null,null as any,f.deps)).status,'completed');
  assert.equal(f.effects(),1);
  const other={...input,note:'',requestId:'different_request'};
  assert.equal((await decideVoiceChange(member,other,undefined,'call',null,undefined,f.deps)).status,'completed');
  assert.equal(f.records.get(other.requestId).parameters.note,'Progress reported during coaching call.');
  assert.equal(f.effects(),2);
});
test("lost domain results remain uncertain and are never automatically replayed", async () => {
  const f = changeFixture();
  let attempts = 0;
  f.deps.execute = async () => {
    attempts++;
    throw new Error("connection lost after save");
  };
  const p = await prepareChange(member, f.input, undefined, undefined, f.deps);
  assert.equal(
    (
      await confirmChange(
        member,
        { id: p.id, confirmed: true },
        undefined,
        undefined,
        undefined,
        f.deps,
      )
    ).status,
    "uncertain",
  );
  await confirmChange(
    member,
    { id: p.id, confirmed: true },
    undefined,
    undefined,
    undefined,
    f.deps,
  );
  assert.equal(attempts, 1);
});
test("a concurrent record or reviewer change invalidates confirmation", async () => {
  const f = changeFixture();
  const p = await prepareChange(member, f.input, undefined, undefined, f.deps);
  const changed = buildSnapshot(empty(), member);
  changed.items[0].version = "new";
  f.setSnapshot(changed);
  await assert.rejects(
    confirmChange(
      member,
      { id: p.id, confirmed: true },
      undefined,
      undefined,
      undefined,
      f.deps,
    ),
    /authority changed/,
  );
  assert.equal(f.effects(), 0);
});
function voiceFixture() {
  const records = new Map<string, any>();
  let sent = "";
  let smsCount = 0;
  let reads = 0;
  const body = {
    tenant_id: "org",
    person_id: "person",
    communication_id: "call",
    thread_id: "thread",
    service_identity: "+61000000000",
    args: { operation: "list_tasks" },
  };
  const settings = {
    enabled: true,
    enrolledBy: "alice",
    allowTaskUpdates: true,
    allowApprovals: true,
    requireSmsVerification: true,
  };
  const deps: any = {
    profile: async () => ({
      primaryUserId: "alice",
      primaryPersonId: "person",
      serviceIdentities: { phone: body.service_identity },
      allowedProjectIds: ["p"],
    }),
    member: async () => member,
    settings: async () => settings,
    communication: async () => ({
      tenantId: "org",
      personId: "person",
      threadId: "thread",
      channel: "voice",
      status: "in_progress",
    }),
    people: async () => [{ id: "person", phone: "+61400000000" }],
    read: async (_o: any, kind: string, id: string) => records.get(kind + id),
    transact: async (_o: any, kind: string, id: string, fn: any) => {
      const row = fn(records.get(kind + id) || null);
      records.set(kind + id, row);
      return row;
    },
    sendSms: async (req: any) => {
      smsCount++;
      sent = req.body;
      return { id: "sms1" };
    },
    handle: async () => {
      reads++;
      return { items: [] };
    },
  };
  return {
    body,
    deps,
    records,
    settings,
    smsCount: () => smsCount,
    code: () => sent.match(/\b\d{6}\b/)![0],
    reads: () => reads,
  };
}
test("outbound SMS verification can be disabled, re-enabled, and never bypasses inbound authentication", async () => {
  const f=voiceFixture();f.settings.requireSmsVerification=false;
  const communication=await f.deps.communication();
  f.deps.communication=async()=>({...communication,direction:'outbound',purpose:{type:'coaching_session'}});
  assert.equal((await briefingVoice({...f.body,args:{operation:'start_briefing'}},f.deps)).status,'ready');
  assert.equal(f.smsCount(),0);
  await briefingVoice(f.body,f.deps);
  assert.equal(f.reads(),1);
  f.settings.requireSmsVerification=true;
  await assert.rejects(briefingVoice(f.body,f.deps),/Verify the SMS/);
  assert.equal((await briefingVoice({...f.body,args:{operation:'start_briefing'}},f.deps)).status,'code_sent');
  assert.equal(f.smsCount(),1);
  await briefingVoice({...f.body,args:{operation:'verify_code',code:f.code()}},f.deps);
  await briefingVoice(f.body,f.deps);
  const inbound=voiceFixture();inbound.settings.requireSmsVerification=false;
  inbound.deps.communication=async()=>({...communication,direction:'inbound',purpose:{type:'coaching_session'}});
  await assert.rejects(briefingVoice(inbound.body,inbound.deps),/Verify the SMS/);
  assert.equal((await briefingVoice({...inbound.body,args:{operation:'start_briefing'}},inbound.deps)).status,'code_sent');
  assert.equal(inbound.smsCount(),1);
});
test("signed gateway still requires per-call SMS verification and rechecks revoked settings", async () => {
  const f = voiceFixture();
  await assert.rejects(briefingVoice(f.body, f.deps), /Verify the SMS/);
  assert.equal(f.reads(), 0);
  const request = { ...f.body, args: { operation: "request_code" } };
  assert.equal((await briefingVoice(request, f.deps)).status, "code_sent");
  assert.equal(
    (await briefingVoice(request, f.deps)).status,
    "code_already_requested",
  );
  await assert.rejects(
    briefingVoice(
      { ...f.body, args: { operation: "verify_code", code: "000000" } },
      f.deps,
    ),
    /incorrect/,
  );
  assert.equal(
    (
      await briefingVoice(
        { ...f.body, args: { operation: "verify_code", code: f.code() } },
        f.deps,
      )
    ).status,
    "verified",
  );
  await briefingVoice(f.body, f.deps);
  assert.equal(f.reads(), 1);
  await assert.rejects(
    briefingVoice(
      {
        ...f.body,
        args: { operation: "map_assignee", name: "Alice", userId: "attacker" },
      },
      f.deps,
    ),
    /not available through the voice/,
  );
  f.settings.enabled = false;
  await assert.rejects(briefingVoice(f.body, f.deps), /Enable and enrol/);
});
test("single-decision voice gateway honours call authentication and disabled writes without extra focus or ASR gates", async () => {
  const f = voiceFixture(), changes = changeFixture();
  f.deps.decide = (...args:any[]) => decideVoiceChange(args[0],args[1],args[2],args[3],args[4],args[5],changes.deps);
  const request = { ...f.body, args:{...changes.input,operation:'decide_item'}, evidence:{human:{text:'Yes.',at:Date.now()}} };
  await assert.rejects(briefingVoice(request,f.deps),/Verify the SMS/);
  await briefingVoice({...f.body,args:{operation:'request_code'}},f.deps);
  await briefingVoice({...f.body,args:{operation:'verify_code',code:f.code()}},f.deps);
  assert.equal((await briefingVoice(request,f.deps)).status,'completed');
  f.deps.handle = async () => ({item:{id:changes.input.itemId,version:changes.input.version,actions:['set_status']}});
  await briefingVoice({...f.body,args:{operation:'read_item',itemId:changes.input.itemId}},f.deps);
  await new Promise(resolve=>setTimeout(resolve,2));
  request.evidence.human.at=Date.now();
  assert.equal((await briefingVoice(request,f.deps)).status,'completed');
  assert.equal(changes.effects(),1);
  f.settings.allowTaskUpdates=false;
  await assert.rejects(briefingVoice(request,f.deps),/disabled/);
});
test("OTP attempts lock persistently and caller/project parameters cannot widen identity", async () => {
  const f = voiceFixture();
  await briefingVoice(
    { ...f.body, args: { operation: "request_code" } },
    f.deps,
  );
  for (let n = 0; n < 5; n++)
    await assert.rejects(
      briefingVoice(
        { ...f.body, args: { operation: "verify_code", code: "000000" } },
        f.deps,
      ),
      /incorrect/,
    );
  await assert.rejects(
    briefingVoice(
      { ...f.body, args: { operation: "verify_code", code: f.code() } },
      f.deps,
    ),
    /incorrect/,
  );
  await assert.rejects(
    briefingVoice({ ...f.body, person_id: "attacker" }, f.deps),
    /not enrolled/,
  );
});
test("task execution saves the original record, activity, revision and an atomic recovery receipt", async () => {
  const f = changeFixture();
  const p = await prepareChange(member, f.input, undefined, undefined, f.deps);
  let workspace = empty().workspace;
  workspace.projects[0].projectData = {flow_run_id:'run'};
  const change = f.records.get(p.id);
  const deps = {
    ...executionDependencies,
    workspace: async (_org: string, update: any) =>
      (workspace = update(workspace)),
  };
  await executeChange(member, change, deps);
  assert.equal(
    workspace.projects[0].milestones[0].subtasks[0].status,
    "Completed",
  );
  assert.equal(workspace.dataRevision, 2);
  assert.equal(workspace.activityLogs.length, 1);
  assert.equal(
    workspace.briefingReceipts[p.id].requestHash,
    change.requestHash,
  );
  await executeChange(member, change, deps);
  assert.equal(workspace.dataRevision, 2);
  assert.equal(workspace.activityLogs.length, 1);
  const savedTask = workspace.projects[0].milestones[0].subtasks[0];
  const approval: any = {...change, id:'approval_change', action:'approve', requestHash:'approval_hash',
    item:{...change.item, version:fingerprint(savedTask), commands:{approve:{domain:'task_approval',projectId:'p',nodeId:'n',id:'t'}}}};
  await executeChange(member, approval, deps);
  const edit = workspace.projects[0].milestones[0].subtasks[0].briefingEdit;
  assert.equal(edit.status, 'Completed');
  assert.equal(edit.approvalStatus, 'approved');
  assert.equal(edit.id, 'approval_change');
});
test("domain approval executes the exact prepared operation with a server-owned recovery marker", async () => {
  const d = empty();
  d.artifacts = [
    {
      id: "a",
      projectId: "p",
      revision: 3,
      inputHash: "hash",
      createdBy: "alice",
      status: "proposed",
      inputs: { title: "Report" },
    },
  ];
  const snapshot = buildSnapshot(d, member),
    item = snapshot.items.find((i) => i.source === "artifact_approval")!;
  let called: any;
  await executeChange(
    member,
    {
      id: "approval_123",
      uid: member.uid,
      callId: "call",
      createdAt: 0,
      expiresAt: 9999999999999,
      status: "processing",
      requestHash: "x",
      item,
      action: "approve",
      parameters: {},
      readback: "Readback",
    },
    {
      ...executionDependencies,
      artifacts: async (req, actor) => {
        called = req.body;
        assert.equal(decisionResponseId(actor), "briefing_approval_123");
        assert.equal(decisionChannel(actor), "voice");
        return { item: { status: "approved" } };
      },
    },
  );
  assert.equal(called.operation, "approve");
  assert.equal(called.revision, 3);
  assert.equal(called.inputHash, "hash");
  assert.notEqual(
    decisionResponseId({ ...member, briefingChangeId: "injected" }),
    "briefing_injected",
  );
});
test("approval cannot silently skip required visual or public-use checks", async () => {
  const f = changeFixture();
  const d = empty();
  d.publications = [
    {
      id: "pub",
      projectId: "p",
      state: "awaiting_approval",
      revision: 1,
      contentHash: "h",
      ask: { assignees: ["alice"] },
    },
  ];
  const s = buildSnapshot(d, member);
  f.setSnapshot(s);
  const item = s.items.find((i) => i.source === "publication_approval")!;
  const input = {
    itemId: item.id,
    version: item.version,
    action: "approve",
    requestId: "public_12345",
  };
  await assert.rejects(
    prepareChange(member, input, undefined, undefined, f.deps),
    /publicUseChecked/,
  );
  const p = await prepareChange(
    member,
    { ...input, publicUseChecked: true },
    undefined,
    undefined,
    f.deps,
  );
  assert.match(p.readback, /permitted for public use/);
});
test("read-only reconciliation recovers a lost result using the saved operation marker", async () => {
  const f = changeFixture();
  const p = await prepareChange(member, f.input, undefined, undefined, f.deps);
  f.records.get(p.id).status = "uncertain";
  f.deps.reconcile = async () => ({ saved: true, receipt: "source-marker" });
  const result = await readChange(member, p.id, undefined, f.deps);
  assert.equal(result.status, "completed");
  assert.equal(f.effects(), 0);
});
test("voice gateway refuses a confirmed action until readback playback and a later caller turn", async () => {
  const f = voiceFixture();
  await briefingVoice(
    { ...f.body, args: { operation: "request_code" } },
    f.deps,
  );
  await briefingVoice(
    { ...f.body, args: { operation: "verify_code", code: f.code() } },
    f.deps,
  );
  const proposal = {
    id: "proposal",
    uid: "alice",
    callId: "call",
    createdAt: 100,
    readback: "Inspection. Mark completed. Confirm this change?",
    action: "set_status",
  };
  f.records.set("changesproposal", proposal);
  f.deps.confirm = async () => ({ status: "completed" });
  const body = {
    ...f.body,
    args: { operation: "confirm_change", id: "proposal" },
    evidence: {
      assistant: {
        text: proposal.readback,
        at: 101,
        playedAt: 103,
        interrupted: false,
      },
      human: { text: "confirm", at: 104 },
    },
  };
  assert.equal((await briefingVoice(body, f.deps)).status, "completed");
  await assert.rejects(
    briefingVoice(
      {
        ...body,
        evidence: {
          ...body.evidence,
          assistant: { ...body.evidence.assistant, interrupted: true },
        },
      },
      f.deps,
    ),
    /aloud in full/,
  );
  await assert.rejects(
    briefingVoice(
      {
        ...body,
        evidence: { ...body.evidence, human: { text: "confirm", at: 102 } },
      },
      f.deps,
    ),
    /complete readback/,
  );
});
