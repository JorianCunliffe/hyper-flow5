import { redactTenantExport } from '../tenantLifecycle/model.js';
import {
  readTenantControl,
  transactTenantControl,
  requireOrganizationMember,
  readTenantWorkspace,
  replaceTenantWorkspace,
} from "../serverStore.js";
import { workspaceView } from "./workspace.js";
import { TenantControlError } from "./model.js";
import { handleClientControl, type ControlMember } from "./clients.js";
export const controlStore = {
  read: readTenantControl,
  transact: transactTenantControl,
};
export async function handleWorkspace(
  request: { method?: string; body?: any },
  member: ControlMember,
) {
  await requireOrganizationMember(member.uid, member.orgId);
  if (request.method === "GET")
    return {
      owner: "hyperflow",
      data: member.apiClientId ? redactTenantExport(workspaceView(await readTenantWorkspace(member.orgId))) : workspaceView(await readTenantWorkspace(member.orgId)),
    };
  if (request.method === "PUT" && member.apiClientId) throw new TenantControlError(403, "Machine clients must use the validated configuration API, not workspace replacement");
  if (request.method === "PUT")
    return {
      owner: "hyperflow",
      data: workspaceView(await replaceTenantWorkspace(member.orgId, request.body)),
    };
  throw new TenantControlError(405, "Method not allowed");
}
export async function handleTenantControl(
  request: { method?: string; body?: any },
  member: ControlMember,
) {
  const current = await requireOrganizationMember(member.uid, member.orgId);
  return handleClientControl(
    request,
    { ...current, apiClientId: member.apiClientId },
    controlStore,
  );
}
