import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  consumeReviewAction,
  validateReviewAction,
  type ReviewActionEvent,
  type ReviewActionDependencies,
} from "../lib/reviewActions.js";
const event = (): ReviewActionEvent => ({
  type: "review.action.requested",
  tenant_id: "org",
  payload: {
    contract_version: "review-action.v1",
    action_id: "a1",
    idempotency_key: "a1",
    owner_id: "person:alice",
    session_id: "s1",
    instruction: "Create report task",
    scope: { allowed_project_ids: ["p1"] },
    proposal: {
      version: "review-action.v1",
      type: "task",
      project_id: "p1",
      authorization: "CONFIRMED",
      clarification: [],
      parameters: { title: "Report" },
    },
  },
});
function fixture() {
  let state: any = null,
    effects = 0,
    reports = 0,
    failCallback = false;
  const deps: ReviewActionDependencies = {
    authorize: async () => "uid",
    transact: async (_t, _id, update) => (state = update(state)),
    execute: async () => {
      effects++;
      return {
        status: "SUCCEEDED",
        receipt_id: "r1",
        result: {
          provider_id: "task1",
          completed_at: "2026-09-20T00:00:00Z",
          summary: "Task created",
        },
      };
    },
    report: async () => {
      reports++;
      if (failCallback) throw Error("Callback lost");
    },
  };
  return {
    deps,
    get effects() {
      return effects;
    },
    get reports() {
      return reports;
    },
    set failCallback(value: boolean) {
      failCallback = value;
    },
  };
}
test("duplicate review events reuse execution receipt", async () => {
  const f = fixture();
  await consumeReviewAction(event(), f.deps);
  await consumeReviewAction(event(), f.deps);
  assert.equal(f.effects, 1);
  assert.equal(f.reports, 2);
});
test("provider success followed by lost callback retries only reporting", async () => {
  const f = fixture();
  f.failCallback = true;
  await assert.rejects(consumeReviewAction(event(), f.deps), /Callback lost/);
  f.failCallback = false;
  await consumeReviewAction(event(), f.deps);
  assert.equal(f.effects, 1);
  assert.equal(f.reports, 2);
});
test("changed payload cannot reuse an action id", async () => {
  const f = fixture();
  await consumeReviewAction(event(), f.deps);
  const changed = event();
  changed.payload.proposal.parameters.title = "Other";
  await assert.rejects(
    consumeReviewAction(changed, f.deps),
    /identity conflict/,
  );
  assert.equal(f.effects, 1);
});
test("revoked owner authorization prevents execution and reporting", async () => {
  const f = fixture();
  f.deps.authorize = async () => {
    throw Error("revoked");
  };
  await assert.rejects(consumeReviewAction(event(), f.deps), /revoked/);
  assert.equal(f.effects, 0);
  assert.equal(f.reports, 0);
});
test("unconfirmed, unresolved and out-of-scope requests fail closed", () => {
  for (const change of [
    (e: ReviewActionEvent) => {
      e.payload.proposal.authorization = "UNCONFIRMED" as any;
    },
    (e: ReviewActionEvent) => {
      e.payload.proposal.project_id = "other";
    },
    (e: ReviewActionEvent) => {
      e.payload.proposal.clarification = ["who?"];
    },
  ]) {
    const e = event();
    change(e);
    assert.throws(() => validateReviewAction(e));
  }
});

test("shared cross-repository action fixture is accepted", () => {
  validateReviewAction(
    JSON.parse(
      readFileSync(
        new URL(
          "../contracts/fixtures/review-action.requested.json",
          import.meta.url,
        ),
        "utf8",
      ),
    ),
  );
});

test("property reordering on persisted webhook replay preserves identity", async () => {
  const f = fixture();
  const first = event();
  await consumeReviewAction(first, f.deps);
  const reordered = {
    ...first,
    payload: Object.fromEntries(Object.entries(first.payload).reverse()),
  };
  await consumeReviewAction(reordered, f.deps);
  assert.equal(f.effects, 1);
});
test("concurrent webhook workers cannot dispatch the same action twice", async () => {
  const f = fixture();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = f.deps.execute;
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  f.deps.execute = async (e, uid) => {
    entered();
    await gate;
    return original(e, uid);
  };
  const first = consumeReviewAction(event(), f.deps);
  await started;
  await assert.rejects(
    consumeReviewAction(event(), f.deps),
    /already executing/,
  );
  release();
  await first;
  assert.equal(f.effects, 1);
});
