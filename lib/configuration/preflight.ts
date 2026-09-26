import { readTenantCapabilityPolicy } from "../capabilityPolicyStore.js";
import { readProjectWorkspaceResources } from "../workspaceResourceCatalog.js";
import { TASK_CAPABILITY } from "../capabilityPolicy.js";
import { ACTION_TASK_TYPE } from "../nodeTypes.js";
import { readFlowPath, validateOutputSchema } from "../flowData.js";
/** Configuration-only inspection: no sync, send, provider write or token exchange. */
export async function configurationPreflight(org: string, projects: any[]) {
  let policy: any;
  let policyState = "available";
  try {
    policy = await readTenantCapabilityPolicy(org);
  } catch {
    policyState = "unavailable";
  }
  const checks: any[] = [];
  for (const p of projects) {
    let resources: any[] = [];
    let resourceState = "available";
    try {
      resources = await readProjectWorkspaceResources(org, p.id);
    } catch {
      resourceState = "unavailable";
    }
    const outputs = new Set(
      (p.milestones || [])
        .map((n: any) => n.actionConfig?.resultVariable)
        .filter(Boolean),
    );
    for (const n of p.milestones || []) {
      const task =
        ACTION_TASK_TYPE[n.nodeType as keyof typeof ACTION_TASK_TYPE];
      if (!task) continue;
      const capability = TASK_CAPABILITY[task];
      let template: any = {};
      const unresolved: string[] = [];
      const issues: string[] = [];
      const text = String(n.actionConfig?.template || "");
      for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
        try {
          readFlowPath(p.projectData || {}, match[1]);
        } catch {
          if (![...outputs].some((o: any) => match[1].startsWith(o)))
            unresolved.push(match[1]);
        }
      }
      try {
        template = JSON.parse(text);
      } catch {
        if (text.trim().startsWith("{") && !text.includes("{{"))
          issues.push("Invalid JSON action template");
      }
      if (template.output_schema)
        try {
          validateOutputSchema(template.output_schema);
        } catch (e: any) {
          issues.push(e.message);
        }
      if (
        template.resource_name &&
        !resources.some((r) => r.name === template.resource_name)
      )
        issues.push(
          resourceState === "unavailable"
            ? "Resource registry unavailable"
            : "Named resource not configured",
        );
      checks.push({
        projectId: p.id,
        nodeId: n.id,
        taskType: task,
        capability: capability || null,
        policyState,
        mode: capability
          ? policy?.[capability] || "approval"
          : "not_applicable",
        resourceState,
        unresolvedInputs: [...new Set(unresolved)],
        issues,
      });
    }
  }
  return {
    checks,
    providerAvailability: "not_checked",
    sideEffects: false,
    ready: checks.every(
      (c) =>
        !c.issues.length &&
        !c.unresolvedInputs.length &&
        c.policyState === "available" &&
        c.resourceState === "available" &&
        c.mode !== "denied",
    ),
  };
}
