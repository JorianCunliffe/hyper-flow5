import { taskContracts } from "./taskContracts.js";
import { buildOpenApi, domainOperations } from "./openapi.js";
import { configurationSchemas, views } from "../configuration/schema.js";
import { API_GROUPS } from "../tenantControl/model.js";
import { TASK_TYPES } from "../taskTypes.js";
import { ACTION_TASK_TYPE } from "../nodeTypes.js";
import { FLOW_CATALOG } from "../visibleFlows/model.js";
import { NodeType } from "../../types.js";
export function discoveryResponse(format?: unknown) {
  if (format === "openapi") return buildOpenApi();
  return {
    version: "1.0.0",
    openapi: "/api/openapi.json",
    schemas: configurationSchemas,
    nodeTypes: Object.values(NodeType),
    taskTypes: TASK_TYPES,
    taskContracts,
    actionTaskTypes: ACTION_TASK_TYPE,
    visibleFlowCatalog: FLOW_CATALOG,
    operations: domainOperations,
    views,
    scopes: API_GROUPS.flatMap((g) =>
      g === "tenant" ? [g + ":read"] : [g + ":read", g + ":write"],
    ),
    workflow: [
      "discover",
      "read",
      "plan",
      "apply",
      "test",
      "inspect",
      "human approval where required",
      "execute",
      "reconcile",
    ],
    limits: {
      configurationChanges: 100,
      projects: 500,
      workspaceBytes: 3800000,
      testRuns: 100,
      testResultBytes: 256000,
    },
    handoffs: [
      "OAuth requires human consent",
      "Review decisions and credential/lifecycle administration require a human session",
    ],
    testing: {
      mode: "fixture simulation",
      providerCalls: 0,
      liveReadiness:
        "Use service-projects/validate and domain connection/grant APIs; simulation does not prove provider availability",
    },
  };
}
