import { validateProject } from '../configuration/model.js';
import { projectConfiguration } from '../configuration/schema.js';
import { projectCollectionsShareRevisions } from "../projectRevisionGuard.js";
import { TenantControlError } from "./model.js";
/** Same optimistic boundary as the existing browser workspace save. Business ledgers are separate. */
export function replaceWorkspace(current: any, body: any, now = Date.now()) {
  const value = body?.data;
  if (
    !Number.isInteger(body?.expectedRevision) ||
    body.expectedRevision < 0 ||
    !value ||
    !Array.isArray(value.projects) ||
    !value.settings ||
    typeof value.settings !== "object" ||
    Array.isArray(value.settings)
  )
    throw new TenantControlError(
      422,
      "Workspace data and current revision required",
    );
  if (
    value.projects.length > 500 ||
    !Array.isArray(value.scratchTasks || []) ||
    !Array.isArray(value.activityLogs || [])
  )
    throw new TenantControlError(422, "Invalid workspace collection");
  if (
    value.projects.some(
      (p: any) =>
        !p ||
        typeof p.id !== "string" ||
        !p.id ||
        !Array.isArray(p.milestones || []),
    )
  )
    throw new TenantControlError(
      422,
      "Each project requires a stable identity and milestones",
    );
  if (
    Number(current?.dataRevision || 0) !== body.expectedRevision ||
    !projectCollectionsShareRevisions(current?.projects, value.projects)
  )
    throw new TenantControlError(
      409,
      "Workspace changed; reload and review before saving",
    );
  const issues=value.projects.flatMap((p:any)=>validateProject(projectConfiguration(p)));
  if(issues.length)throw new TenantControlError(422,JSON.stringify(issues));
  const result = {
    ...(current || {}),
    projects: value.projects.map((p: any) => ({
      ...p,
      revision: Number(p.revision || 0) + 1,
    })),
    settings: value.settings,
    scratchTasks: value.scratchTasks || [],
    activityLogs: value.activityLogs || [],
    lastUpdated: now,
    dataRevision: body.expectedRevision + 1,
  };
  if (Buffer.byteLength(JSON.stringify(result)) > 3800000)
    throw new TenantControlError(
      413,
      "Workspace exceeds the 3.8 MB write limit",
    );
  return result;
}

/** Firebase omits empty objects/arrays. A REST read must remain a valid PUT input. */
export function workspaceView(data:any){
 const rows=(value:any)=>Array.isArray(value)?value.filter(Boolean):Object.values(value||{});
 return {...(data||{}),projects:rows(data?.projects),settings:data?.settings||{},scratchTasks:rows(data?.scratchTasks),activityLogs:rows(data?.activityLogs),dataRevision:Number(data?.dataRevision||0)};
}
