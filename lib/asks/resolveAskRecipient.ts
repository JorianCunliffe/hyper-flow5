import { readTenantAgentProfile, resolveTeamMemberIdentity } from '../serverStore.js';
import { resolveGrantedPersonTarget } from '../actionTarget.js';

const defaults = { readTenantAgentProfile, resolveTeamMemberIdentity, resolveGrantedPersonTarget };

/** Stable Communications identities must use project grants, never legacy name lookup. */
export const resolveAskRecipient = async (
  orgId: string, projectId: string, personId: string, channel: 'email' | 'sms' | 'voice',
  dependencies = defaults
): Promise<string> => {
  const profile = await dependencies.readTenantAgentProfile(orgId);
  const registered = profile?.personProjectAccess?.some(grant => grant.personId === personId);
  const stableId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(personId);
  if (registered || stableId) {
    return dependencies.resolveGrantedPersonTarget({ orgId, projectId, personId, channel, profile });
  }
  return dependencies.resolveTeamMemberIdentity(orgId, personId, channel);
};
