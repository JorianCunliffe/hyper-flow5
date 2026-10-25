import { readTenantAgentProfile, serverStoreStatus } from "../serverStore.js";
import { readBriefingRecord } from "./store.js";
import type { CommunicationsClient } from "../communications/types.js";
export const outboundBriefingDependencies = {
  profile: readTenantAgentProfile,
  read: readBriefingRecord,
  available: () => serverStoreStatus().ok,
};
/** Opt in per call; ordinary coaching retains its existing history behaviour. */
export async function outboundBriefingEnabled(
  org: string,
  to: string,
  client: Pick<CommunicationsClient, "listPeople">,
  deps = outboundBriefingDependencies,
): Promise<boolean> {
  if (!deps.available()) return false;
  const profile = await deps.profile(org);
  if (!profile?.primaryUserId || !profile.primaryPersonId) return false;
  const settings = await deps.read(org, "settings", profile.primaryUserId);
  if (!settings?.enabled || settings.enrolledBy !== profile.primaryUserId)
    return false;
  const matched = (await client.listPeople(org)).filter((p) => p.phone === to);
  return matched.length === 1 && matched[0].id === profile.primaryPersonId;
}
