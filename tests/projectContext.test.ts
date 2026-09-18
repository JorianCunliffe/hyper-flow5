import { test } from "node:test";
import assert from "node:assert/strict";
import { inProjectContext, jobInProjectContext } from "../lib/projectContext";
import { WORKSPACE_VIEWS, workspaceViewFor } from "../lib/appView";
test("seven views contain every user destination exactly once, keeping administration out of daily navigation", () => {
  assert.equal(WORKSPACE_VIEWS.length, 7);
  const modes = WORKSPACE_VIEWS.flatMap((section) =>
    section.modes.map((mode) => mode.id),
  );
  assert.equal(new Set(modes).size, 14);
  assert.equal(modes.length, 14);
  assert.equal(workspaceViewFor("approvals")?.id, "overview");
  assert.equal(workspaceViewFor("scratch")?.id, "work");
  assert.equal(workspaceViewFor("meetings")?.id, "communications");
  assert.equal(workspaceViewFor("publishing")?.id, "documents");
  assert.equal(workspaceViewFor("tenant"), undefined);
});
test("project context excludes unrelated and unassigned records; all projects includes them", () => {
  assert.equal(inProjectContext({ projectId: "alpha" }, "alpha"), true);
  assert.equal(inProjectContext({ projectId: "beta" }, "alpha"), false);
  assert.equal(inProjectContext({}, "alpha"), false);
  assert.equal(inProjectContext({}, null), true);
});
test("agent job scope follows routing, trusted correlation, then message; never leaks unrelated jobs", () => {
  const items = [{ communicationId: "c1", projectId: "alpha" }] as any;
  assert.equal(
    jobInProjectContext({ communicationId: "c1" } as any, "alpha", items),
    true,
  );
  assert.equal(
    jobInProjectContext(
      { communicationId: "c1", routing: { projectId: "beta" } } as any,
      "alpha",
      items,
    ),
    false,
  );
  assert.equal(
    jobInProjectContext({ trustedProjectId: "alpha" } as any, "alpha", []),
    true,
  );
  assert.equal(jobInProjectContext({} as any, "alpha", []), false);
  assert.equal(jobInProjectContext({} as any, null, []), true);
});
