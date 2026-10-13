import test from "node:test";
import assert from "node:assert/strict";
import {
  conversationEvidence,
  conversationInstructions,
} from "../lib/conversationContinuity.js";
import { normalizeTenantAgentProfile } from "../lib/serverStore.js";
const profile = normalizeTenantAgentProfile({
  primaryPersonId: "alex",
  allowedProjectIds: ["alpha"],
  conversation: {
    prompt: "Use status pack",
    smsPrompt: "One question",
    voicePrompt: "Speak slowly",
  },
});
const input = {
  orgId: "tenant-a",
  personId: "alex",
  projectId: "alpha",
  threadId: "thread-a",
  profile,
};
const row = (id: string, more: any = {}) => ({
  communication_id: id,
  person_id: "alex",
  correlation: { external_project_id: "alpha" },
  memory_eligible: true,
  thread_id: "thread-a",
  channel: "sms",
  direction: "inbound",
  occurred_at: "2026-09-09T10:00:00Z",
  body: "The revised deadline is Wednesday.",
  ...more,
});
test("shared and channel prompts persist, clear and remain bounded", () => {
  assert.equal(
    conversationInstructions(profile, "sms"),
    "Use status pack\n\nOne question",
  );
  assert.equal(
    conversationInstructions(profile, "voice"),
    "Use status pack\n\nSpeak slowly",
  );
  assert.equal(
    normalizeTenantAgentProfile({ conversation: { prompt: "" } }, profile)
      .conversation?.prompt,
    "",
  );
  assert.equal(
    normalizeTenantAgentProfile(
      { conversation: { prompt: "x".repeat(5000) } },
      profile,
    ).conversation?.prompt?.length,
    4000,
  );
  assert.equal(
    normalizeTenantAgentProfile(
      { conversation: { historyEnabled: false } },
      profile,
    ).conversation?.historyEnabled,
    false,
  );
});
test("continuity reads exact person/project and projects only bounded cross-channel evidence", async () => {
  const result = await conversationEvidence(input, async (org, request) => {
    assert.equal(org, "tenant-a");
    assert.deepEqual(request.allowed_project_ids, ["alpha"]);
    assert.equal(request.person_id, "alex");
    assert.equal(request.conversation_thread_id, "thread-a");
    assert.equal(request.include_private, false);
    return {
      contract_version: "memory-context.v1",
      memory_status: {
        state: "current",
        retrieved_at: "2026-09-09T10:00:00Z",
        evidence_only: true,
      },
      data: {
        communications: [
          ...["email", "sms", "voice", "recording"].map((channel) =>
            row(channel, { channel }),
          ),
          row("other-person", { person_id: "pat" }),
          row("other-project", {
            correlation: { external_project_id: "beta" },
          }),
          row("private", { metadata: { private: true } }),
          row("failed", { memory_eligible: false }),
          row("unassigned-current", {correlation:{}}),
          row("unassigned-other", {correlation:{},thread_id:'other'}),
        ],
      },
    };
  });
  assert.deepEqual(
    result.sources.map((s) => s.id),
    ["email", "sms", "voice", "recording", "unassigned-current"],
  );
  assert.equal(result.truncated, true);
  assert.ok(!JSON.stringify(result).includes("other-person"));
  assert.equal(result.status, "current");
});
test("revoked grants and disabled history never fetch; outage is explicitly unavailable", async () => {
  let reads = 0;
  const unavailable = async () => {
    reads++;
    throw new Error("offline");
  };
  assert.equal(
    (
      await conversationEvidence(
        {
          ...input,
          profile: {
            ...profile,
            personProjectAccess: [{ personId: "pat", projectIds: ["alpha"] }],
          },
        },
        unavailable,
      )
    ).status,
    "unavailable",
  );
  assert.equal(
    (
      await conversationEvidence(
        {
          ...input,
          profile: { ...profile, conversation: { historyEnabled: false } },
        },
        unavailable,
      )
    ).status,
    "disabled",
  );
  assert.equal(reads, 0);
  assert.equal(
    (await conversationEvidence(input, unavailable)).status,
    "unavailable",
  );
  assert.equal(reads, 1);
});
test("long history retains source IDs and explicit incompleteness without leaking provider metadata", async () => {
  const result = await conversationEvidence(input, async () => ({
    contract_version: "memory-context.v1",
    memory_status: {
      state: "stale",
      retrieved_at: "2026-09-09T10:00:00Z",
      evidence_only: true,
    },
    data: {
      communications: Array.from({ length: 40 }, (_, i) =>
        row("id" + i, {
          body: "x".repeat(6000),
          metadata: { token: "secret" },
        }),
      ),
    },
  }));
  assert.equal(result.status, "stale");
  assert.ok(result.sources.reduce((n, s) => n + s.text.length, 0) <= 14000);
  assert.ok(!JSON.stringify(result).includes("secret"));
  assert.equal(result.truncated, true);
});

test('a selected thread cannot include evidence from a different thread', async () => {
  const { conversationEvidence } = await import('../lib/conversationContinuity.js');
  const result = await conversationEvidence({ orgId: 'tenant', projectId: 'project', personId: 'person', threadId: 'wanted', strictThread: true,
    profile: { primaryPersonId: 'person', allowedProjectIds: ['project'] } as any }, async () => ({
      memory_status: { state: 'current' }, data: { communications: ['wanted', 'other'].map(thread_id => ({
        communication_id: thread_id, thread_id, person_id: 'person', correlation: { external_project_id: 'project' },
        memory_eligible: true, body: thread_id, occurred_at: '2026-10-13T00:00:00Z'
      })) }
    }) as any);
  assert.deepEqual(result.sources.map(source => source.id), ['wanted']);
});
