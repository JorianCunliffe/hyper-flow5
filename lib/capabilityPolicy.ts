import type { CapabilityPolicyMode, TenantAgentProfile } from '../types.js';

export const TASK_CAPABILITY: Record<string, string> = {
  send_email: 'email.send',
  create_mailbox_draft: 'email.draft',
  update_mailbox_draft: 'email.draft',
  send_sms: 'sms.send',
  outgoing_call: 'phone.call',
  append_google_sheet: 'sheet.append',
  upsert_google_sheet: 'sheet.upsert',
  webhook: 'webhook.call'
};

const legacyAutomatic = (profile: TenantAgentProfile | null | undefined, capability: string): boolean => {
  const actions = profile?.automaticActions || [];
  if (capability === 'email.draft') return actions.includes('draft');
  if (capability === 'phone.call') return actions.includes('call');
  if (capability === 'sms.send') return actions.includes('sms') || actions.includes('send');
  if (capability === 'email.send') return actions.includes('send');
  if (capability === 'sheet.append' || capability === 'sheet.upsert') return actions.includes('sheet_write');
  return false;
};

/**
 * Capability policy is an authority ceiling, not flow logic. Human-configured
 * nodes decide what should happen; this decides whether the tenant permits the
 * effect to happen automatically.
 */
export const capabilityMode = (
  profile: TenantAgentProfile | null | undefined,
  capability: string
): CapabilityPolicyMode => {
  const explicit = profile?.capabilityPolicy?.[capability];
  if (explicit && ['automatic', 'approval', 'denied'].includes(explicit)) return explicit;
  return legacyAutomatic(profile, capability) ? 'automatic' : 'approval';
};

export const assertCapabilityAllowed = (input: {
  profile: TenantAgentProfile | null | undefined;
  capability: string;
  autonomous: boolean;
}): void => {
  const mode = capabilityMode(input.profile, input.capability);
  if (mode === 'denied') throw new Error(`Capability ${input.capability} is disabled by tenant policy`);
  if (input.autonomous && mode !== 'automatic') {
    throw new Error(`Capability ${input.capability} requires human approval before autonomous execution`);
  }
};
